import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Run an arbitrary snippet against a booted game and print the result.
 *   node tools/poke.mjs <file-with-async-body> [query] [waitMs]
 * The snippet body receives `g` (the game) and `h` (the harness).
 */
const file = process.argv[2];
const query = process.argv[3] ?? '?auto=1';
const waitMs = parseInt(process.argv[4] ?? '2000', 10);
const port = process.env.PORT || 4319;
const body = readFileSync(file, 'utf8');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`.slice(0, 500)));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(waitMs);

const result = await page.evaluate(async (src) => {
  const fn = new Function('g', 'h', `return (async () => { ${src} })();`);
  try {
    return { ok: true, value: await fn(window.__game, window.__harness) };
  } catch (e) {
    return { ok: false, error: String(e && e.stack || e) };
  }
}, body);

console.log(JSON.stringify(result, null, 2));
await browser.close();
