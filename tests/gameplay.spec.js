import { test, expect } from '@playwright/test';
import { boot, snapshot, settle, makeInvulnerable } from './helpers.js';

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
    // Loose upper bound: catches a teleport or a fall, not a tuning change.
    expect(travelled).toBeLessThan(20);
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

  test('a standing player does not shake', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    // Standing on flat ground the controller still falls a fraction of a
    // millimetre per step and gets snapped back. Feeding that into the eye
    // used to read as a constant tremor, so hold the eye to a tolerance far
    // below anything a player could notice.
    const jitter = await page.evaluate(async () => {
      const g = window.__game;
      window.__harness.releaseAll();
      await new Promise((r) => setTimeout(r, 800));

      const samples = [];
      const prev = g.onFrame;
      g.onFrame = () => samples.push(g.player.eye.y);
      await new Promise((r) => setTimeout(r, 1500));
      g.onFrame = prev;

      let maxStep = 0;
      for (let i = 1; i < samples.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
      }
      return { maxStep, range: Math.max(...samples) - Math.min(...samples), n: samples.length };
    });

    expect(jitter.n).toBeGreaterThan(20);
    expect(jitter.maxStep).toBeLessThan(0.001);
    expect(jitter.range).toBeLessThan(0.005);
  });

  test('peeking moves the eye sideways but not through a wall', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1200);

    const result = await page.evaluate(async () => {
      const g = window.__game;
      const p = g.player;
      const Vec = p.eye.constructor;
      const settleFor = (ms) => new Promise((r) => setTimeout(r, ms));

      // Somewhere open, so nothing clips the lean.
      const open = g.nav.randomPoint(g.rng, new Vec());
      p.controller.position.copy(open);
      p.controller.position.y += 0.1;
      p.yaw = 0;
      window.__harness.releaseAll();
      await settleFor(600);
      const centre = new Vec().copy(p.eye);

      window.__harness.key('KeyE', true);
      await settleFor(700);
      const right = new Vec().copy(p.eye);
      const rightRoll = p.viewRoll;
      window.__harness.releaseAll();
      await settleFor(700);

      window.__harness.key('KeyQ', true);
      await settleFor(700);
      const left = new Vec().copy(p.eye);
      const leftRoll = p.viewRoll;
      window.__harness.releaseAll();
      await settleFor(700);

      // Now put a wall off the right shoulder and ask again. No settle here:
      // the controller would immediately slide the capsule off the wall, and
      // the probe is a pure function of the current stance anyway.
      const body = new Vec().copy(p.controller.position);
      const dir = new Vec();
      const standoff = 0.40;
      let placed = false;
      for (let a = 0; a < 96; a++) {
        const ang = (a / 96) * Math.PI * 2;
        dir.set(Math.sin(ang), 0, Math.cos(ang));
        const hit = g.world.bvh.raycast(new Vec(body.x, body.y + p.eyeHeight, body.z), dir, 10);
        if (!hit.hit || hit.t < 2) continue;
        p.controller.position.x = body.x + dir.x * (hit.t - standoff);
        p.controller.position.z = body.z + dir.z * (hit.t - standoff);
        p.yaw = Math.atan2(-dir.x, -dir.z) + Math.PI / 2;
        placed = true;
        break;
      }

      const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      return {
        travelRight: flat(right, centre),
        travelLeft: flat(left, centre),
        rightRoll,
        leftRoll,
        placed,
        standoff,
        clampedIntoWall: placed ? p._allowedLean(1) : null,
        freeAwayFromWall: placed ? p._allowedLean(-1) : null
      };
    });

    // A peek has to actually clear a corner to be worth the key.
    expect(result.travelRight).toBeGreaterThan(0.3);
    expect(result.travelLeft).toBeGreaterThan(0.3);
    // Opposite keys roll the camera opposite ways.
    expect(result.rightRoll).toBeLessThan(-0.1);
    expect(result.leftRoll).toBeGreaterThan(0.1);

    // The eye is also the muzzle, so leaning through a wall would be shooting
    // through one. With the wall 0.40m off the shoulder the head may only
    // travel until it is one margin short of it, and the open side is free.
    expect(result.placed).toBe(true);
    expect(result.clampedIntoWall).toBeGreaterThan(0);
    expect(result.clampedIntoWall).toBeLessThan(0.6);
    expect(Math.abs(result.freeAwayFromWall)).toBeGreaterThan(0.9);
  });
});

