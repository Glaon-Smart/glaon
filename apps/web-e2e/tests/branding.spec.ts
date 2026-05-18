import { expect, test } from './support/test';

test.describe('branding @smoke', () => {
  test('declares favicon, apple-touch-icon, manifest, and theme-color', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
      'href',
      '/favicon.svg',
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png',
    );
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#326789');
  });

  test('serves favicon assets and manifest with the expected shape', async ({ page }) => {
    const svgResponse = await page.request.get('/favicon.svg');
    expect(svgResponse.status()).toBe(200);
    expect(svgResponse.headers()['content-type']).toContain('image/svg+xml');

    const icoResponse = await page.request.get('/favicon.ico');
    expect(icoResponse.status()).toBe(200);

    const manifestResponse = await page.request.get('/manifest.webmanifest');
    expect(manifestResponse.status()).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      name?: string;
      theme_color?: string;
      background_color?: string;
      icons?: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect(manifest.name).toBe('Glaon');
    expect(manifest.theme_color).toBe('#326789');
    expect(manifest.background_color).toBe('#326789');
    expect(manifest.icons).toHaveLength(4);
    expect(manifest.icons?.some((i) => i.sizes === '192x192' && i.purpose === 'maskable')).toBe(
      true,
    );
    expect(manifest.icons?.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(
      true,
    );
  });
});
