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

describe('setup — ha-layout (#638)', () => {
  const floors = [
    { floor_id: 'f-ground', name: 'Ground', level: 0 },
    { floor_id: 'f-up', name: 'Upstairs', level: 1 },
  ];
  const areas = [
    { area_id: 'a-living', name: 'Living', floor_id: 'f-ground' },
    { area_id: 'a-bed', name: 'Bedroom', floor_id: 'f-up' },
    { area_id: 'a-garage', name: 'Garage', floor_id: null },
  ];

  it('responds 503 when HA Core is not configured', async () => {
    const router = createSetupRouter({ config: baseConfig() });
    const res = await router.request('/ha-layout');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'ha-core-not-configured' });
  });

  it('returns the device floors + areas grouped, with floorless areas unassigned', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, floors, areas }),
    });
    const res = await router.request('/ha-layout');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      floors: { id: string; name: string; rooms: { name: string }[] }[];
      unassigned: { name: string }[];
    };
    expect(body.floors.map((f) => f.name)).toEqual(['Ground', 'Upstairs']);
    expect(body.floors.find((f) => f.id === 'f-ground')?.rooms.map((r) => r.name)).toEqual([
      'Living',
    ]);
    expect(body.unassigned.map((r) => r.name)).toEqual(['Garage']);
  });

  it('degrades to areas-only when the floor list fails', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () =>
        fakeClient({ sink, areas, failTypes: new Set(['config/floor_registry/list']) }),
    });
    const res = await router.request('/ha-layout');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { floors: unknown[]; unassigned: { name: string }[] };
    expect(body.floors).toEqual([]);
    // With no floors, every area is unassigned.
    expect(body.unassigned.map((r) => r.name)).toEqual(['Living', 'Bedroom', 'Garage']);
  });

  it('responds 502 when the HA Core connection cannot be established', async () => {
    const sink: RecordedFrame[] = [];
    const router = createSetupRouter({
      config: baseConfig(),
      clientFactory: () => fakeClient({ sink, connectError: new Error('ECONNREFUSED') }),
    });
    const res = await router.request('/ha-layout');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'ha-unreachable' });
  });
});
