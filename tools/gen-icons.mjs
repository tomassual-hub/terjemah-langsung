// Draws the app icon and renders the PNG sizes the manifest and iOS need:   npm run icons
// Two speech bubbles ("A" and "文") on a blue square. The maskable and Apple versions are full-bleed (the OS rounds them itself).

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'src', 'icons');

function svg({ rounded, scale, size }) {
  const bg = rounded ? '<rect width="512" height="512" rx="112" fill="url(#bg)"/>' : '<rect width="512" height="512" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f86ff"/><stop offset="1" stop-color="#0a4fd1"/></linearGradient></defs>
${bg}
<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
  <path d="M120 120h170a34 34 0 0 1 34 34v110a34 34 0 0 1-34 34h-96l-54 46v-46h-20a34 34 0 0 1-34-34V154a34 34 0 0 1 34-34z" fill="#ffffff"/>
  <text x="205" y="262" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="140" fill="#0a5ae6">A</text>
  <path d="M392 212H246a34 34 0 0 0-34 34v104a34 34 0 0 0 34 34h92l54 46v-46h0a34 34 0 0 0 34-34V246a34 34 0 0 0-34-34z" fill="#bfe0ff" stroke="#0a5ae6" stroke-width="10"/>
  <text x="318" y="352" text-anchor="middle" font-family="'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif" font-weight="700" font-size="118" fill="#0a4fd1">文</text>
</g>
</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.92 },
  { file: 'favicon-32.png', size: 32, rounded: true, scale: 1.05 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg({ rounded: t.rounded, scale: t.scale, size: t.size })}`);
    await page.screenshot({ path: join(OUT, t.file), omitBackground: true });
    await page.close();
    console.log(`  ${t.file} ${t.size}x${t.size}`);
  }
} finally {
  await browser.close();
}
