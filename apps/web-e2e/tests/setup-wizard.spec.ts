// Setup wizard @smoke spec (#549 — epic #533, updated for the
// step-collapse in #597). Drives the first-run device setup wizard
// end-to-end:
//
//   1. clear `glaon.device-config` so SetupGate routes to the wizard
//      (the shared fixture in `support/test.ts` seeds a completedAt
//      blob by default — we have to opt out).
//   2. mock the HA Supervisor network endpoints. The preview build
//      isn't started with `VITE_APP_MODE=standalone`, so the apply
//      step takes the populated wifi branch and tries to scan; mocked
//      fetch lets the test pick an unsecured `PreviewGuest` AP and
//      the commit POST round-trips cleanly.
//   3. walk all 4 steps filling the minimum required fields:
//        - Home Overview → set the home name + advance
//        - Layout Setup → advance (single default floor, no required field)
//        - Device Security → password + confirm + advance
//        - Apply → assert summary contains the typed home name, pick
//          the mocked unsecured AP, click "Save and switch network".
//          No handoff modal opens (the AP is unsecured) so the commit
//          fires immediately; `window.location.reload()` lands the
//          user on mode-select or login (either is post-wizard
//          surface).
//   4. second test confirms the reload-after-completion path: a
//      second visit never re-renders the wizard.
//
// Tagged `@smoke` so the CI matrix runs it on every PR.

import { expect, test, type Page } from '@playwright/test';

// Bypass the shared `support/test.ts` fixture deliberately: the fixture
// runs an init script on every navigation that seeds
// `glaon.device-config.completedAt`. After this spec's wizard
// completes and reloads, that init script would overwrite the blob
// the user just persisted — so SetupGate would still see "configured"
// thanks to the seed but the test couldn't observe the wizard's own
// write. Using the raw `@playwright/test` import keeps localStorage
// untouched between navigations, matching real first-run behaviour.

const DEVICE_CONFIG_KEY = 'glaon.device-config';

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
    await mockSupervisorNetworkScan(page);
  });

  test('walks all 4 steps and lands on the login screen after commit', async ({ page }) => {
    await page.goto('/');

    // Step 1: Home Overview.
    await expect(page.getByRole('heading', { level: 1, name: 'Home Overview' })).toBeVisible();
    await page.getByLabel('Home Name').fill('Olivia');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: Layout Setup (placeholder; no required field).
    await expect(page.getByRole('heading', { level: 1, name: 'Layout Setup' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: Device Security. After #597 the wizard collapses the
    // old Wi-Fi credentials step + Final Review into the terminal
    // Apply step, so Security comes immediately after Layout.
    await expect(page.getByRole('heading', { level: 1, name: 'Device Security' })).toBeVisible();
    // SecurityStep labels render as "Password *" / "Confirm password *"
    // (the asterisk lives inside the <label>), so getByLabel with
    // exact:true misses. Use the placeholder text — unique per field.
    await page.getByPlaceholder('At least 8 characters').fill('correct-horse');
    await page.getByPlaceholder('Type the password again').fill('correct-horse');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4: Save and apply. Summary contains the home name, the
    // wifi picker shows the mocked PreviewGuest AP; clicking it
    // selects the network. The AP is unsecured, so "Save and switch
    // network" commits without opening the handoff modal. The reload
    // lands on mode-select / login.
    await expect(page.getByRole('heading', { level: 1, name: 'Save and apply' })).toBeVisible();
    await expect(page.getByText('Olivia')).toBeVisible();
    await page.getByRole('button', { name: /PreviewGuest/i }).click();
    await page.getByRole('button', { name: 'Save and switch network' }).click();

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
    await page.getByRole('button', { name: 'Next' }).click(); // Layout → Security
    // SecurityStep labels render as "Password *" / "Confirm password *"
    // (the asterisk lives inside the <label>), so getByLabel with
    // exact:true misses. Use the placeholder text — unique per field.
    await page.getByPlaceholder('At least 8 characters').fill('correct-horse');
    await page.getByPlaceholder('Type the password again').fill('correct-horse');
    await page.getByRole('button', { name: 'Next' }).click(); // Security → Apply
    await page.getByRole('button', { name: /PreviewGuest/i }).click();
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
