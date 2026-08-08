import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * Photograph an enemy character from a fixed set of framings.
 *
 *   node tools/enemy-shots.mjs [outDir]
 *
 * One boot, one frozen agent on a fixed mark, several camera positions around
 * it — so "does this read as a soldier" can be answered from pixels instead of
 * from the geometry source. `tools/snippets/pose-enemy.js` does the staging.
 */
const outDir = process.argv[2] || 'shots/enemy';
const port = process.env.PORT || 4319;
mkdirSync(outDir, { recursive: true });

const FRAMINGS = [
  { name: 'front', distance: 3.0, height: 1.05, angle: 0.0 },
  { name: 'threequarter', distance: 3.0, height: 1.05, angle: 0.7 },
  { name: 'side', distance: 3.0, height: 1.05, angle: 1.57 },
  { name: 'back', distance: 3.0, height: 1.05, angle: 3.14 },
  { name: 'head', distance: 1.5, height: 1.62, angle: 0.5 },
  { name: 'crouch', distance: 2.6, height: 0.85, angle: 0.7, stance: 'crouch' },
  { name: 'silhouette-12m', distance: 12, height: 1.1, angle: 0.7 },
  { name: 'silhouette-30m', distance: 30, height: 1.1, angle: 0.7 }
];

const browser = await chromium.launch({
  args: [
    '--use-gl=angle', '--use-angle=gl', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization'
  ]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${port}/?auto=1&dynres=0`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 180000 });

await page.evaluate(async () => {
  const h = window.__harness, g = window.__game;
  h.setQuality('ultra');
  h.setSetting('dynres', false);
  g.graph.setRenderScale?.(1);
  g.hud?.root && (g.hud.root.style.display = 'none');
  await new Promise((r) => setTimeout(r, 600));
});

const pose = readFileSync('tools/snippets/pose-enemy.js', 'utf8');

for (const framing of FRAMINGS) {
  const result = await page.evaluate(async ({ code, cfg }) => {
    window.__poseEnemy = cfg;
    const fn = new Function('g', 'h', `return (async () => { ${code} })();`);
    try { return { ok: true, value: await fn(window.__game, window.__harness) }; }
    catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
  }, { code: pose, cfg: framing });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${outDir}/${framing.name}.png` });
  console.log(`captured ${outDir}/${framing.name}.png ${JSON.stringify(result)}`);
}

await browser.close();
