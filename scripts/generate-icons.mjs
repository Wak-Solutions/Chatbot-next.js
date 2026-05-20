#!/usr/bin/env node
/**
 * scripts/generate-icons.mjs — derive favicons, app icons, and OG image
 * from public/wak-logo-mark.png.
 *
 * Run with: node scripts/generate-icons.mjs
 *
 * Outputs (all under public/):
 *   favicon.ico    — multi-size ICO (16, 32, 48) with PNG payloads
 *   icon.png       — 32×32
 *   apple-icon.png — 180×180
 *   icon-192.png   — 192×192 (PWA)
 *   icon-512.png   — 512×512 (PWA)
 *   og-image.png   — 1200×630, logo centered on brand ink with a
 *                    soft radial brand-blue glow
 *
 * Square icons letterbox the (non-square) mark over the brand
 * background so aspect ratio is preserved. Brand colors here mirror
 * the CSS tokens in app/globals.css (--color-ink, --color-blue).
 *
 * Single dep: `sharp` (already in node_modules). The favicon.ico
 * encoder is hand-rolled because sharp doesn't emit ICO — Vista+
 * allows PNG payloads inside the ICO container, so we just pack the
 * 32-bit PNG bytes per size into a minimal ICONDIR + ICONDIRENTRY[]
 * header.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const SOURCE = join(PUBLIC, 'wak-logo-mark.png');

const INK = { r: 0x0f, g: 0x17, b: 0x2a, alpha: 1 };          // --color-ink
const BLUE = '#0066FF';                                        // --color-blue

async function squareIcon(size, padding = 0.16) {
  const inner = Math.round(size * (1 - padding * 2));
  const logo = await sharp(SOURCE)
    .resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: INK },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function ogImage() {
  const W = 1200;
  const H = 630;
  // Radial gradient base: navy ink with a soft blue glow off-center.
  const gradientSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="g" cx="50%" cy="55%" r="60%">
          <stop offset="0%" stop-color="${BLUE}" stop-opacity="0.22" />
          <stop offset="55%" stop-color="${BLUE}" stop-opacity="0.06" />
          <stop offset="100%" stop-color="${BLUE}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="rgb(${INK.r},${INK.g},${INK.b})" />
      <rect width="100%" height="100%" fill="url(#g)" />
    </svg>
  `);
  // Logo gets ~38% of the height — gives breathing room for OG previews.
  const logoH = Math.round(H * 0.38);
  const logo = await sharp(SOURCE)
    .resize({ height: logoH, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(gradientSvg).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
}

// Minimal ICO encoder: ICONDIR (6) + ICONDIRENTRY[] (16 each) + PNG payloads.
function encodeIco(pngs) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);              // reserved
  dir.writeUInt16LE(1, 2);              // type 1 = ICO
  dir.writeUInt16LE(pngs.length, 4);    // image count

  const entries = Buffer.alloc(16 * pngs.length);
  const headerSize = 6 + 16 * pngs.length;
  let offset = headerSize;
  for (let i = 0; i < pngs.length; i++) {
    const { size, data } = pngs[i];
    const base = i * 16;
    entries.writeUInt8(size === 256 ? 0 : size, base + 0);      // width (0 means 256)
    entries.writeUInt8(size === 256 ? 0 : size, base + 1);      // height
    entries.writeUInt8(0, base + 2);                            // palette colors (0 for true color)
    entries.writeUInt8(0, base + 3);                            // reserved
    entries.writeUInt16LE(1, base + 4);                         // color planes
    entries.writeUInt16LE(32, base + 6);                        // bits per pixel
    entries.writeUInt32LE(data.length, base + 8);               // bytes in resource
    entries.writeUInt32LE(offset, base + 12);                   // image offset
    offset += data.length;
  }
  return Buffer.concat([dir, entries, ...pngs.map((p) => p.data)]);
}

async function main() {
  // Sanity: confirm source exists and is sane.
  await readFile(SOURCE);

  const targets = [
    { name: 'icon.png', size: 32 },
    { name: 'apple-icon.png', size: 180 },
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
  ];

  for (const { name, size } of targets) {
    const buf = await squareIcon(size);
    await writeFile(join(PUBLIC, name), buf);
    console.log(`[icons] wrote ${name} (${size}x${size}, ${buf.length} bytes)`);
  }

  const icoSizes = [16, 32, 48];
  const icoPngs = await Promise.all(
    icoSizes.map(async (size) => ({ size, data: await squareIcon(size, 0.10) })),
  );
  await writeFile(join(PUBLIC, 'favicon.ico'), encodeIco(icoPngs));
  console.log(`[icons] wrote favicon.ico (sizes: ${icoSizes.join(', ')})`);

  const og = await ogImage();
  await writeFile(join(PUBLIC, 'og-image.png'), og);
  console.log(`[icons] wrote og-image.png (1200x630, ${og.length} bytes)`);
}

main().catch((err) => {
  console.error('[icons] FAILED:', err);
  process.exit(1);
});
