import { test, expect } from '@playwright/test';
import { boot, snapshot, settle } from './helpers.js';

test.describe('movement', () => {
  test('walking moves the player and collision keeps them grounded', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1200);

    const before = await snapshot(page);
    await page.evaluate(() => window.__harness.key('KeyW', true));
    await settle(page, 1400);
    await page.evaluate(() => window.__harness.releaseAll());
    await settle(page, 300);
    const after = await snapshot(page);

    const dx = after.player.position[0] - before.player.position[0];
    const dz = after.player.position[2] - before.player.position[2];
    const travelled = Math.hypot(dx, dz);

    expect(travelled).toBeGreaterThan(1.5);
    expect(travelled).toBeLessThan(14);
    // Never falls through the map, never climbs a wall.
    expect(after.player.position[1]).toBeGreaterThan(-2);
    expect(after.player.position[1]).toBeLessThan(12);
    session.assertClean();
  });

  test('crouch lowers the eye and jump leaves the ground', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1200);

    const eyeOf = () => page.evaluate(() => window.__game.player.eye.y);
    const standing = await eyeOf();

    await page.evaluate(() => window.__harness.key('ControlLeft', true));
    await settle(page, 700);
    const crouched = await eyeOf();
    expect(standing - crouched).toBeGreaterThan(0.3);

    await page.evaluate(() => window.__harness.releaseAll());
    await settle(page, 700);

    await page.evaluate(() => window.__harness.key('Space', true));
    await settle(page, 200);
    const airborne = await page.evaluate(() => window.__game.player.controller.grounded);
    await page.evaluate(() => window.__harness.releaseAll());
    expect(airborne).toBe(false);
  });
});

test.describe('gunplay', () => {
  test('firing consumes ammo, spawns effects and reloads', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1500);

    await page.evaluate(() => window.__harness.fire(true));
    await settle(page, 700);
    await page.evaluate(() => window.__harness.fire(false));
    await settle(page, 400);

    const fired = await snapshot(page);
    expect(fired.weapon.ammo).toBeLessThan(30);
    expect(fired.weapon.ammo).toBeGreaterThan(0);
    expect(fired.fx.decals + fired.fx.particles).toBeGreaterThan(0);

    // Dump the magazine, then confirm the reload restores it from reserve.
    await page.evaluate(() => window.__harness.fire(true));
    await page.waitForFunction(() => window.__game.weapon.ammo === 0, { timeout: 20_000 });
    await page.evaluate(() => window.__harness.fire(false));

    await page.evaluate(() => window.__harness.key('KeyR', true));
    await settle(page, 120);
    await page.evaluate(() => window.__harness.key('KeyR', false));
    await page.waitForFunction(() => window.__game.weapon.ammo > 0, { timeout: 20_000 });

    const reloaded = await snapshot(page);
    expect(reloaded.weapon.ammo).toBe(30);
    expect(reloaded.weapon.reserve).toBeLessThan(fired.weapon.reserve);
    session.assertClean();
  });

  test('a traced shot damages the thing it is pointed at', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    // Walk the whole path a real shot takes: stand the player in front of an
    // enemy, aim, hold the trigger, and read the victim's health back.
    const engaged = await page.evaluate(() => window.__harness.engageNearestEnemy(11));
    if (!engaged) test.skip(true, 'no living enemy to shoot');
    await settle(page, 200);

    // Enemies keep moving, so a single aim goes stale within a few rounds.
    // Re-aim across the burst the way a player tracking a target would.
    const before = await page.evaluate(() => {
      const g = window.__game;
      const health = {};
      for (const c of g.director.characters) if (c.team === 'B') health[c.name] = c.health;
      return { health, score: g.match.scores.A };
    });

    await page.evaluate(async () => {
      const h = window.__harness;
      h.fire(true);
      for (let i = 0; i < 10; i++) {
        h.aimAtEnemy();
        await new Promise((r) => setTimeout(r, 50));
      }
      h.fire(false);
    });
    await settle(page, 300);

    const after = await page.evaluate((prev) => {
      const g = window.__game;
      const damaged = g.director.characters.some(
        (c) => c.team === 'B' && prev.health[c.name] !== undefined && (!c.alive || c.health < prev.health[c.name])
      );
      return { damaged, shots: g.combat.shotsFired, score: g.match.scores.A };
    }, before);

    expect(after.shots).toBeGreaterThan(0);
    expect(after.damaged || after.score > before.score).toBe(true);
  });

  test('killing an enemy scores a point and feeds the killfeed', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const before = await snapshot(page);

    // Keep engaging and firing until someone drops or the attempts run out.
    for (let attempt = 0; attempt < 6; attempt++) {
      const done = await page.evaluate(async () => {
        const h = window.__harness;
        const g = window.__game;
        if (!h.engageNearestEnemy(9)) return true;
        h.aimAtEnemy();
        g.weapon.ammo = g.weapon.spec.magSize;
        h.fire(true);
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 50));
          h.aimAtEnemy();
        }
        h.fire(false);
        return g.match.scores.A > 0;
      });
      if (done) break;
      await settle(page, 200);
    }
    await settle(page, 600);

    const after = await snapshot(page);
    expect(after.scores.A).toBeGreaterThan(before.scores.A);
    expect(after.ai.aliveB).toBeLessThan(before.ai.aliveB);
    await expect(page.locator('#killfeed .kill-entry').first()).toBeVisible();
  });

  test('a dead body ragdolls instead of freezing mid-pose', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const motion = await page.evaluate(async () => {
      const g = window.__game;
      const victim = window.__harness.nearestEnemy();
      victim.kill({ point: victim.position.clone(), direction: { x: 1, y: 0.1, z: 0 }, source: g.playerTarget });
      const start = victim.rig.joints[0].clone();
      await new Promise((r) => setTimeout(r, 900));
      return { moved: start.distanceTo(victim.rig.joints[0]), alive: victim.alive };
    });

    expect(motion.alive).toBe(false);
    expect(motion.moved).toBeGreaterThan(0.05);
  });
});

