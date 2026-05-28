import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import { createHassioNetworkRouter, probeSupervisor } from './hassio-network';

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

function mockResponse(init: { status?: number; body: unknown; contentType?: string }): Response {
  const text = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.contentType ?? 'application/json' },
  });
}

describe('hassio-network — mock mode', () => {
  it('returns interfaces (no embedded accesspoints) on GET /network/info', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/info');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { interfaces: { interface: string; type: string }[] };
    };
    const wireless = body.data.interfaces.find((i) => i.type === 'wireless');
    expect(wireless?.interface).toBe('wlan0');
    // /network/info carries interfaces only — APs come from the
    // accesspoints endpoint (#622).
    expect(body.data.interfaces[0]).not.toHaveProperty('accesspoints');
  });

  it('returns a canned AP list on GET /network/interface/:iface/accesspoints', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/interface/wlan0/accesspoints');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { accesspoints: { ssid: string }[] } };
    expect(body.data.accesspoints.length).toBeGreaterThan(0);
    expect(body.data.accesspoints[0]?.ssid).toBe('GlaonDev-Home');
  });

  it('accepts any POST /network/interface/:iface/update with 200 + { mocked: true }', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/interface/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifi: { mode: 'infrastructure', auth: 'open', ssid: 'X' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mocked: true });
  });

  it('embeds ipv4/ipv6 blocks per interface on GET /network/info', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/info');
    const body = (await res.json()) as {
      data: { interfaces: { interface: string; ipv4?: { method: string } }[] };
    };
    const end0 = body.data.interfaces.find((i) => i.interface === 'end0');
    expect(end0?.ipv4?.method).toBe('static');
    const wlan0 = body.data.interfaces.find((i) => i.interface === 'wlan0');
    expect(wlan0?.ipv4?.method).toBe('auto');
  });

  it('accepts an ipv4 static payload on POST /network/interface/:iface/update', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/interface/end0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ipv4: { method: 'static', address: ['192.168.1.50/24'], gateway: '192.168.1.1' },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mocked: true });
  });

  it('returns a hostname on GET /host/info', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/host/info');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { hostname: string } };
    expect(body.data.hostname).toBe('glaon');
  });

  it('accepts a valid hostname on POST /host/options', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/host/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'glaon-wall' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mocked: true });
  });

  it('rejects an invalid hostname on POST /host/options with 400', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/host/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: '-bad_host name' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid-hostname' });
  });
});

describe('hassio-network — unconfigured', () => {
  it('returns 503 on GET /network/info when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/network/info');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'supervisor-not-configured' });
  });

  it('returns 503 on GET accesspoints when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/network/interface/wlan0/accesspoints');
    expect(res.status).toBe(503);
  });

  it('returns 503 on POST update when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/network/interface/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifi: { auth: 'open', ssid: 'X' } }),
    });
    expect(res.status).toBe(503);
  });

  it('returns 503 on GET /host/info when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/host/info');
    expect(res.status).toBe(503);
  });

  it('returns 503 on POST /host/options (valid hostname) when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/host/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'glaon' }),
    });
    expect(res.status).toBe(503);
  });
});

