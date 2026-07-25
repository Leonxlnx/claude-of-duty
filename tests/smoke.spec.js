import { test, expect } from '@playwright/test';
import { boot, snapshot, settle } from './helpers.js';

test.describe('boot and menu', () => {
  test('starts clean, shows the menu and builds the world', async ({ page }) => {
    const session = await boot(page);

    const built = await page.evaluate(() => {
      const g = window.__game;
      return {
        state: g.state,
        webgl2: g.renderer.getContext() instanceof WebGL2RenderingContext,
        colliderTris: g.world.bvh.soup.count,
        navCells: g.nav.stats().walkable,
        spawnsA: g.world.spawns.A.length,
        spawnsB: g.world.spawns.B.length,
        materials: g.factory.materials.length,
        cascades: g.graph.shadows.cascadeCount
      };
    });

    expect(built.state).toBe('menu');
    expect(built.webgl2).toBe(true);
    expect(built.colliderTris).toBeGreaterThan(5000);
    expect(built.navCells).toBeGreaterThan(2000);
    expect(built.spawnsA).toBeGreaterThan(2);
    expect(built.spawnsB).toBeGreaterThan(2);
    expect(built.cascades).toBeGreaterThanOrEqual(3);

    await expect(page.locator('#menu')).toBeVisible();
    session.assertClean();
  });

  test('renders a lit frame rather than a blank canvas', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 2500);

    const stats = await page.evaluate(async () => {
      const { width: w, height: h, data: d } = await window.__harness.capture(160, 90);
      let sum = 0, min = 255, max = 0, coloured = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        sum += l; min = Math.min(min, l); max = Math.max(max, l);
        if (Math.abs(d[i] - d[i + 2]) > 8) coloured++;
      }
      return { mean: sum / (d.length / 4), min, max, coloured, pixels: w * h };
    });

    // A real frame has a wide dynamic range and is not monochrome.
    expect(stats.mean).toBeGreaterThan(25);
    expect(stats.mean).toBeLessThan(225);
    expect(stats.max - stats.min).toBeGreaterThan(70);
    expect(stats.coloured / stats.pixels).toBeGreaterThan(0.15);
  });
});

test.describe('match lifecycle', () => {
  test('deploys both teams and runs the clock', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1500);

    const a = await snapshot(page);
    expect(a.state).toBe('playing');
    expect(a.player.alive).toBe(true);
    expect(a.ai.aliveA + a.ai.aliveB).toBeGreaterThanOrEqual(6);
    expect(a.weapon.ammo).toBe(30);

    await settle(page, 2500);
    const b = await snapshot(page);
    expect(b.timeLeft).toBeLessThan(a.timeLeft);
    session.assertClean();
  });

  test('pause and resume gate the simulation', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1200);

    await page.evaluate(() => window.__harness.pause());
    const paused = await snapshot(page);
    expect(paused.state).toBe('paused');
    await expect(page.locator('#menu')).toBeVisible();

    await settle(page, 1200);
    const stillPaused = await snapshot(page);
    expect(Math.abs(stillPaused.timeLeft - paused.timeLeft)).toBeLessThan(0.05);

    await page.evaluate(() => window.__harness.resume());
    await settle(page, 800);
    expect((await snapshot(page)).state).toBe('playing');
  });
});
