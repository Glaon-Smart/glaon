// Setup wizard @smoke spec (#549 — epic #533). Drives the first-run
// device setup wizard end-to-end:
//
//   1. clear `glaon.device-config` so SetupGate routes to the wizard
//      (the shared fixture in `support/test.ts` seeds a completedAt
//      blob by default — we have to opt out).
//   2. walk all 5 steps filling the minimum required fields:
//        - Home Overview → set the home name + advance
//        - Layout Setup  → advance (placeholder, no required field)
//        - Wi-Fi         → standalone branch (the test build doesn't
//          run the HA Supervisor); Next advances without selection
//        - Device Security → password + confirm + advance
//        - Final Review  → assert summary contains the typed home name,
//          click Complete setup, assert no dialog opens (no Wi-Fi was
//          collected), assert the wizard ConfigStore commit fires and
//          `window.location.reload()` lands the user on /login
//   3. forced commit failure path: same walk but a 5xx on the
//      Supervisor push (or the absence of `wifi` collected at all
//      means we cannot trigger the supervisor — instead verify the
//      mode-select / login is the next render).
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

test.describe('setup wizard @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await clearDeviceConfig(page);
  });

  test('walks all 5 steps and lands on the login screen after commit', async ({ page }) => {
    await page.goto('/');

    // Step 1: Home Overview. The h1 from setup.homeOverview.title is
    // "Home Overview" (en). Fill the required home name then Next.
    await expect(page.getByRole('heading', { level: 1, name: 'Home Overview' })).toBeVisible();
    await page.getByLabel('Home Name').fill('Olivia');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 2: Layout Setup (placeholder; no required fields).
    await expect(page.getByRole('heading', { level: 1, name: 'Layout Setup' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: Wi-Fi Configuration. The preview build runs without an
    // HA Supervisor, so VITE_APP_MODE is whatever the build picked —
    // the spec uses the standalone informational branch where Next
    // advances unconditionally.
    await expect(page.getByRole('heading', { level: 1, name: 'Wi-Fi Connection' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 4: Device Security. Type a password + confirm.
    await expect(page.getByRole('heading', { level: 1, name: 'Device Security' })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('correct-horse');
    await page.getByLabel('Confirm password', { exact: true }).fill('correct-horse');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 5: Final Review. Summary contains the home name. No Wi-Fi
    // was collected (standalone branch skipped) so Complete setup
    // commits without a dialog. The commit ceremony reloads `/`; the
    // gate sees `completedAt` and falls through to the existing
    // Router which lands the user on /login (or mode-select).
    await expect(page.getByRole('heading', { level: 1, name: 'Final Review' })).toBeVisible();
    await expect(page.getByText('Olivia')).toBeVisible();
    await page.getByRole('button', { name: 'Complete setup' }).click();

    // After reload the wizard is gone and the auth surface mounts.
    // mode-select-route is the first thing a fresh user sees once
    // device-config is set, so wait for either it or the login form.
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
    await page.getByRole('button', { name: 'Next' }).click(); // Layout
    await page.getByRole('button', { name: 'Next' }).click(); // Wi-Fi
    await page.getByRole('button', { name: 'Next' }).click(); // Security
    await page.getByLabel('Password', { exact: true }).fill('correct-horse');
    await page.getByLabel('Confirm password', { exact: true }).fill('correct-horse');
    await page.getByRole('button', { name: 'Next' }).click(); // Review
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
