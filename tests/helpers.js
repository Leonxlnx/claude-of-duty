import { expect } from '@playwright/test';

/** Boot the game and wait until every subsystem has finished warming up. */
export async function boot(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(`/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 150_000 });
  await page.waitForFunction(() => typeof window.__harness === 'object');
  return {
    errors,
    /** Fail on anything that is a real fault, ignoring headless-only noise. */
    assertClean() {
      const real = errors.filter((e) => !IGNORED.some((p) => e.includes(p)));
      expect(real, `page errors:\n${real.join('\n')}`).toEqual([]);
    }
  };
}

/** Everything a headless run cannot provide and the game degrades around. */
const IGNORED = [
  'user gesture is required',
  'Pointer Lock',
  'AudioContext was not allowed to start',
  'The AudioContext was not allowed'
];

export const call = (page, fn, ...args) =>
  page.evaluate(({ body, a }) => {
    // eslint-disable-next-line no-new-func
    return new Function('h', 'a', `return (${body})(h, ...a);`)(window.__harness, a);
  }, { body: fn.toString(), a: args });

export const snapshot = (page) => page.evaluate(() => window.__harness.snapshot());

/**
 * Stop the AI from killing the player for the rest of the test.
 *
 * Tests that audit ammunition accounting fire long bursts in the open, which
 * reliably draws return fire. Dying mid-burst refills the magazine and the
 * reserve from the respawn, so the assertion silently ends up measuring the
 * respawn instead of the reload. Spawn protection already gates all incoming
 * damage; this just never lets it run out.
 */
export const makeInvulnerable = (page) =>
  page.evaluate(() => { window.__game.player.spawnProtect = 1e9; });

export const settle = (page, ms) => page.waitForTimeout(ms);
