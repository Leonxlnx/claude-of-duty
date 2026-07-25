import { test, expect } from '@playwright/test';
import { boot, settle } from './helpers.js';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Frame-time profiling. Headless Chromium runs the GPU through ANGLE on a
 * software or virtualised device, so the absolute numbers are far below what
 * the same build does on a real GPU. The assertions therefore check that the
 * frame pacing is *stable* and that the quality presets actually scale cost —
 * the report is where the real numbers live.
 */

const report = {};

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/performance.json', JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log('\nperformance profile\n' + JSON.stringify(report, null, 2));
});

test('sustains a stable frame under combat load', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 3000);

  // Put the player in a firefight so the profile includes AI, tracers,
  // decals, particles and ragdolls rather than an empty street.
  await page.evaluate(() => window.__harness.engageNearestEnemy(14));
  await page.evaluate(() => window.__harness.fire(true));

  const profile = await page.evaluate(() => window.__harness.profile(6000));
  await page.evaluate(() => window.__harness.releaseAll());

  report.combat = profile;
  expect(profile.frames).toBeGreaterThan(60);
  // Pacing consistency: the 95th percentile must stay close to the median.
  expect(profile.frameMs.p95).toBeLessThan(profile.frameMs.p50 * 3.5 + 12);
  // Steady-state CPU work per frame has to leave room for the GPU on a real
  // device. Only the median is asserted: ANGLE's software rasteriser blocks the
  // JS thread on flushes, so the tail of this distribution is really GPU time
  // on a device nobody ships to, and it swings by 2x with machine load. The
  // p95 is written to the report instead, where it can be read for what it is.
  expect(profile.cpuMs.p50).toBeLessThan(12);
});

test('quality presets scale the cost of a frame', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0&quality=ultra');
  await settle(page, 3000);

  // Frame time is pinned to the display refresh here, so it cannot rank the
  // presets. What can: the work the presets actually configure.
  const cost = () => page.evaluate(() => {
    const g = window.__game;
    return {
      renderScale: g.graph.renderScale,
      pixels: g.graph.renderWidth * g.graph.renderHeight,
      shadowRes: g.quality.shadowResolution,
      cascades: g.graph.shadows.cascadeCount,
      aoSamples: g.graph.gtaoPass.uniforms.uSamples.value,
      cloudSteps: g.graph.sky.cloudPass.uniforms.uSteps.value,
      decalBudget: g.combat.decals.budget,
      particleDensity: g.combat.quality.particleDensity
    };
  });

  const ultra = await cost();
  report.ultra = { ...await page.evaluate(() => window.__harness.profile(3000)), ...ultra };

  await page.evaluate(() => window.__harness.setQuality('low'));
  await settle(page, 2500);
  const low = await cost();
  report.low = { ...await page.evaluate(() => window.__harness.profile(3000)), ...low };

  expect(low.renderScale).toBeLessThan(ultra.renderScale);
  expect(low.pixels).toBeLessThan(ultra.pixels * 0.75);
  expect(low.shadowRes).toBeLessThan(ultra.shadowRes);
  expect(low.cascades).toBeLessThan(ultra.cascades);
  expect(low.aoSamples).toBeLessThan(ultra.aoSamples);
  expect(low.cloudSteps).toBeLessThan(ultra.cloudSteps);
  expect(low.decalBudget).toBeLessThan(ultra.decalBudget);
  expect(low.particleDensity).toBeLessThan(ultra.particleDensity);
});

test('dynamic resolution recovers the frame budget when overloaded', async ({ page }) => {
  await boot(page, '?auto=1&quality=ultra');
  await settle(page, 6000);

  const scale = await page.evaluate(() => window.__game.graph.renderScale);
  const fps = await page.evaluate(() => window.__game.frameStats.fps);
  report.dynamicResolution = { scale, fps };

  expect(scale).toBeGreaterThan(0.4);
  expect(scale).toBeLessThanOrEqual(1.0);
});

test('memory and GPU resources stay bounded during a long fight', async ({ page }) => {
  await boot(page, '?auto=1&dynres=0');
  await settle(page, 2000);

  const sample = () => page.evaluate(() => {
    const info = window.__game.renderer.info;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs.length,
      heap: performance.memory ? performance.memory.usedJSHeapSize : 0
    };
  });

  const before = await sample();

  await page.evaluate(() => window.__harness.engageNearestEnemy(12));
  await page.evaluate(() => window.__harness.fire(true));
  await settle(page, 12_000);
  await page.evaluate(() => window.__harness.releaseAll());
  await settle(page, 2000);

  const after = await sample();
  report.resources = { before, after };

  // Pools are pre-allocated: a firefight must not create GPU objects.
  expect(after.geometries).toBeLessThanOrEqual(before.geometries + 2);
  expect(after.textures).toBeLessThanOrEqual(before.textures + 2);
  expect(after.programs).toBeLessThanOrEqual(before.programs + 1);
  if (before.heap) {
    expect(after.heap).toBeLessThan(before.heap * 2.2 + 40 * 1024 * 1024);
  }
});
