// Setup wizard @smoke spec (#549 — epic #533). Drives the first-run
// device setup wizard end-to-end:
//
//   1. clear `glaon.device-config` so SetupGate routes to the wizard
//      (the shared fixture in `support/test.ts` seeds a completedAt
//      blob by default — we have to opt out).
//   2. mock the HA Supervisor network endpoints. The preview build
//      isn't started with `VITE_APP_MODE=standalone`, so WifiStep
//      takes the populated branch and tries to scan; mocked fetch
//      lets the test pick an unsecured `PreviewGuest` AP and the
//      commit POST round-trips cleanly.
//   3. walk all 5 steps filling the minimum required fields:
//        - Home Overview → set the home name + advance
//        - Layout Setup → advance (placeholder, no required field)
//        - Wi-Fi → pick the mocked unsecured AP + advance
//        - Device Security → password + confirm + advance
//        - Final Review → assert summary contains the typed home
//          name + click Complete setup. No password dialog opens
//          (the AP is unsecured) so the commit fires immediately;
//          `window.location.reload()` lands the user on mode-select
//          or login (either is post-wizard surface).
//   4. second test confirms the reload-after-completion path: a
//      second visit never re-renders the wizard.
//
// Tagged `@smoke` so the CI matrix runs it on every PR.

import type { Page } from '@playwright/test';

import { expect, test } from './support/test';

const DEVICE_CONFIG_KEY = 'glaon.device-config';

async function clearDeviceConfig(page: Page): Promise<void> {
  // Runs AFTER the shared fixture's seed init-script, so the wizard
  // sees an empty store on the first render.
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.removeItem(key);
    },
    { key: DEVICE_CONFIG_KEY },
  );
}

async function mockSupervisorNetworkScan(page: Page): Promise<void> {
  await page.route('**/api/hassio/network/info', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          interfaces: [{ accesspoints: [{ ssid: 'PreviewGuest', auth: 'none' }] }],
        },
      }),
    });
  });
  await page.route('**/api/hassio/network/wlan0/update', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"result":"ok"}' });
  });
}

test.describe('setup wizard @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await clearDeviceConfig(page);
    await mockSupervisorNetworkScan(page);
  });

  test('walks all 5 steps and lands on the login screen after commit', async ({ page }) => {
    await page.goto('/');

    // Step 1: Home Overview.
    await expect(page.getByRole('heading', { level: 1, name: 'Home Overview' })).toBeVisible();
    await page.getByLabel('Home Name').fill('Olivia');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: Layout Setup (placeholder; no required field).
    await expect(page.getByRole('heading', { level: 1, name: 'Layout Setup' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: Wi-Fi Configuration. Pick the mocked unsecured AP.
    await expect(page.getByRole('heading', { level: 1, name: 'Wi-Fi Connection' })).toBeVisible();
    await page.getByRole('button', { name: /PreviewGuest/i }).click();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4: Device Security.
    await expect(page.getByRole('heading', { level: 1, name: 'Device Security' })).toBeVisible();
    // SecurityStep labels render as "Password *" / "Confirm password *"
    // (the asterisk lives inside the <label>), so getByLabel with
    // exact:true misses. Use the placeholder text — unique per field.
    await page.getByPlaceholder('At least 8 characters').fill('correct-horse');
    await page.getByPlaceholder('Type the password again').fill('correct-horse');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5: Final Review. Summary contains the home name. The AP
    // is unsecured, so Complete setup commits without opening the
    // password dialog. The reload lands on mode-select / login.
    await expect(page.getByRole('heading', { level: 1, name: 'Final Review' })).toBeVisible();
    await expect(page.getByText('Olivia')).toBeVisible();
    await page.getByRole('button', { name: 'Complete setup' }).click();

    await expect(
      page.getByTestId('mode-select-route').or(page.getByTestId('login-device-form')),
    ).toBeVisible({ timeout: 10_000 });

    // The persisted blob now has `completedAt` so a second visit
    // never shows the wizard again.
    const persistedRaw = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      DEVICE_CONFIG_KEY,
    );
    expect(persistedRaw).not.toBeNull();
    const persisted = JSON.parse(persistedRaw ?? '{}') as { completedAt?: string };
    expect(persisted.completedAt).toBeDefined();
  });

  test('reload after completion never re-runs the wizard', async ({ page }) => {
    // First run: walk the wizard end-to-end (compressed assertions).
    await page.goto('/');
    await page.getByLabel('Home Name').fill('Olivia');
    await page.getByRole('button', { name: 'Next' }).click(); // Home → Layout
    await page.getByRole('button', { name: 'Next' }).click(); // Layout → Wi-Fi
    await page.getByRole('button', { name: /PreviewGuest/i }).click();
    await page.getByRole('button', { name: 'Next' }).click(); // Wi-Fi → Security
    // SecurityStep labels render as "Password *" / "Confirm password *"
    // (the asterisk lives inside the <label>), so getByLabel with
    // exact:true misses. Use the placeholder text — unique per field.
    await page.getByPlaceholder('At least 8 characters').fill('correct-horse');
    await page.getByPlaceholder('Type the password again').fill('correct-horse');
    await page.getByRole('button', { name: 'Next' }).click(); // Security → Review
    await page.getByRole('button', { name: 'Complete setup' }).click();
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
