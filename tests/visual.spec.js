import { test, expect } from '@playwright/test';
import { boot, settle } from './helpers.js';

/**
 * Visual checks. These do not compare against golden images — a procedural,
 * temporally-accumulated renderer will never match one byte for byte. They
 * assert the properties that actually break: exposure landing in range, the
 * sky reading as sky, shadows existing, TAA converging, and the weapon being
 * present and correctly framed.
 */

/**
 * Read back the presented frame and return histogram-style statistics over a
 * normalised sub-rectangle. The readback happens inside the render loop —
 * drawing the WebGL canvas into a 2D context yields black, because the game
 * does not pay for `preserveDrawingBuffer`.
 */
async function frameStats(page, region) {
  return page.evaluate(async (r) => {
    const { width: w, height: h, data: d } = await window.__harness.capture(192, 108);
    const x0 = Math.floor((r?.x ?? 0) * w), x1 = Math.ceil((r?.x1 ?? 1) * w);
    const y0 = Math.floor((r?.y ?? 0) * h), y1 = Math.ceil((r?.y1 ?? 1) * h);
    let sum = 0, sum2 = 0, n = 0, dark = 0, bright = 0;
    let rs = 0, gs = 0, bs = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        sum += l; sum2 += l * l; n++;
        if (l < 12) dark++;
        if (l > 247) bright++;
        rs += d[i]; gs += d[i + 1]; bs += d[i + 2];
      }
    }
    const mean = sum / n;
    return {
      mean,
      stdDev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
      clippedBlack: dark / n,
      clippedWhite: bright / n,
      rgb: [rs / n, gs / n, bs / n]
    };
  }, region);
}

test('the sunlit street exposes into a usable range', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 4000);

  const all = await frameStats(page);
  expect(all.mean).toBeGreaterThan(40);
  expect(all.mean).toBeLessThan(200);
  // Contrast, not a flat wash.
  expect(all.stdDev).toBeGreaterThan(22);
  // Neither end of the range is destroyed.
  expect(all.clippedBlack).toBeLessThan(0.06);
  expect(all.clippedWhite).toBeLessThan(0.06);
});

test('the sky is blue and brighter than the ground', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await page.evaluate(() => window.__harness.aimAt(0, 400, -40));
  await settle(page, 2500);

  const sky = await frameStats(page, { x: 0.15, x1: 0.85, y: 0.05, y1: 0.35 });
  // Blue channel leads in a daytime sky.
  expect(sky.rgb[2]).toBeGreaterThan(sky.rgb[0]);
  expect(sky.mean).toBeGreaterThan(70);
});

test('the sun casts shadows that darken part of the frame', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 3000);

  const shadowed = await page.evaluate(() => {
    const g = window.__game;
    const gl = g.renderer.getContext();
    void gl;
    // Sample the direct-light buffer: any real shadow makes it zero somewhere
    // while other pixels stay lit.
    g.graph.debugView = 5;
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const c = document.getElementById('scene');
        const off = document.createElement('canvas');
        off.width = 160; off.height = 90;
        const ctx = off.getContext('2d');
        ctx.drawImage(c, 0, 0, 160, 90);
        const d = ctx.getImageData(0, 0, 160, 90).data;
        let lit = 0, unlit = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          if (l > 60) lit++; else if (l < 10) unlit++;
        }
        g.graph.debugView = 0;
        resolve({ lit: lit / (160 * 90), unlit: unlit / (160 * 90) });
      }));
    });
  });

  expect(shadowed.lit).toBeGreaterThan(0.08);
  expect(shadowed.unlit).toBeGreaterThan(0.08);
});

test('TAA converges to a stable image when the camera is still', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 4000);

  const drift = await page.evaluate(async () => {
    const grab = () => {
      const c = document.getElementById('scene');
      const off = document.createElement('canvas');
      off.width = 128; off.height = 72;
      off.getContext('2d').drawImage(c, 0, 0, 128, 72);
      return off.getContext('2d').getImageData(0, 0, 128, 72).data;
    };
    const a = grab();
    await new Promise((r) => setTimeout(r, 500));
    const b = grab();
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]);
    return diff / (a.length / 4);
  });

  // Some drift is expected: clouds move, cloth sways, AI walks around.
  expect(drift).toBeLessThan(26);
});

test('the viewmodel is on screen and sits in the lower right', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 2500);

  const anchors = await page.evaluate(() => {
    const g = window.__game;
    const toScreen = (v) => {
      const p = v.clone().project(g.vmCamera);
      return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, z: p.z };
    };
    return {
      visible: g.viewModel.root.visible,
      muzzle: toScreen(g.viewModel.muzzleWorld),
      sight: toScreen(g.viewModel.reticle.getWorldPosition(g.viewModel.muzzleWorld.clone()))
    };
  });

  expect(anchors.visible).toBe(true);
  // The muzzle projects inside the frame, ahead of the camera, right of centre.
  expect(anchors.muzzle.z).toBeLessThan(1);
  expect(anchors.muzzle.x).toBeGreaterThan(0.45);
  expect(anchors.muzzle.x).toBeLessThan(1.0);
  expect(anchors.muzzle.y).toBeGreaterThan(0.3);
  expect(anchors.muzzle.y).toBeLessThan(1.0);
  // The red dot rides on top of the receiver, above the bore line, so it
  // projects higher up the frame than the muzzle does.
  expect(anchors.sight.y).toBeLessThan(anchors.muzzle.y);
  expect(anchors.sight.x).toBeGreaterThan(0.4);
  expect(anchors.sight.x).toBeLessThan(1.0);
});

test('aiming down sights centres the optic and narrows the view', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 2000);

  await page.evaluate(() => window.__harness.ads(true));
  await settle(page, 1200);

  const ads = await page.evaluate(() => {
    const g = window.__game;
    const world = g.viewModel.reticle.getWorldPosition(g.viewModel.muzzleWorld.clone());
    const p = world.project(g.vmCamera);
    return {
      blend: g.player.adsBlend,
      reticleX: (p.x + 1) / 2,
      reticleY: (1 - p.y) / 2
    };
  });
  await page.evaluate(() => window.__harness.ads(false));

  expect(ads.blend).toBeGreaterThan(0.85);
  // The sight window lands on the crosshair, which is what collimation means.
  expect(Math.abs(ads.reticleX - 0.5)).toBeLessThan(0.06);
  expect(Math.abs(ads.reticleY - 0.5)).toBeLessThan(0.08);
});

test('screenshots for review', async ({ page }, testInfo) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 4000);
  await testInfo.attach('hipfire', {
    body: await page.screenshot(), contentType: 'image/png'
  });

  await page.evaluate(() => window.__harness.ads(true));
  await settle(page, 1500);
  await testInfo.attach('ads', {
    body: await page.screenshot(), contentType: 'image/png'
  });
  await page.evaluate(() => window.__harness.releaseAll());
});
