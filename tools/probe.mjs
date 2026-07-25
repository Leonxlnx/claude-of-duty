import { chromium } from '@playwright/test';

/**
 * Boot timing / console probe against a running server.
 *   node tools/probe.mjs [port] [width] [height] [query]
 */
const port = process.argv[2] || '4173';
const width = parseInt(process.argv[3] || '1600', 10);
const height = parseInt(process.argv[4] || '900', 10);
const query = process.argv[5] || '';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
console.log(`load ${Date.now() - t0}ms`);

try {
  await page.waitForFunction(() => window.__ready === true, { timeout: 240000 });
  console.log(`ready ${Date.now() - t0}ms`);
  console.log(JSON.stringify(await page.evaluate(() => window.__game.bootTimings ?? null)));
} catch {
  console.log(`NOT READY after ${Date.now() - t0}ms`);
  console.log(await page.evaluate(() => document.getElementById('loading-text')?.textContent ?? 'no loading text'));
}
await browser.close();
