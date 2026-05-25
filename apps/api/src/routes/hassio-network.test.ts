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
  it('returns a canned access-point list on GET /network/info', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/info');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { interfaces: { accesspoints: { ssid: string }[] }[] };
    };
    expect(body.data.interfaces[0]?.accesspoints.length).toBeGreaterThan(0);
  });

  it('accepts any POST /network/:iface/update with 200 + { mocked: true }', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig({ supervisorMock: true }) });
    const res = await router.request('/network/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifi: { mode: 'infrastructure', auth: 'open', ssid: 'X' } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mocked: true });
  });
});

describe('hassio-network — unconfigured', () => {
  it('returns 503 on GET when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/network/info');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'supervisor-not-configured' });
  });

  it('returns 503 on POST when neither URL nor mock is set', async () => {
    const router = createHassioNetworkRouter({ config: baseConfig() });
    const res = await router.request('/network/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifi: { auth: 'open', ssid: 'X' } }),
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

  it('forwards POST body verbatim, preserves status, and re-emits content-type', async () => {
    const upstreamBody = { result: 'ok' };
    const fetchImpl: typeof fetch = vi.fn(() =>
      Promise.resolve(mockResponse({ status: 202, body: upstreamBody })),
    );
    const router = createHassioNetworkRouter({ config, fetchImpl });
    const res = await router.request('/network/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wifi: { auth: 'wpa-psk', psk: 'secret' } }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(upstreamBody);
    const mock = vi.mocked(fetchImpl);
    const call = mock.mock.calls[0];
    if (call === undefined) throw new Error('expected upstream call');
    expect(call[0]).toBe('http://supervisor.test/network/network/wlan0/update');
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
    const res = await router.request('/network/wlan0/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
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
