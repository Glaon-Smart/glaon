// SetupGate — top-level routing gate that decides whether to render the
// first-run wizard or fall through to the existing Router. See ADR 0028
// and epic #533.
//
// Reads `useDeviceConfig().isConfigured` synchronously (the
// ConfigProvider hydrates from `WebConfigStore.peekSync()` on mount, so
// the gate decides on the first render — no wizard-vs-login flash).
//
// Skips the wizard entirely when `import.meta.env.VITE_APP_MODE ===
// 'ingress'`: the add-on already assumes HA is provisioned and most
// wizard fields would be redundant. An Ingress-tuned variant is tracked
// as a follow-up.

import { Suspense, lazy, type ReactNode } from 'react';

import { useDeviceConfig } from '../config/config-provider';

// Code-split the wizard so already-configured devices (the common
// case after first-run) never pay the wizard's bundle cost. The
// chunk only fetches when the gate decides the user is not
// configured. `fallback={null}` keeps the brief blank during chunk
// fetch invisible — the gate has already short-circuited the
// Router so there's nothing else competing for the viewport.
const SetupRoute = lazy(() =>
  import('../features/setup/setup-route').then((mod) => ({ default: mod.SetupRoute })),
);

interface SetupGateProps {
  readonly children: ReactNode;
}

export function SetupGate({ children }: SetupGateProps) {
  const { isConfigured } = useDeviceConfig();
  if (import.meta.env.VITE_APP_MODE === 'ingress') {
    return <>{children}</>;
  }
  if (!isConfigured) {
    return (
      <Suspense fallback={null}>
        <SetupRoute />
      </Suspense>
    );
  }
  return <>{children}</>;
}