test.describe('damage and respawn', () => {
  test('the player takes damage, dies and redeploys', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1500);

    await page.evaluate(() => window.__game.player.applyDamage(45, null, 'bullet'));
    await settle(page, 200);
    const hurt = await snapshot(page);
    expect(hurt.player.health).toBeLessThan(100);
    expect(hurt.player.alive).toBe(true);

    await page.evaluate(() => window.__game.player.applyDamage(500, null, 'bullet'));
    await settle(page, 300);
    expect((await snapshot(page)).player.alive).toBe(false);

    await page.waitForFunction(() => window.__game.player.alive === true, { timeout: 30_000 });
    const respawned = await snapshot(page);
    expect(respawned.player.health).toBe(100);
    expect(respawned.weapon.ammo).toBe(30);
    session.assertClean();
  });
});

test.describe('AI', () => {
  test('agents patrol, acquire the player and shoot back', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1200);

    const start = await page.evaluate(() => ({
      positions: window.__game.director.agents.map((a) => a.controller.position.toArray())
    }));

    // Stand in the open in front of the closest enemy and let them react.
    await page.evaluate(() => window.__harness.engageNearestEnemy(11));
    await settle(page, 6000);

    const observed = await page.evaluate((prev) => {
      const g = window.__game;
      const moved = g.director.agents.reduce((n, a, i) => {
        const p = prev.positions[i];
        if (!p) return n;
        const d = Math.hypot(a.controller.position.x - p[0], a.controller.position.z - p[2]);
        return n + (d > 1.0 ? 1 : 0);
      }, 0);
      return {
        moved,
        withTarget: g.director.agents.filter((a) => a.alive && a.target).length,
        states: [...new Set(g.director.agents.map((a) => a.state))],
        playerHealth: g.player.health,
        shotsFired: g.director.agents.reduce((n, a) => n + a.shotsFired, 0)
      };
    }, start);

    expect(observed.moved).toBeGreaterThan(0);
    expect(observed.withTarget).toBeGreaterThan(0);
    expect(observed.states.length).toBeGreaterThan(1);
    expect(observed.shotsFired).toBeGreaterThan(0);
  });

  test('pathfinding returns a connected route across the map', async ({ page }) => {
    await boot(page);

    const path = await page.evaluate(() => {
      const g = window.__game;
      const a = g.world.spawns.A[0], b = g.world.spawns.B[0];
      const out = g.nav.findPath(a.x, a.z, b.x, b.z, []);
      if (!out || !out.length) return null;
      let longest = 0;
      for (let i = 1; i < out.length; i++) {
        longest = Math.max(longest, Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z));
      }
      return {
        points: out.length,
        span: Math.hypot(out[out.length - 1].x - a.x, out[out.length - 1].z - a.z),
        straightLine: Math.hypot(b.x - a.x, b.z - a.z),
        longestHop: longest
      };
    });

    expect(path).not.toBeNull();
    expect(path.points).toBeGreaterThan(2);
    expect(path.span).toBeGreaterThan(path.straightLine * 0.75);
    // No teleporting between disconnected islands.
    expect(path.longestHop).toBeLessThan(12);
  });
});

test.describe('audio', () => {
  test('every sound is synthesised, with no files fetched', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));

    await boot(page, '?auto=1');
    await settle(page, 1500);
    await page.evaluate(() => window.__harness.fire(true));
    await settle(page, 600);
    await page.evaluate(() => window.__harness.releaseAll());

    const media = requests.filter((u) => /\.(mp3|ogg|wav|m4a|flac|aac|webm)(\?|$)/i.test(u));
    expect(media).toEqual([]);

    const audio = await page.evaluate(() => {
      const a = window.__game.audio;
      return { buffers: a.bufferCount, context: !!a.ctx, rate: a.ctx?.sampleRate ?? 0 };
    });
    expect(audio.context).toBe(true);
    expect(audio.buffers).toBeGreaterThan(10);
  });
});

test.describe('offline integrity', () => {
  test('the build fetches nothing beyond its own three files', async ({ page }) => {
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));

    await boot(page, '?auto=1');
    await settle(page, 4000);
    await page.evaluate(() => window.__harness.fire(true));
    await settle(page, 1500);
    await page.evaluate(() => window.__harness.releaseAll());

    const origin = new URL(page.url()).origin;
    const external = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(external).toEqual([]);

    // Everything the game needs is generated at runtime, so the only things it
    // may ever ask the server for are the document, the script and the sheet.
    const local = requests
      .filter((u) => u.startsWith(origin))
      .map((u) => new URL(u).pathname)
      .filter((p) => !p.startsWith('/@'));       // vite dev-server plumbing
    for (const p of local) {
      expect(p).toMatch(/^\/(|index\.html|game\.js|game\.css|favicon\.ico)$/);
    }
  });
});
