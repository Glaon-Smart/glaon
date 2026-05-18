// Idempotent icon generator for Glaon favicon + app-icon family.
//
// Canonical source: packages/assets/favicon.svg
//   (200x200, #326789 background, "Light" symbol mark inlay — Figma node 14867:192194).
//
// Foreground-only source for the Android adaptive-icon and the Expo splash:
//   packages/assets/symbol_dark.svg (transparent background, cream ring + red bar).
//
// Run: pnpm icons:generate
//
// Outputs are committed alongside the source so `git status` stays clean
// after a regeneration; the diff between source SVG and committed bitmaps
// is the verification surface during code review.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const FAVICON_SVG = resolve(repoRoot, 'packages/assets/favicon.svg');
const SYMBOL_SVG = resolve(repoRoot, 'packages/assets/symbol_dark.svg');

const BRAND_BG = '#326789';

/**
 * Render a SVG to a PNG buffer at the requested square size.
 * `padding` is a 0..1 fraction reserved as transparent border on every
 * side — used for Android maskable icons so the OS can crop to a circle
 * without clipping the mark.
 */
async function renderSquare(svgPath, size, { padding = 0, background = null } = {}) {
  const svg = await readFile(svgPath);
  const innerSize = Math.round(size * (1 - padding * 2));
  const offset = Math.round((size - innerSize) / 2);
  const rendered = await sharp(svg, { density: 384 })
    .resize(innerSize, innerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  return canvas
    .composite([{ input: rendered, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeOut(targetPath, buffer) {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);
  // eslint-disable-next-line no-console -- script output is the point
  console.log(`  wrote ${targetPath.replace(repoRoot + '/', '')} (${buffer.length} bytes)`);
}

async function copyFile(srcPath, targetPath) {
  const buffer = await readFile(srcPath);
  await writeOut(targetPath, buffer);
}

async function main() {
  console.log('Generating Glaon icon set from packages/assets/favicon.svg…');

  // --- Web ----------------------------------------------------------------
  const webPublic = resolve(repoRoot, 'apps/web/public');

  // 1. Inline SVG copy — modern browsers prefer this; ICO and PNG fallbacks
  //    cover legacy + iOS contexts.
  await copyFile(FAVICON_SVG, join(webPublic, 'favicon.svg'));

  // 2. PNG sizes for legacy + iOS + manifest.
  const png16 = await renderSquare(FAVICON_SVG, 16);
  await writeOut(join(webPublic, 'favicon-16.png'), png16);
  const png32 = await renderSquare(FAVICON_SVG, 32);
  await writeOut(join(webPublic, 'favicon-32.png'), png32);
  const png48 = await renderSquare(FAVICON_SVG, 48);
  const png180 = await renderSquare(FAVICON_SVG, 180);
  await writeOut(join(webPublic, 'apple-touch-icon.png'), png180);
  const png192 = await renderSquare(FAVICON_SVG, 192);
  await writeOut(join(webPublic, 'icon-192.png'), png192);
  const png512 = await renderSquare(FAVICON_SVG, 512);
  await writeOut(join(webPublic, 'icon-512.png'), png512);

  // 3. Multi-resolution ICO (16/32/48) for the legacy <link rel="icon" sizes="32x32">
  //    declaration; png-to-ico bundles the three sizes into one .ico file.
  const ico = await pngToIco([png16, png32, png48]);
  await writeOut(join(webPublic, 'favicon.ico'), ico);

  // 4. Maskable variants for Android adaptive — add ~10% transparent
  //    safe-zone padding so the OS can crop to circle/squircle without
  //    clipping the symbol. Background stays #326789 inside the safe zone.
  const maskable192 = await renderSquareOnBrand(FAVICON_SVG, 192, 0.1);
  await writeOut(join(webPublic, 'icon-maskable-192.png'), maskable192);
  const maskable512 = await renderSquareOnBrand(FAVICON_SVG, 512, 0.1);
  await writeOut(join(webPublic, 'icon-maskable-512.png'), maskable512);

  // --- HA add-on ----------------------------------------------------------
  // HA renders addon/icon.png on the add-on Store and Info tab; 256x256
  // is the recommended size.
  const addonIcon = await renderSquare(FAVICON_SVG, 256);
  await writeOut(resolve(repoRoot, 'addon/icon.png'), addonIcon);

  // --- Mobile (Expo) ------------------------------------------------------
  const mobileAssets = resolve(repoRoot, 'apps/mobile/assets');

  // iOS / generic icon: opaque, full-bleed (Expo writes this directly into
  // AppIcon.appiconset during prebuild).
  const iosIcon = await renderSquare(FAVICON_SVG, 1024);
  await writeOut(join(mobileAssets, 'icon.png'), iosIcon);

  // Android adaptive foreground: transparent background, mark centered.
  // Expo composites this on top of `adaptiveIcon.backgroundColor` from
  // app.json, so the source SVG must be the symbol on transparent (NOT
  // the tiled favicon).
  const adaptiveForeground = await renderSquare(SYMBOL_SVG, 1024, { padding: 0.18 });
  await writeOut(join(mobileAssets, 'adaptive-icon.png'), adaptiveForeground);

  // Splash: transparent symbol, Expo composites on splash backgroundColor.
  const splash = await renderSquare(SYMBOL_SVG, 1024, { padding: 0.25 });
  await writeOut(join(mobileAssets, 'splash-icon.png'), splash);

  console.log('Done.');
}

/**
 * Renders the favicon onto a #326789 brand-colored square with `padding`
 * fraction of transparent safe-zone reserved around the mark area —
 * specifically tuned for Android maskable icons. The brand color fills
 * the whole `size x size` canvas; the mark is scaled down by the safe
 * zone so the OS crop never clips it.
 */
async function renderSquareOnBrand(svgPath, size, padding) {
  // The source SVG already has the #326789 background covering 0,0,200,200,
  // so rendering it at (size * (1 - padding*2)) and compositing onto a
  // larger #326789 canvas is equivalent to drawing the mark with a
  // transparent safe zone around it — the brand color extends to the edge.
  const innerSize = Math.round(size * (1 - padding * 2));
  const offset = Math.round((size - innerSize) / 2);
  const svg = await readFile(svgPath);
  const inner = await sharp(svg, { density: 384 })
    .resize(innerSize, innerSize, { fit: 'contain' })
    .png()
    .toBuffer();
  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_BG,
    },
  });
  return canvas
    .composite([{ input: inner, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
