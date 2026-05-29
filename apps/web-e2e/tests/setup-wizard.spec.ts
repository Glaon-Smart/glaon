// Setup wizard @smoke spec (#549 — epic #533; updated for #597's step
// collapse and #629's Network step). Drives the first-run device setup
// wizard end-to-end:
//
//   1. clear `glaon.device-config` so SetupGate routes to the wizard
//      (the shared fixture in `support/test.ts` seeds a completedAt
//      blob by default — we have to opt out).
//   2. mock the HA Supervisor endpoints. The Network step (#629) reads
//      /network/info (interfaces + IPv4/IPv6) and /host/info (hostname),
//      scans Wi-Fi via the accesspoints endpoint, and the commit pushes
//      hostname (/host/options) + per-interface IP/Wi-Fi (/network/
//      interface/*/update) before the handoff.
//   3. walk all 5 steps filling the minimum required fields:
//        - Home Overview → set the home name + advance
//        - Layout Setup → advance (single default floor, no required field)
//        - Device Security → password + confirm + advance
//        - Network → pick the mocked unsecured `PreviewGuest` AP + advance
//        - Apply → assert summary contains the typed home name, click
//          "Save and switch network". The AP is unsecured, so no handoff
//          modal opens; the commit fires immediately and
//          `window.location.reload()` lands the user on mode-select /
//          login.
//   4. second test confirms the reload-after-completion path: a second
//      visit never re-renders the wizard.
//
// Tagged `@smoke` so the CI matrix runs it on every PR.

import { expect, test, type Page } from '@playwright/test';

// Bypass the shared `support/test.ts` fixture deliberately (see #549) so
// localStorage stays untouched between navigations, matching real
// first-run behaviour.

const DEVICE_CONFIG_KEY = 'glaon.device-config';

async function mockSupervisorNetwork(page: Page): Promise<void> {
  // /network/info — interfaces with IPv4/IPv6 blocks (#629). wlan0 first
  // so it's the default tab and the Wi-Fi picker shows immediately.
  await page.route('**/api/hassio/network/info', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          interfaces: [
            {
              interface: 'wlan0',
              type: 'wireless',
              enabled: true,
              ipv4: { method: 'auto' },
              ipv6: { method: 'auto' },
            },
            {
              interface: 'end0',
              type: 'ethernet',
              enabled: true,
              ipv4: { method: 'auto' },
              ipv6: { method: 'auto' },
            },
          ],
        },
      }),
    });
  });
  // /host/info — seeds the hostname field.
  await page.route('**/api/hassio/host/info', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { hostname: 'glaon' } }),
    });
  });
  await page.route('**/api/hassio/host/options', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"ok"}' });
  });
  await page.route('**/api/hassio/network/interface/*/accesspoints', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { accesspoints: [{ ssid: 'PreviewGuest', mac: 'aa:bb:cc:00:00:01', signal: 64 }] },
      }),
    });
  });
  await page.route('**/api/hassio/network/interface/*/update', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"ok"}' });
  });
  // #617 — the apply step pushes home settings to HA Core before the
  // network commit. Mock a clean success so the ceremony proceeds.
  await page.route('**/api/setup/apply-ha', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, steps: [] }),
    });
  });
}

async function walkToNetworkStep(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home Overview' })).toBeVisible();
  await page.getByLabel('Home Name').fill('Olivia');
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Layout Setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Device Security' })).toBeVisible();
  // The asterisk lives inside the <label>, so getByLabel misses; the
  // placeholders are unique per field.
  await page.getByPlaceholder('At least 8 characters').fill('correct-horse');
  await page.getByPlaceholder('Type the password again').fill('correct-horse');
  await page.getByRole('button', { name: 'Next' }).click();
}

test.describe('setup wizard @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupervisorNetwork(page);
  });

  test('walks all 5 steps and lands on the login screen after commit', async ({ page }) => {
    await walkToNetworkStep(page);

    // Step 4: Network. Pick the mocked unsecured AP (Wi-Fi picker moved
    // here from Apply in #629), then advance. The hostname seeds from
    // /host/info; the default static-method panels need no input.
    await expect(page.getByRole('heading', { level: 1, name: 'Network' })).toBeVisible();
    await page.getByRole('button', { name: /PreviewGuest/i }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5: Save and apply. Summary contains the home name; the AP is
    // unsecured, so "Save and switch network" commits without a handoff
    // modal. The reload lands on mode-select / login.
    await expect(page.getByRole('heading', { level: 1, name: 'Save and apply' })).toBeVisible();
    await expect(page.getByText('Olivia')).toBeVisible();
    await page.getByRole('button', { name: 'Save and switch network' }).click();

    await expect(
      page.getByTestId('mode-select-route').or(page.getByTestId('login-device-form')),
    ).toBeVisible({ timeout: 10_000 });

    const persistedRaw = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      DEVICE_CONFIG_KEY,
    );
    expect(persistedRaw).not.toBeNull();
    const persisted = JSON.parse(persistedRaw ?? '{}') as { completedAt?: string };
    expect(persisted.completedAt).toBeDefined();
  });

  test('reload after completion never re-runs the wizard', async ({ page }) => {
    await walkToNetworkStep(page);
    await page.getByRole('button', { name: /PreviewGuest/i }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Save and switch network' }).click();
    await expect(
      page.getByTestId('mode-select-route').or(page.getByTestId('login-device-form')),
    ).toBeVisible({ timeout: 10_000 });

    // Second visit: gate falls through, wizard does not render.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Home Overview' })).toHaveCount(0);
    await expect(
      page.getByTestId('mode-select-route').or(page.getByTestId('login-device-form')),
    ).toBeVisible();
  });
});
