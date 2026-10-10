// لقطات شاشة بمقاس آيفون للمراجعة: node scripts/screenshots.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const out = new URL('../screenshots/', import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], colorScheme: scheme, locale: 'ar', timezoneId: 'Asia/Riyadh' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${scheme} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${scheme} console: ${m.text()}`));
  const shot = async (name, path, action) => {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    if (action) await action();
    await page.waitForTimeout(400);
    await page.screenshot({ path: new URL(`${scheme}-${name}.png`, out).pathname });
  };
  await shot('live', '/');
  if (scheme === 'dark') continue;
  await shot('fixtures', '/fixtures');
  await shot('results', '/results');
  await shot('leagues', '/leagues');
  await shot('table', '/league/307');
  // افتح أول مباراة مباشرة
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const href = await page.locator('a.match-card').first().getAttribute('href');
  await shot('match-events', href);
  await shot('match-stats', href + '?tab=stats');
  await shot('match-lineups', href + '?tab=lineups');
  await page.goto(base + '/results', { waitUntil: 'networkidle' });
  const done = await page.locator('a.match-card').nth(1).getAttribute('href');
  await shot('match-finished', done);
  await shot('favorites', '/favorites');
  await shot('settings', '/settings');
}
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
