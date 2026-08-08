import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * The gauntlet's evidence pass: boot the game once and photograph it from a
 * fixed set of poses, so a critic with fresh context can judge the real pixels
 * rather than a description of them.
 *
 *   node tools/gauntlet-shots.mjs [outDir]
 *
 * One boot for the whole set — under a software rasteriser booting is the
 * expensive part, and a critic wants consistency between shots anyway.
 */
const outDir = process.argv[2] || 'shots/gauntlet';
const port = process.env.PORT || 4319;
mkdirSync(outDir, { recursive: true });

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

// Full resolution, highest preset: judge the game, not the test rig.
await page.evaluate(async () => {
  const h = window.__harness, g = window.__game;
  h.setQuality('ultra');
  h.setSetting('dynres', false);
  g.graph.setRenderScale?.(1);
  g.player.spawnProtect = 1e9;
  await new Promise((r) => setTimeout(r, 600));
});

/** Teleport, face something, let the springs settle, photograph. */
const POSES = {
  'street': async (g, h) => {
    const lane = g.world.map?.marketLane ?? [-18, 18];
    const z = (lane[0] + lane[1]) * 0.5;
    const y = g.world.groundAt(0.4, z) + 0.1;
    h.teleport(0.4, y, z);
    g.playerTarget.sync();
    h.aimAt(0.4, y + 1.55, z - 40);
  },
  'ads': async (g, h) => {
    h.ads(true);
  },
  'plaza': async (g, h) => {
    h.ads(false);
    const az = g.world.map?.archZ ?? 30;
    const y = g.world.groundAt(0, az - 26) + 0.1;
    h.teleport(0, y, az - 26);
    g.playerTarget.sync();
    h.aimAt(0, y + 3.5, az + 10);
  },
  'alley': async (g, h) => {
    const y = g.world.groundAt(26.3, -20) + 0.1;
    h.teleport(26.3, y, -20);
    g.playerTarget.sync();
    h.aimAt(26.3, y + 1.5, 20);
  },
  'enemy': async (g, h) => {
    const e = h.nearestEnemy();
    if (!e) return;
    const p = e.position;
    const y = g.world.groundAt(p.x, p.z + 6) + 0.1;
    h.teleport(p.x, y, p.z + 6);
    g.playerTarget.sync();
    h.aimAt(p.x, p.y + 1.2, p.z);
  },
  'sky': async (g) => {
    g.player.pitch = 0.95;
    g.viewModel.root.visible = false;
  }
};

for (const [name, pose] of Object.entries(POSES)) {
  await page.evaluate(async (body) => {
    const fn = new Function('g', 'h', `return (async () => { ${body} })();`);
    await fn(window.__game, window.__harness);
  }, `await (${pose.toString()})(g, h);`);
  // Springs, TAA history and exposure all need real frames to settle.
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`captured ${outDir}/${name}.png`);
}

await browser.close();
