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
    expect(travelled).toBeLessThan(30);
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

      // Collect a fixed number of frames rather than however many arrive in a
      // fixed wall-clock window: under a software rasteriser that was eight,
      // and the test then failed on its own sample count instead of measuring
      // anything about the eye.
      const samples = [];
      const prev = g.onFrame;
      g.onFrame = () => samples.push(g.player.eye.y);
      const deadline = performance.now() + 20000;
      while (samples.length < 40 && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      g.onFrame = prev;

      let maxStep = 0;
      for (let i = 1; i < samples.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
      }
      return { maxStep, range: Math.max(...samples) - Math.min(...samples), n: samples.length };
    });

    expect(jitter.n).toBeGreaterThanOrEqual(40);
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

test.describe('slide', () => {
  test('crouching out of a sprint carries speed and drops the head', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const run = await page.evaluate(async () => {
      const g = window.__game;
      const p = g.player;
      const h = window.__harness;
      const wait = (s) => h.wait(s);
      // The AI will happily end a ten-second experiment about running.
      p.spawnProtect = 1e9;

      // A slide needs a run-up, and where the player happens to spawn may not
      // have one — a run that ends against a market stall never gets near
      // sliding pace, and the test then reports a broken slide when the fault
      // is the spawn draw. The map is generated from a fixed seed, so start
      // from a fixed spot instead: the north end of the market lane, facing
      // south down the middle of the street. `clear` is asserted below so this
      // fails as "the lane is no longer clear" rather than "the slide broke"
      // if the generator ever puts something in the way.
      const START = { x: -0.5, z: 14 };
      const HEADING = 0;   // yaw 0 => forward is -Z, straight down the lane

      const Vec = p.eye.constructor;
      const dir = new Vec(-Math.sin(HEADING), 0, -Math.cos(HEADING));
      h.releaseAll();
      h.teleport(START.x, g.nav.heightAt(START.x, START.z) + 0.1, START.z);
      p.yaw = HEADING;
      p.pitch = 0;
      await wait(0.4);

      // Clearance down the run line, at ankle, waist and head height, offset
      // to both shoulders — the body is a capsule, not a ray.
      let clear = 60;
      for (const side of [-0.34, 0, 0.34]) {
        for (const hy of [0.35, 1.1, 1.7]) {
          const from = p.controller.position.clone();
          from.x += side * Math.cos(HEADING);
          from.z += -side * Math.sin(HEADING);
          from.y += hy;
          const hit = g.world.bvh.raycast(from, dir, 60);
          if (hit.hit) clear = Math.min(clear, hit.t);
        }
      }

      const standingEye = p.eye.y - p.controller.position.y;

      h.key('KeyW', true);
      h.key('ShiftLeft', true);
      await wait(1.2);
      const sprintSpeed = p.speed2D;

      // Read the boost where it is applied rather than by polling afterwards.
      // A slide bleeds off from the moment it starts and the run may already be
      // closing on a stall, so a sample taken a frame or two later can be below
      // the sprint it came out of while the mechanic worked perfectly.
      let entrySpeed = 0, priorSpeed = 0;
      p.onSlide = () => {
        priorSpeed = p.speed2D;
        entrySpeed = Math.hypot(p.controller.velocity.x, p.controller.velocity.z);
      };

      h.key('KeyC', true);
      let sliding = false, lowestEye = Infinity;
      for (let i = 0; i < 16; i++) {
        await wait(0.04);
        if (p.sliding) sliding = true;
        lowestEye = Math.min(lowestEye, p.eye.y - p.controller.position.y);
      }
      p.onSlide = null;

      h.releaseAll();
      await wait(1.4);
      return {
        sprintSpeed, entrySpeed, priorSpeed, sliding, standingEye, lowestEye, clear,
        endedCleanly: !p.sliding,
        settledSpeed: p.speed2D
      };
    });

    // First: the run-up is what the test thinks it is. Everything below reads
    // as a broken slide when it is really a blocked lane, so say so here.
    expect(run.clear, 'market lane run-up is obstructed').toBeGreaterThan(25);

    // A slide is only worth the key if it buys pace over the sprint it costs.
    expect(run.sliding).toBe(true);
    expect(run.sprintSpeed).toBeGreaterThan(6);
    expect(run.entrySpeed).toBeGreaterThan(run.priorSpeed * 1.15);
    // And it has to put the head down, or it is just running.
    expect(run.standingEye - run.lowestEye).toBeGreaterThan(0.3);
    // It ends on its own rather than becoming a permanent movement mode.
    expect(run.endedCleanly).toBe(true);
    expect(run.settledSpeed).toBeLessThan(1);
  });

  test('a slide cannot be started from a standstill', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const still = await page.evaluate(async () => {
      const p = window.__game.player;
      const h = window.__harness;
      h.releaseAll();
      await h.wait(0.5);
      h.key('KeyC', true);
      await h.wait(0.4);
      const state = { sliding: p.sliding, crouched: p.crouched };
      h.releaseAll();
      return state;
    });

    expect(still.sliding).toBe(false);
    // The key is still a crouch, it just does not launch anything.
    expect(still.crouched).toBe(true);
  });
});

