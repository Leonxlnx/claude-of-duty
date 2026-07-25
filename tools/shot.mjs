import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * Capture a screenshot of the running dev server.
 *   node tools/shot.mjs [outfile] [query] [waitMs] [clip] [setupScript]
 *
 * `setupScript` is a file evaluated in the page — with `g` bound to the game
 * and `h` to the harness — after boot and before the wait, so a shot can be
 * taken of any pose or state without adding query flags for each one.
 */
const out = process.argv[2] || 'shots/frame.png';
const query = process.argv[3] || '';
const waitMs = parseInt(process.argv[4] || '6000', 10);
const port = process.env.PORT || 5199;

mkdirSync(out.replace(/[/\\][^/\\]+$/, ''), { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-gl=angle', '--use-angle=gl',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization'
  ]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });

try {
  await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });
} catch {
  logs.push('[warn] __ready never became true');
}
const setupFile = process.argv[6];
if (setupFile) {
  const src = readFileSync(setupFile, 'utf8');
  const result = await page.evaluate(async (code) => {
    const fn = new Function('g', 'h', `return (async () => { ${code} })();`);
    try {
      return { ok: true, value: await fn(window.__game, window.__harness) };
    } catch (e) {
      return { ok: false, error: String(e && e.stack || e) };
    }
  }, src);
  logs.push(`[setup] ${JSON.stringify(result)}`);
}

await page.waitForTimeout(waitMs);

const clipArg = process.argv[5];
const clip = clipArg
  ? (([x, y, width, height]) => ({ x, y, width, height }))(clipArg.split(',').map(Number))
  : undefined;

await page.screenshot({ path: out, clip });
console.log(`saved ${out}`);
for (const l of logs) console.log(l);
await browser.close();
