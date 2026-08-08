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
  test('deploys the opposition and runs the clock', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1500);

    const a = await snapshot(page);
    expect(a.state).toBe('playing');
    expect(a.player.alive).toBe(true);
    // One side only — the player has no squad, so every agent is hostile.
    expect(a.ai.aliveA).toBe(0);
    expect(a.ai.aliveB).toBeGreaterThanOrEqual(5);
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

  /**
   * Losing the mouse stops the match, and nothing takes it back on its own.
   *
   * This is the regression guard for the cursor trap. The handler existed for
   * a long time under a property name `Input` never called, so the lock could
   * end — Escape, alt-tab, a notification — and the game would carry on in
   * 'playing' with no menu, where the old canvas mousedown listener grabbed
   * the mouse again on the next click. Asserting the state is not enough: the
   * point is that the wiring between the two objects is live, so this drives
   * the real DOM event that the browser fires.
   */
  test('losing pointer lock pauses, and a click does not take the mouse back', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1200);
    expect((await snapshot(page)).state).toBe('playing');

    // The game refuses pointer lock under automation on purpose — headless
    // Chromium still applies the OS cursor clip, which pens the developer's
    // real desktop cursor into the viewport rectangle. So the held lock is
    // staged, and then the browser's own event is dispatched: what is under
    // test is that Input hears it and Game acts on it, which is the wiring
    // that was broken.
    await page.evaluate(() => { window.__game.input.locked = true; });
    await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));
    await settle(page, 600);
    expect((await snapshot(page)).state).toBe('paused');
    await expect(page.locator('#menu')).toBeVisible();

    // A stray click on the game must not re-acquire anything.
    let requested = 0;
    await page.exposeFunction('__lockRequested', () => { requested++; });
    await page.evaluate(() => {
      const canvas = document.getElementById('scene');
      const real = canvas.requestPointerLock.bind(canvas);
      canvas.requestPointerLock = (...a) => { window.__lockRequested(); return real(...a); };
    });
    await page.locator('#scene').click({ position: { x: 40, y: 40 }, force: true });
    await settle(page, 400);
    expect(requested, 'a click on the canvas asked for the mouse back').toBe(0);
    expect((await snapshot(page)).state).toBe('paused');
  });

  /**
   * No default bind hands a key to the browser.
   *
   * Crouch was Ctrl and forward is W, so crouch-walking forward pressed
   * Ctrl+W and the tab closed mid-match. A page cannot prevent that: the
   * browser reserves it and the keydown never reaches the document. The only
   * real fix is not to bind the modifier, and a stored profile from before the
   * change has to be migrated too, or the player keeps the old bind forever.
   */
  test('no default keybind collides with a browser shortcut', async ({ page }) => {
    await boot(page);

    const state = await page.evaluate(() => ({
      binds: window.__settings.data.keybinds,
      capture: window.__settings.data.captureShortcuts
    }));
    // Capture is off by default, so nothing may sit under a modifier the
    // browser will eat before the game sees it.
    expect(state.capture).not.toBe(true);
    const reserved = ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight'];
    for (const [action, code] of Object.entries(state.binds)) {
      expect(reserved, `${action} is bound to a browser-reserved modifier`).not.toContain(code);
    }

    // And a profile saved with the old bind is repaired on load rather than
    // spread back over the defaults.
    const migrated = await page.evaluate(() => {
      // The literal key: nothing is written until a setting changes, so
      // searching localStorage finds nothing on a fresh profile and the write
      // lands under "undefined" — which makes the assertion below pass
      // whatever the migration does.
      const key = 'dust-corridor.settings.v3';
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      stored.keybinds = { ...(stored.keybinds || {}), crouch: 'ControlLeft' };
      localStorage.setItem(key, JSON.stringify(stored));
      window.__settings.load();
      return window.__settings.data.keybinds.crouch;
    });
    expect(migrated, 'a stored Ctrl crouch survived a reload').not.toBe('ControlLeft');

    // But with shortcut capture on, Ctrl is the game's — the migration must
    // leave the player's deliberate choice alone rather than undoing it on
    // every load.
    const kept = await page.evaluate(() => {
      // The literal key: nothing is written until a setting changes, so
      // searching localStorage finds nothing on a fresh profile and the write
      // lands under "undefined" — which makes the assertion below pass
      // whatever the migration does.
      const key = 'dust-corridor.settings.v3';
      const stored = JSON.parse(localStorage.getItem(key) || '{}');
      stored.captureShortcuts = true;
      stored.keybinds = { ...(stored.keybinds || {}), crouch: 'ControlLeft' };
      localStorage.setItem(key, JSON.stringify(stored));
      window.__settings.load();
      return window.__settings.data.keybinds.crouch;
    });
    expect(kept, 'capture was on and the Ctrl bind was stripped anyway').toBe('ControlLeft');
  });

  /**
   * Every control, once, watching for exceptions.
   *
   * A throw inside the render callback aborts the frame silently: the canvas
   * keeps showing whatever was last drawn, so a dozen unrelated assertions
   * about brightness and shadows fail instead, and none of them mention the
   * actual fault. One undefined variable on a branch only a sprint reaches
   * cost an afternoon of chasing exposure numbers. This walks the states that
   * have their own code paths so the next one fails here, by name.
   */
  test('no state throws, and the frame keeps advancing', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1200);

    const drawn = await page.evaluate(async () => {
      const h = window.__harness, g = window.__game;
      const wait = (s) => h.wait(s);
      const hold = async (keys, s) => {
        for (const k of keys) h.key(k, true);
        await wait(s);
        h.releaseAll();
      };

      await hold(['KeyW'], 0.35);
      await hold(['KeyW', 'ShiftLeft'], 0.7);        // sprint
      await hold(['KeyW', 'ShiftLeft', 'KeyC'], 0.6); // slide out of a sprint
      await hold(['Space'], 0.5);                    // airborne
      await hold(['KeyC', 'KeyW'], 0.35);     // crouch-walk
      await hold(['KeyQ'], 0.3);                     // peek

      h.fire(true); await wait(0.3); h.fire(false);
      h.ads(true); await wait(0.4);
      h.fire(true); await wait(0.2); h.fire(false);
      h.ads(false);
      await h.tap('KeyR'); await wait(0.6);   // reload
      await h.tap('KeyF'); await wait(0.4);   // inspect
      await h.tap('KeyV');                    // fire selector

      await h.tap('KeyB'); await wait(0.5);   // grenade out
      h.fire(true); await wait(0.7); h.fire(false);
      await wait(1.4);                        // throw, rifle back, detonation

      // Counts actual draw calls, so it stalls if the render callback throws
      // even though the fixed-step simulation carries on regardless.
      const before = g.renderer.info.render.frame;
      await wait(0.5);
      return { drew: g.renderer.info.render.frame - before, alive: g.player.alive };
    });

    expect(drawn.drew).toBeGreaterThan(5);
    session.assertClean();
  });
});
