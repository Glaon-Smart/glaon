import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import type { HaSetupClient } from '../ha/ha-setup-service';
import { createSetupRouter } from './setup';

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 8080,
    mongodbUri: 'mongodb://localhost:27017',
    mongodbDb: 'glaon-test',
    logLevel: 'info',
    sessionJwtSecret: 'a'.repeat(32),
    sessionTtlSeconds: 3600,
    webOrigins: [],
    supervisorMock: false,
    buildInfo: { version: '0.0.0-test', commit: 'deadbeef', builtAt: '2026-05-09T00:00:00Z' },
    ...overrides,
  };
}

interface RecordedFrame {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** Fake HaSetupClient: records frames, returns registry ids/lists by type. */
function fakeClient(opts: {
  connectError?: Error;
  failTypes?: Set<string>;
  sink: RecordedFrame[];
  floors?: readonly unknown[];
  areas?: readonly unknown[];
  config?: unknown;
  states?: readonly unknown[];
}): HaSetupClient {
  return {
    connect: () => (opts.connectError ? Promise.reject(opts.connectError) : Promise.resolve()),
    request: <TResult = unknown>(frame: unknown): Promise<TResult> => {
      const f = frame as RecordedFrame;
      opts.sink.push(f);
      if (opts.failTypes?.has(f.type)) {
        return Promise.reject(new Error(`HA rejected ${f.type}`));
      }
      if (f.type === 'config/floor_registry/create') {
        return Promise.resolve({ floor_id: `floor_${String(f.name)}`, name: f.name } as TResult);
      }
      if (f.type === 'config/area_registry/create') {
        return Promise.resolve({ area_id: `area_${String(f.name)}`, name: f.name } as TResult);
      }
      if (f.type === 'config/floor_registry/list') {
        return Promise.resolve((opts.floors ?? []) as TResult);
      }
      if (f.type === 'config/area_registry/list') {
        return Promise.resolve((opts.areas ?? []) as TResult);
      }
      if (f.type === 'get_config') {
        return Promise.resolve((opts.config ?? {}) as TResult);
      }
      if (f.type === 'get_states') {
        return Promise.resolve((opts.states ?? []) as TResult);
      }
      return Promise.resolve({} as TResult);
    },
    close: () => Promise.resolve(),
  };
}

const FULL_BODY = {
  latitude: 41.0082,
  longitude: 28.9784,
  unitSystem: 'metric' as const,
  timezone: 'Europe/Istanbul',
  country: 'TR',
  currency: 'TRY',
  locale: 'tr',
  layout: {
    floors: [{ name: 'Ground', rooms: [{ name: 'Living' }, { name: 'Kitchen' }] }],
  },
};

async function post(
  router: ReturnType<typeof createSetupRouter>,
  body: unknown,
): Promise<Response> {
  return router.request('/apply-ha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('setup — unconfigured', () => {
  it('responds 503 when HA Core URL + token are unset and no client is injected', async () => {
    const router = createSetupRouter({ config: baseConfig() });
    const res = await post(router, FULL_BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'ha-core-not-configured' });
  });
});

describe('setup — validation', () => {
  it('responds 400 on a malformed body without touching HA', async () => {
    const sink: RecordedFrame[] = [];
    const clientFactory = vi.fn(() => fakeClient({ sink }));
    const router = createSetupRouter({ config: baseConfig(), clientFactory });
    const res = await post(router, 'not-json');
    expect(res.status).toBe(400);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('responds 400 when country is not ISO alpha-2', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink }),
    });
    const res = await post(router, { ...FULL_BODY, country: 'turkey' });
    expect(res.status).toBe(400);
  });
});

describe('setup — happy path', () => {
  it('sends core update + floor + areas and reports ok=true', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink }),
    });
    const res = await post(router, FULL_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; steps: { step: string; ok: boolean }[] };
    expect(body.ok).toBe(true);
    expect(body.steps.map((s) => s.step)).toEqual([
      'core',
      'floor:Ground',
      'area:Living',
      'area:Kitchen',
    ]);

    const core = sink.find((f) => f.type === 'config/core/update');
    expect(core).toMatchObject({
      latitude: 41.0082,
      longitude: 28.9784,
      unit_system: 'metric',
      time_zone: 'Europe/Istanbul',
      country: 'TR',
      currency: 'TRY',
      language: 'tr',
    });
    // Areas carry the floor_id returned by the floor create.
    const living = sink.find(
      (f) => f.type === 'config/area_registry/create' && f.name === 'Living',
    );
    expect(living).toMatchObject({ floor_id: 'floor_Ground' });
  });
});

describe('setup — partial failure', () => {
  it('degrades gracefully when floor create fails (areas created floor-less, ok=false)', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () =>
        fakeClient({ sink, failTypes: new Set(['config/floor_registry/create']) }),
    });
    const res = await post(router, FULL_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; steps: { step: string; ok: boolean }[] };
    expect(body.ok).toBe(false);
    expect(body.steps.find((s) => s.step === 'floor:Ground')?.ok).toBe(false);
    // Areas still attempted, and without a floor_id (degrade path).
    expect(body.steps.find((s) => s.step === 'area:Living')?.ok).toBe(true);
    const living = sink.find(
      (f) => f.type === 'config/area_registry/create' && f.name === 'Living',
    );
    expect(living).not.toHaveProperty('floor_id');
  });
});

