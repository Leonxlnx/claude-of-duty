import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Evaluate a snippet against the running game and print what it returns.
 *   node tools/eval.mjs <script> [query]
 *
 * The same seam as `shot.mjs` — `g` is the game, `h` the harness — without the
 * screenshot, which under a software rasteriser is both the slow part and the
 * part that times out. For questions about state rather than pixels.
 */
const file = process.argv[2];
const query = process.argv[3] || '?auto=1&dynres=0';
const port = process.env.PORT || 5199;

const browser = await chromium.launch({
  args: [
    '--use-gl=angle', '--use-angle=gl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    // Without this every frame is pinned to the display's 16.7ms and any
    // measurement of frame cost reads back exactly 16.7ms at every quality
    // level — which is the refresh rate, not the renderer. The Playwright
    // config has always had it; this tool did not, so every perf number taken
    // through `eval.mjs` was meaningless.
    '--disable-frame-rate-limit', '--enable-gpu-rasterization'
  ]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${port}/${query}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 180000 });

const src = readFileSync(file, 'utf8');
const result = await page.evaluate(async (code) => {
  const fn = new Function('g', 'h', `return (async () => { ${code} })();`);
  try { return { ok: true, value: await fn(window.__game, window.__harness) }; }
  catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
}, src);

console.log(JSON.stringify(result, null, 1));
for (const e of errors) console.log(`[error] ${e}`);
await browser.close();