describe('hassio-network — live proxy', () => {
  const config = baseConfig({
    supervisorUrl: 'http://supervisor.test/network',
    supervisorToken: 'long-lived-token',
  });

  it('forwards GET to the upstream supervisor with the bearer token', async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ body: { data: { interfaces: [{ accesspoints: [] }] } } })),
    );
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/network/info');
    expect(res.status).toBe(200);
    const mock = vi.mocked(fetchImpl);
    const call = mock.mock.calls[0];
    if (call === undefined) throw new Error('expected upstream call');
    expect(call[0]).toBe('http://supervisor.test/network/network/info');
    const init = call[1];
    if (init === undefined) throw new Error('expected init');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer long-lived-token');
  });

  it('forwards GET accesspoints to the canonical /interface/ path with the bearer token', async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ body: { data: { accesspoints: [{ ssid: 'Doyran' }] } } })),
    );
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/network/interface/wlan0/accesspoints');
    expect(res.status).toBe(200);
    const call = vi.mocked(fetchImpl).mock.calls[0];
    if (call === undefined) throw new Error('expected upstream call');
    expect(call[0]).toBe('http://supervisor.test/network/network/interface/wlan0/accesspoints');
    const init = call[1];
    if (init === undefined) throw new Error('expected init');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer long-lived-token');
  });

  it('forwards POST body verbatim to the canonical /interface/ update path', async () => {
    const upstreamBody = { result: 'ok' };
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ status: 202, body: upstreamBody })),
    );
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/network/interface/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifi: { auth: 'wpa-psk', psk: 'secret' } }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(upstreamBody);
    const mock = vi.mocked(fetchImpl);
    const call = mock.mock.calls[0];
    if (call === undefined) throw new Error('expected upstream call');
    expect(call[0]).toBe('http://supervisor.test/network/network/interface/wlan0/update');
    const init = call[1];
    if (init === undefined) throw new Error('expected init');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ wifi: { psk: 'secret' } });
  });

  it('returns 502 when the supervisor is unreachable', async () => {
    const fetchImpl: typeof fetch = vi.fn(() => Promise.reject(new TypeError('network down')));
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/network/info');
    expect(res.status).toBe(502);
  });

  it('rejects malformed POST bodies with 400 before touching the supervisor', async () => {
    const fetchImpl: typeof fetch = vi.fn();
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/network/interface/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled();
  });

  it('forwards GET /host/info to the upstream supervisor with the bearer token', async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ body: { data: { hostname: 'pi-ha' } } })),
    );
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/host/info');
    expect(res.status).toBe(200);
    const call = vi.mocked(fetchImpl).mock.calls[0];
    if (call === undefined) throw new Error('expected upstream call');
    expect(call[0]).toBe('http://supervisor.test/network/host/info');
    const init = call[1];
    if (init === undefined) throw new Error('expected init');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer long-lived-token');
  });

  it('forwards POST /host/options body to the upstream with the bearer token', async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ status: 202, body: { result: 'ok' } })),
    );
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/host/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'glaon-wall' }),
    });
    expect(res.status).toBe(202);
    const call = vi.mocked(fetchImpl).mock.calls[0];
    if (call === undefined) throw new Error('expected upstream call');
    expect(call[0]).toBe('http://supervisor.test/network/host/options');
    const init = call[1];
    if (init === undefined) throw new Error('expected init');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ hostname: 'glaon-wall' });
  });

  it('rejects an invalid hostname on POST /host/options with 400 before touching the supervisor', async () => {
    const fetchImpl: typeof fetch = vi.fn();
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/host/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'bad host' }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(fetchImpl)).not.toHaveBeenCalled();
  });
});

describe('probeSupervisor', () => {
  it('reports mode=mock when mock is on', async () => {
    const result = await probeSupervisor(baseConfig({ supervisorMock: true }));
    expect(result).toEqual({ ok: true, mode: 'mock' });
  });

  it('reports mode=unconfigured when neither URL nor mock is set', async () => {
    const result = await probeSupervisor(baseConfig());
    expect(result).toEqual({ ok: false, mode: 'unconfigured' });
  });

  it('reports mode=live + ok=true when the live supervisor answers 2xx', async () => {
    const fetchImpl: typeof fetch = vi.fn(() => Promise.resolve(mockResponse({ body: {} })));
    const result = await probeSupervisor(
      baseConfig({ supervisorUrl: 'http://supervisor.test/network', supervisorToken: 't' }),
      fetchImpl,
    );
    expect(result).toEqual({ ok: true, mode: 'live', status: 200 });
  });

  it('reports mode=live + ok=false + upstream status when the live supervisor returns non-2xx', async () => {
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ status: 401, body: { error: 'unauthorized' } })),
    );
    const result = await probeSupervisor(
      baseConfig({ supervisorUrl: 'http://supervisor.test/network', supervisorToken: 't' }),
      fetchImpl,
    );
    expect(result).toEqual({ ok: false, mode: 'live', status: 401 });
  });

  it('reports mode=live + ok=false + reason when the fetch throws', async () => {
    const fetchImpl: typeof fetch = vi.fn(() => Promise.reject(new Error('boom')));
    const result = await probeSupervisor(
      baseConfig({ supervisorUrl: 'http://supervisor.test/network', supervisorToken: 't' }),
      fetchImpl,
    );
    expect(result).toEqual({ ok: false, mode: 'live', reason: 'boom' });
  });
});
