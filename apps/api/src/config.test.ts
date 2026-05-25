import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

const SECRET_32 = 'a'.repeat(32);
const REQUIRED_BASE = {
  MONGODB_URI: 'mongodb://localhost:27017',
  SESSION_JWT_SECRET: SECRET_32,
};

describe('loadConfig', () => {
  it('parses defaults when only required values are set', () => {
    const config = loadConfig({ ...REQUIRED_BASE });
    expect(config.port).toBe(8080);
    expect(config.mongodbUri).toBe('mongodb://localhost:27017');
    expect(config.mongodbDb).toBe('glaon');
    expect(config.logLevel).toBe('info');
    expect(config.sessionTtlSeconds).toBe(3600);
    expect(config.webOrigins).toEqual([]);
    expect(config.buildInfo).toEqual({
      version: '0.0.0',
      commit: 'unknown',
      builtAt: '',
    });
  });

  it('throws when MONGODB_URI is missing', () => {
    expect(() => loadConfig({ SESSION_JWT_SECRET: SECRET_32 })).toThrow();
  });

  it('throws when SESSION_JWT_SECRET is shorter than 32 bytes', () => {
    expect(() => loadConfig({ MONGODB_URI: 'm://x', SESSION_JWT_SECRET: 'too-short' })).toThrow(
      /at least 32 bytes/i,
    );
  });

  it('throws when PORT is not a valid TCP port', () => {
    expect(() => loadConfig({ ...REQUIRED_BASE, PORT: 'not-a-number' })).toThrow(
      /must be a valid TCP port/i,
    );
    expect(() => loadConfig({ ...REQUIRED_BASE, PORT: '99999' })).toThrow(
      /must be a valid TCP port/i,
    );
  });

  it('rejects unknown log levels', () => {
    expect(() => loadConfig({ ...REQUIRED_BASE, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('parses comma-separated WEB_ORIGINS into an array', () => {
    const config = loadConfig({
      ...REQUIRED_BASE,
      WEB_ORIGINS: 'https://app.glaon.com, http://localhost:5173',
    });
    expect(config.webOrigins).toEqual(['https://app.glaon.com', 'http://localhost:5173']);
  });

  it('reads HA Supervisor env vars (#598) — URL + token + mock flag', () => {
    const config = loadConfig({
      ...REQUIRED_BASE,
      HA_SUPERVISOR_URL: 'http://supervisor.test/network',
      HA_SUPERVISOR_TOKEN: 'long-lived',
      HA_SUPERVISOR_MOCK: 'true',
    });
    expect(config.supervisorUrl).toBe('http://supervisor.test/network');
    expect(config.supervisorToken).toBe('long-lived');
    expect(config.supervisorMock).toBe(true);
  });

  it('defaults HA_SUPERVISOR_MOCK to false and leaves URL/token undefined', () => {
    const config = loadConfig(REQUIRED_BASE);
    expect(config.supervisorMock).toBe(false);
    expect(config.supervisorUrl).toBeUndefined();
    expect(config.supervisorToken).toBeUndefined();
  });

  it('rejects an invalid HA_SUPERVISOR_URL (not a URL)', () => {
    expect(() => loadConfig({ ...REQUIRED_BASE, HA_SUPERVISOR_URL: 'not-a-url' })).toThrow();
  });

  it('honors build info env vars', () => {
    const config = loadConfig({
      ...REQUIRED_BASE,
      GLAON_API_VERSION: '1.2.3',
      GLAON_API_COMMIT: 'abc1234',
      GLAON_API_BUILT_AT: '2026-05-09T12:00:00Z',
    });
    expect(config.buildInfo).toEqual({
      version: '1.2.3',
      commit: 'abc1234',
      builtAt: '2026-05-09T12:00:00Z',
    });
  });
});