describe('setup — unreachable', () => {
  it('responds 502 when the HA Core connection cannot be established', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, connectError: new Error('ECONNREFUSED') }),
    });
    const res = await post(router, FULL_BODY);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'ha-unreachable' });
  });
});

describe('setup — ha-layout reconcile (#652)', () => {
  async function postLayout(
    router: ReturnType<typeof createSetupRouter>,
    body: unknown,
  ): Promise<Response> {
    return router.request('/ha-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const existingFloors = [{ floor_id: 'f-ground', name: 'Ground', level: 0 }];
  const existingAreas = [
    { area_id: 'a-living', name: 'Living', floor_id: 'f-ground' },
    { area_id: 'a-garage', name: 'Garage', floor_id: null },
  ];

  it('responds 503 when HA Core is not configured', async () => {
    const router = createSetupRouter({ config: baseConfig() });
    const res = await postLayout(router, { floors: [{ id: 'f', name: 'F', rooms: [] }] });
    expect(res.status).toBe(503);
  });

  it('responds 400 on a malformed body', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink }),
    });
    const res = await postLayout(router, { floors: [] }); // min(1) violated
    expect(res.status).toBe(400);
  });

  it('creates a new floor + area and threads the created floor_id', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, floors: [], areas: [] }),
    });
    const res = await postLayout(router, {
      floors: [{ id: 'new-floor', name: 'Attic', rooms: [{ id: 'new-room', name: 'Studio' }] }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    const floorCreate = sink.find((f) => f.type === 'config/floor_registry/create');
    expect(floorCreate).toMatchObject({ name: 'Attic' });
    const areaCreate = sink.find((f) => f.type === 'config/area_registry/create');
    // fakeClient returns floor_id `floor_<name>` from the create.
    expect(areaCreate).toMatchObject({ name: 'Studio', floor_id: 'floor_Attic' });
  });

  it('renames a floor + deletes a removed area, no stray creates (idempotent shape)', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, floors: existingFloors, areas: existingAreas }),
    });
    const res = await postLayout(router, {
      floors: [{ id: 'f-ground', name: 'Main', rooms: [{ id: 'a-living', name: 'Living' }] }],
    });
    expect(res.status).toBe(200);
    expect(sink.find((f) => f.type === 'config/floor_registry/update')).toMatchObject({
      floor_id: 'f-ground',
      name: 'Main',
    });
    // a-garage (unassigned, dropped from desired) is deleted.
    expect(sink.find((f) => f.type === 'config/area_registry/delete')).toMatchObject({
      area_id: 'a-garage',
    });
    expect(sink.some((f) => f.type === 'config/floor_registry/create')).toBe(false);
  });

  it('responds 502 when the HA Core connection cannot be established', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, connectError: new Error('ECONNREFUSED') }),
    });
    const res = await postLayout(router, { floors: [{ id: 'f', name: 'F', rooms: [] }] });
    expect(res.status).toBe(502);
  });
});

describe('setup — unified seed GET / (#678)', () => {
  // A canned Supervisor `fetch` for the network section: host/info →
  // hostname, network/info → interfaces. Any other URL 404s.
  const supervisorFetch: typeof fetch = (input) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (u.endsWith('/host/info')) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { hostname: 'glaon-dev' } }), { status: 200 }),
      );
    }
    if (u.endsWith('/network/info')) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: { interfaces: [{ interface: 'wlan0' }] } }), {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };

  it('aggregates homeOverview (incl. zone.home radius), layout, and network', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig({
        supervisorUrl: 'http://supervisor.local',
        supervisorToken: 'token',
      }),
      clientFactory: () =>
        fakeClient({
          sink,
          config: { latitude: 41, longitude: 29, country: 'TR', time_zone: 'Europe/Istanbul' },
          floors: [{ floor_id: 'f1', name: 'Ground', level: 0 }],
          areas: [{ area_id: 'a1', name: 'Kitchen', floor_id: 'f1' }],
          states: [{ entity_id: 'zone.home', attributes: { radius: 250 } }],
        }),
      fetchImpl: supervisorFetch,
    });

    const res = await router.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      homeOverview: { country?: string; radius?: number } | null;
      layout: { floors: { name: string }[] } | null;
      network: { hostname?: string; interfaces?: unknown[] } | null;
    };
    expect(body.homeOverview?.country).toBe('TR');
    expect(body.homeOverview?.radius).toBe(250);
    expect(body.layout?.floors.some((f) => f.name === 'Ground')).toBe(true);
    expect(body.network?.hostname).toBe('glaon-dev');
    expect(body.network?.interfaces).toHaveLength(1);
  });

  it('degrades per-section: HA Core unconfigured → home/layout null, network still present', async () => {
    const router = createSetupRouter({
      // No clientFactory + no HA Core env → factory undefined.
      config: baseConfig({ supervisorMock: true }),
    });
    const res = await router.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      homeOverview: unknown;
      layout: unknown;
      network: { hostname?: string } | null;
    };
    expect(body.homeOverview).toBeNull();
    expect(body.layout).toBeNull();
    // supervisorMock seeds the canned hostname.
    expect(body.network?.hostname).toBe('glaon');
  });

  it('network null when the Supervisor is unconfigured (no mock, no url)', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, config: { country: 'TR' } }),
    });
    const res = await router.request('/');
    const body = (await res.json()) as {
      network: unknown;
      homeOverview: { country?: string } | null;
    };
    expect(body.network).toBeNull();
    expect(body.homeOverview?.country).toBe('TR');
  });
});