test.describe('respawn', () => {
  test('redeploys scatter across the map and avoid enemy eyes', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 2500);

    const spread = await page.evaluate(() => {
      const g = window.__game;
      const Vec = g.player.eye.constructor;
      const picks = [];
      for (let i = 0; i < 20; i++) {
        const spot = g._pickRespawn();
        if (!spot) continue;
        let nearest = Infinity;
        for (const c of g.director.characters) {
          if (!c.alive || c.team === g.player.team) continue;
          nearest = Math.min(nearest, spot.distanceTo(c.position));
        }
        picks.push({ x: spot.x, z: spot.z, nearest });
      }
      const cells = new Set(picks.map((p) => `${Math.round(p.x / 10)},${Math.round(p.z / 10)}`));
      return {
        picked: picks.length,
        distinctAreas: cells.size,
        span: Math.max(...picks.map((p) => p.x)) - Math.min(...picks.map((p) => p.x)),
        closestEnemy: Math.min(...picks.map((p) => p.nearest))
      };
    });

    expect(spread.picked).toBeGreaterThan(15);
    // Coming back in the same doorway every time is the thing being fixed.
    expect(spread.distinctAreas).toBeGreaterThan(6);
    expect(spread.span).toBeGreaterThan(25);
    // And never on top of someone.
    expect(spread.closestEnemy).toBeGreaterThan(12);
  });
});

test.describe('gunplay', () => {
  test('firing consumes ammo, spawns effects and reloads', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1500);
    await makeInvulnerable(page);

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

  // A tapped key used to stay in the "pressed this frame" set for the rest of
  // the match, because nothing ever cleared it. One reload then re-triggered
  // itself the instant firing dropped the magazine below full, so the weapon
  // let exactly one round go and started reloading again, forever.
  test('a reload does not re-arm itself on the next shot', async ({ page }) => {
    const session = await boot(page, '?auto=1');
    await settle(page, 1500);
    await makeInvulnerable(page);

    await page.evaluate(async () => {
      const h = window.__harness;
      h.fire(true);
      await new Promise((r) => setTimeout(r, 500));
      h.fire(false);
    });
    await settle(page, 300);

    await page.evaluate(() => window.__harness.tap('KeyR'));
    await page.waitForFunction(() => window.__game.weapon.ammo === 30, { timeout: 20_000 });
    await settle(page, 300);

    // Hold the trigger until a burst has landed rather than for a fixed slice
    // of wall time: under a loaded headless run the simulation falls behind
    // real time, and counting shots per millisecond then measures the host
    // rather than the weapon.
    const shots = await page.evaluate(async () => {
      const w = window.__game.weapon;
      const before = w.totalShots;
      window.__harness.fire(true);

      const deadline = Date.now() + 10_000;
      let reArmed = false;
      while (Date.now() < deadline && w.totalShots - before < 6) {
        // Six rounds cannot empty a thirty round magazine, so any reload
        // starting here is the weapon re-arming itself — the actual bug.
        if (w.reloading) { reArmed = true; break; }
        await new Promise((r) => setTimeout(r, 25));
      }
      window.__harness.fire(false);
      await new Promise((r) => setTimeout(r, 200));
      return { fired: w.totalShots - before, reArmed, ammo: w.ammo };
    });

    expect(shots.reArmed).toBe(false);
    expect(shots.fired).toBeGreaterThanOrEqual(6);
    expect(shots.ammo).toBeLessThan(30);
    session.assertClean();
  });

  test('one tap of the fire selector advances exactly one mode', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1200);

    const modes = await page.evaluate(async () => {
      const seen = [window.__game.weapon.fireMode];
      for (let i = 0; i < 3; i++) {
        await window.__harness.tap('KeyB');
        await new Promise((r) => setTimeout(r, 220));
        seen.push(window.__game.weapon.fireMode);
      }
      return seen;
    });

    // The simulation takes several fixed substeps per frame; an edge that is
    // not consumed on read walks the selector through every mode per tap.
    expect(modes).toEqual([0, 1, 2, 0]);
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