test.describe('grenades', () => {
  test('B takes one out, B again puts it away, and nothing is spent', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const cycle = await page.evaluate(async () => {
      const g = window.__game;
      const h = window.__harness;
      const wait = (s) => h.wait(s);
      g.player.spawnProtect = 1e9;
      const before = g.grenades.count;

      await h.tap('KeyB');
      await wait(0.5);
      const out = { equipped: g.grenades.equipped, count: g.grenades.count };

      await h.tap('KeyB');
      await wait(0.6);
      return {
        before, out,
        stowed: !g.grenades.equipped,
        after: g.grenades.count,
        live: g.combat.liveGrenades.length
      };
    });

    expect(cycle.out.equipped).toBe(true);
    expect(cycle.out.count).toBe(cycle.before);
    // Backing out is free — that is what makes committing to a throw reasonable.
    expect(cycle.stowed).toBe(true);
    expect(cycle.after).toBe(cycle.before);
    expect(cycle.live).toBe(0);
  });

  test('holding fire charges the throw and releasing sends it further', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const thrown = await page.evaluate(async () => {
      const g = window.__game;
      const h = window.__harness;
      const wait = (s) => h.wait(s);

      // Somewhere with room to throw, looking at the horizon.
      g.player.pitch = 0;
      g.player.spawnProtect = 1e9;
      h.releaseAll();
      await wait(0.3);

      const measure = async (hold) => {
        await h.tap('KeyB');
        await wait(0.45);
        h.fire(true);
        await wait(hold);
        const charge = g.grenades.charge;
        h.fire(false);
        await wait(0.25);
        const live = g.combat.liveGrenades;
        const speed = live.length
          ? Math.hypot(live[live.length - 1].body.velocity.x, live[live.length - 1].body.velocity.z)
          : 0;
        // The throw animation and the rifle coming back take about seven
        // tenths; B is deliberately ignored until that has finished.
        await wait(0.9);
        return { charge, speed, count: g.grenades.count };
      };

      const before = g.grenades.count;
      const light = await measure(0.06);
      const full = await measure(1.3);
      h.releaseAll();
      return { before, light, full };
    });

    // A tap throws it underarm, a held press winds up and sends it downrange.
    expect(thrown.light.charge).toBeLessThan(0.35);
    expect(thrown.full.charge).toBeGreaterThan(0.9);
    expect(thrown.full.speed).toBeGreaterThan(thrown.light.speed + 5);
    // Each throw costs exactly one grenade.
    expect(thrown.light.count).toBe(thrown.before - 1);
    expect(thrown.full.count).toBe(thrown.before - 2);
  });

  test('a grenade goes off on its fuse and hurts what is next to it', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const blast = await page.evaluate(async () => {
      const g = window.__game;
      const Vec = g.player.eye.constructor;
      const victim = g.director.agents.find((a) => a.alive);
      if (!victim) return null;

      const health = victim.character.health;
      const at = new Vec().copy(victim.controller.position);
      at.y += 0.9;

      g.combat.detonate(at, null, 'A');
      await new Promise((r) => setTimeout(r, 200));

      // And a body the far side of a wall is not hurt by the same blast.
      const shielded = g.director.agents.find(
        (a) => a.alive && a !== victim
          && g.world.bvh.occluded(at, new Vec().copy(a.controller.position).setY(a.controller.position.y + 0.9))
      );

      return {
        damaged: health - victim.character.health,
        shieldedUnhurt: shielded ? shielded.character.health : null
      };
    });

    if (!blast) test.skip(true, 'no living enemy to blow up');
    expect(blast.damaged).toBeGreaterThan(40);
    if (blast.shieldedUnhurt !== null) expect(blast.shieldedUnhurt).toBe(100);
  });

  test('the AI runs from a grenade landing at its feet', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 1500);

    const flee = await page.evaluate(async () => {
      const g = window.__game;
      const h = window.__harness;
      const Vec = g.player.eye.constructor;
      const victim = g.director.agents.find((a) => a.alive);
      if (!victim) return null;

      // Drop a live grenade next to them with most of the fuse left, thrown
      // gently downward so it stays put instead of rolling out of relevance.
      const at = new Vec().copy(victim.controller.position);
      const start = new Vec().copy(at); start.y += 1.4;
      g.combat.throwGrenade({
        position: start, velocity: new Vec(0, -1, 0),
        owner: g.playerTarget, team: 'A'
      });

      const before = { x: at.x, z: at.z };
      await h.wait(1.2);
      const p = victim.controller.position;
      return {
        fled: victim._fleeingGrenade || Math.hypot(p.x - before.x, p.z - before.z) > 2,
        distance: Math.hypot(p.x - before.x, p.z - before.z),
        alive: victim.alive
      };
    });

    if (!flee) test.skip(true, 'no living enemy to threaten');
    // Two seconds of fuse at a sprint should put real ground between them.
    expect(flee.fled).toBe(true);
    expect(flee.distance).toBeGreaterThan(1.5);
  });
});

