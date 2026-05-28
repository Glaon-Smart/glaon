import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import type { PluginOption } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';
  const isBuild = command === 'build';
  const dsn = env.VITE_SENTRY_DSN;
  // `VITE_E2E_AUTH_STUB=true` swaps `@clerk/clerk-react` for a deterministic
  // stub so the Playwright pairing smoke (#359) can drive the wizard
  // without Clerk's real network. The flag is opt-in; production deploys
  // must NOT set it (a console warning fires if the bundle ever loads
  // with the stub in a real production environment).
  const e2eAuthStub = env.VITE_E2E_AUTH_STUB === 'true';
  if (isBuild && isProd && e2eAuthStub) {
    // eslint-disable-next-line no-console -- visible in CI logs
    console.warn(
      '[glaon/web] VITE_E2E_AUTH_STUB is set in a production build. ' +
        'Clerk will be replaced by a deterministic stub. This is only ' +
        'intended for the E2E pipeline.',
    );
  }

  if (isBuild && isProd && !dsn) {
    throw new Error(
      '[glaon/web] VITE_SENTRY_DSN is required for production builds. ' +
        'Set it in the build environment (e.g. repo secret for the deploy workflow) or build with --mode development.',
    );
  }

  const plugins: PluginOption[] = [react(), tailwindcss()];

  const authToken = env.SENTRY_AUTH_TOKEN;
  const org = env.SENTRY_ORG;
  const project = env.SENTRY_PROJECT;

  if (isBuild && isProd && authToken && org && project) {
    const releaseOpts = env.VITE_SENTRY_RELEASE
      ? { release: { name: env.VITE_SENTRY_RELEASE } }
      : {};
    plugins.push(
      sentryVitePlugin({
        org,
        project,
        authToken,
        ...releaseOpts,
        sourcemaps: { assets: './dist/**' },
        telemetry: false,
      }),
    );
  }

  // The Glaon UI kit's barrel re-exports `PressableButton` (and its RN
  // imports), so apps/web's bundler trips on `react-native`'s Flow
  // syntax during tree-shaking. Mirror packages/ui's vitest config and
  // alias `react-native` → `react-native-web` (already a transitive
  // dep via @glaon/ui) so the parser sees web-compatible source. The
  // `@clerk/clerk-react` alias stays opt-in for the E2E stub.
  return {
    plugins,
    resolve: {
      alias: {
        'react-native': 'react-native-web',
        // The Untitled UI kit source pulled via `npx untitledui add` uses
        // `@/` prefixed imports for cross-cutting utilities and components
        // (e.g. `@/utils/cx`, `@/components/base/buttons/button`). The
        // convention expects `@` to resolve to `packages/ui/src`.
        // Storybook wires this in `packages/ui/.storybook/main.ts`; apps/web
        // needs the same alias or the dev server throws hard import-analysis
        // errors as soon as the graph walks into a kit file like `tooltip.tsx`.
        // Production Rolldown builds happened to tolerate the missing alias,
        // which is why CI stayed green — dev mode is the canonical reproducer.
        // apps/web's own source uses relative imports, so there's no collision.
        '@': fileURLToPath(new URL('../../packages/ui/src/', import.meta.url)),
        ...(e2eAuthStub
          ? {
              '@clerk/clerk-react': fileURLToPath(
                new URL('./src/__e2e-stubs__/clerk-react.tsx', import.meta.url),
              ),
            }
          : {}),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // #598 — the setup wizard's apply step calls
        // `/api/hassio/network/*` for HA Supervisor enumeration +
        // commit. In dev, apps/web's bundler can't serve those
        // paths, so route them to apps/api (which has the
        // hassio-network proxy + mock-mode toggle). The `/api`
        // prefix is stripped so apps/api's router mounts cleanly
        // at `/hassio`.
        //
        // Production add-on bypasses this — nginx routes
        // /api/hassio/* directly to the supervisor's Ingress
        // endpoint, no Vite involved.
        '/api/hassio': {
          target: env.VITE_API_BASE_URL ?? 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
        // #617 — the apply step also POSTs the collected home settings
        // to `/api/setup/apply-ha`; apps/api pushes them into HA Core
        // over WebSocket. Same `/api` strip → apps/api mounts at
        // `/setup`. Production add-on bypasses this (onboarding routes
        // through the relay / add-on, not apps/api — ADR 0029).
        '/api/setup': {
          target: env.VITE_API_BASE_URL ?? 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
