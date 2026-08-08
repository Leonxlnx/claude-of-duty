import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * One street pose, photographed at every time of day.
 *
 *   node tools/tod-shots.mjs [outDir]
 *
 * The point is to compare them, so the camera never moves between shots and
 * only the sky preset changes.
 */
const outDir = process.argv[2] || 'shots/tod';
const port = process.env.PORT || 4319;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${port}/?auto=1&dynres=0&nomb`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, { timeout: 180000 });

const frames = (n) => page.evaluate((count) => new Promise((resolve) => {
  let seen = 0;
  const tick = () => (++seen >= count ? resolve(seen) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);

await page.evaluate(async () => {
  const h = window.__harness, g = window.__game;
  h.setQuality('ultra');
  h.setSetting('dynres', false);
  h.setSetting('showFps', false);
  g.hud.setVisible(false);
  g.graph.setRenderScale?.(1);
  g.player.spawnProtect = 1e9;
  h.freezeAI(true);
  const lane = g.world.map?.marketLane ?? [-18, 18];
  const z = (lane[0] + lane[1]) * 0.5;
  const y = g.world.groundAt(0.4, z);
  h.teleport(0.4, y + 0.1, z);
  g.playerTarget.sync();
  h.aimAt(0.4, y + 1.55, z - 40);
});
await frames(30);

for (const tod of ['dawn', 'morning', 'day', 'sunset', 'night']) {
  await page.evaluate((t) => window.__harness.setSetting('timeOfDay', t), tod);
  // The exposure meter adapts over time and the bake changes the ambient, so
  // this needs real frames, not a fixed sleep — and enough of them. Crossing
  // several stops between day and night takes the meter a couple of seconds,
  // and a shot taken mid-adaptation shows the previous time of day.
  await frames(220);
  await page.screenshot({ path: `${outDir}/${tod}.png` });
  console.log(`captured ${outDir}/${tod}.png`);
}

await browser.close();