test.describe('respawn', () => {
  test('redeploys scatter across the map and avoid enemy eyes', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 2500);

    const spread = await page.evaluate(() => {
      const g = window.__game;
      const Vec = g.player.eye.constructor;
      const up = new Vec(0, 1, 0);
      // Asked of the collision world and the generator's own footprints, not
      // of the navmesh's indoor flag. That flag was once computed by a test no
      // room could ever fail, so a check against it passed while redeploys
      // landed in bedrooms.
      const pb = g.world.playBounds;
      const rejected = (p) =>
        g.world.bvh.raycast(new Vec(p.x, p.y + 1.2, p.z), up, 5.5).hit
        || g.world.buildings.some((b) =>
          p.x > b.x0 - 0.4 && p.x < b.x1 + 0.4 && p.z > b.z0 - 0.4 && p.z < b.z1 + 0.4)
        || p.x < pb.x0 || p.x > pb.x1 || p.z < pb.z0 || p.z > pb.z1;

      const picks = [];
      let indoorPicks = 0;
      for (let i = 0; i < 20; i++) {
        const spot = g._pickRespawn();
        if (!spot) continue;
        let nearest = Infinity;
        for (const c of g.director.characters) {
          if (!c.alive || c.team === g.player.team) continue;
          nearest = Math.min(nearest, spot.distanceTo(c.position));
        }
        if (rejected(spot)) indoorPicks++;
        picks.push({ x: spot.x, z: spot.z, nearest });
      }
      const cells = new Set(picks.map((p) => `${Math.round(p.x / 10)},${Math.round(p.z / 10)}`));
      return {
        picked: picks.length,
        indoorPicks,
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
    // Materialising inside somebody's front room is disorienting and leaves
    // the AI walking into furniture, so every candidate is open ground.
    expect(spread.indoorPicks).toBe(0);
  });

  /**
   * The opening wave used to skip the navmesh entirely and take the map's
   * hand-placed spawn list, jittered a couple of metres with nothing checking
   * where that landed — so a match could begin with the player, or half the
   * opposition, standing in a building.
   */
  test('nobody starts the match indoors', async ({ page }) => {
    await boot(page, '?auto=1');
    await settle(page, 2000);

    const start = await page.evaluate(() => {
      const g = window.__game;
      const Vec = g.player.eye.constructor;
      const up = new Vec(0, 1, 0);
      const pb = g.world.playBounds;
      const roofed = (p) =>
        g.world.bvh.raycast(new Vec(p.x, p.y + 1.2, p.z), up, 5.5).hit
        || g.world.buildings.some((b) =>
          p.x > b.x0 - 0.4 && p.x < b.x1 + 0.4 && p.z > b.z0 - 0.4 && p.z < b.z1 + 0.4)
        || p.x < pb.x0 || p.x > pb.x1 || p.z < pb.z0 || p.z > pb.z1;

      return {
        player: roofed(g.player.controller.position),
        agents: g.director.agents.length,
        agentsRoofed: g.director.agents.filter((a) => roofed(a.controller.position)).length,
        // And not stacked on top of each other either.
        closestPair: g.director.agents.reduce((min, a, i) => {
          for (const b of g.director.agents.slice(i + 1)) {
            min = Math.min(min, a.controller.position.distanceTo(b.controller.position));
          }
          return min;
        }, Infinity)
      };
    });

    expect(start.player).toBe(false);
    expect(start.agents).toBeGreaterThan(4);
    expect(start.agentsRoofed).toBe(0);
    expect(start.closestPair).toBeGreaterThan(2);
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
        await window.__harness.tap('KeyV');
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
