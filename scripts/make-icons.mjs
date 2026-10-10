// يولّد أيقونات PNG للتطبيق من scripts/icon.svg باستخدام Playwright (Chromium)
// الاستخدام: npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url);
const svg = readFileSync(new URL('scripts/icon.svg', root), 'utf8');
const out = new URL('app/public/icons/', root);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('favicon.svg', out), svg);

const targets = [
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // أيقونة قابلة للقص (maskable): المحتوى داخل المنطقة الآمنة 80%
  { file: 'icon-maskable-512.png', size: 512, pad: 0.1 },
  { file: 'badge-96.png', size: 96, pad: 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - 2 * t.pad));
  await page.setContent(
    `<html><body style="margin:0;background:#0b5a31;display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  writeFileSync(new URL(t.file, out), await page.screenshot({ omitBackground: false }));
  console.log('✓', t.file);
}
await browser.close();
