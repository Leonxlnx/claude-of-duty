import * as THREE from 'three';
import { Settings } from './Settings.js';

/**
 * Automation seam for the Playwright suite.
 *
 * The browser cannot grant pointer lock or a real mouse to a headless run, so
 * the harness pushes input straight into the input layer and reads state back
 * out of the live systems. Nothing in here is referenced by the game itself.
 */
export function installHarness(game) {
  const held = new Set();
  const api = {
    get game() { return game; },

    // ------------------------------------------------------------- lifecycle
    start() { game.startMatch(); return api.snapshot(); },
    pause() { game.pause(); },
    resume() { game.resume(); },
    quit() { game.quitToMenu(); },

    // ----------------------------------------------------------------- input
    key(code, down) {
      game.input.inject({ key: code, down });
      if (down) held.add(code); else held.delete(code);
    },
    async tap(code, seconds = 0.08) {
      api.key(code, true);
      await api.wait(seconds);
      api.key(code, false);
    },

    /**
     * Wait out `seconds` of simulated time, not wall-clock time.
     *
     * Under a software rasteriser a frame can take a quarter of a second, and
     * the loop only ever advances the fixed step so far per frame — so the
     * simulation runs at a fraction of real speed, measured as low as a
     * seventh. Every animation gate in the game is in simulated seconds, so a
     * test that sleeps for the length of a reload with `setTimeout` is really
     * sleeping for a seventh of one, and then asserts on a weapon still halfway
     * through it. Waiting on the clock the game actually uses makes the timing
     * of a test mean the same thing on a workstation and in CI.
     *
     * Capped in real time so a stalled loop fails the test rather than hanging.
     */
    async wait(seconds, realTimeout = 30000) {
      const until = game.time + seconds;
      const deadline = performance.now() + realTimeout;
      while (game.time < until && performance.now() < deadline) await sleep(8);
      return game.time;
    },
    releaseAll() {
      for (const code of [...held]) api.key(code, false);
      api.fire(false);
      api.ads(false);
    },
    look(dx, dy) { game.input.inject({ look: { x: dx, y: dy } }); },
    fire(down) { game.input.inject({ button: 0, down }); },
    ads(down) { game.input.inject({ button: 2, down }); },

    /** Point the camera at a world position, ignoring the mouse entirely. */
    aimAt(x, y, z) {
      const eye = game.player.eye;
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      const flat = Math.hypot(dx, dz) || 1e-6;
      game.player.yaw = Math.atan2(-dx, -dz);
      game.player.pitch = Math.atan2(dy, flat);
      return { yaw: game.player.yaw, pitch: game.player.pitch };
    },

    /** Aim at the closest living enemy the player can actually see. */
    aimAtEnemy() {
      const target = api.nearestEnemy();
      if (!target) return null;
      const p = target.position;
      api.aimAt(p.x, p.y + 0.15, p.z);
      return { name: target.name, distance: game.player.eye.distanceTo(p) };
    },

    nearestEnemy() {
      let best = null, bestD = Infinity;
      for (const c of game.director.characters) {
        if (!c.alive || c.team === game.player.team) continue;
        const d = game.player.eye.distanceToSquared(c.position);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    },

    teleport(x, y, z) {
      game.player.controller.position.set(x, y, z);
      game.player.controller.velocity.set(0, 0, 0);
    },

    /**
     * Drop the player next to an enemy with a clear line of sight. A fixed
     * offset lands inside a wall about as often as not, so candidate spots are
     * ray-tested and the most open one wins.
     */
    engageNearestEnemy(standoff = 9) {
      const target = api.nearestEnemy();
      if (!target) return null;
      const bvh = game.world.bvh;
      const chest = target.position.clone();
      chest.y += 0.9;
      let best = null;

      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const p = new THREE.Vector3(
          target.position.x + Math.cos(a) * standoff,
          0,
          target.position.z + Math.sin(a) * standoff
        );
        if (!game.nav.isWalkableAt(p.x, p.z)) continue;
        p.y = game.nav.heightAt(p.x, p.z) + 0.05;

        const eye = p.clone();
        eye.y += 1.62;
        const dir = chest.clone().sub(eye);
        const dist = dir.length();
        dir.multiplyScalar(1 / dist);
        if (bvh.raycast(eye, dir, dist - 0.3, game.combat.hit).hit) continue;
        best = p;
        break;
      }
      if (!best) return null;

      api.teleport(best.x, best.y, best.z);
      game.playerTarget.sync();
      api.aimAt(chest.x, chest.y, chest.z);
      return { target: target.name, standoff, position: best.toArray().map(round3) };
    },

    // ---------------------------------------------------------------- state
    snapshot() {
      const m = game.match;
      return {
        state: game.state,
        timeLeft: round3(m.timeLeft),
        scores: { ...m.scores },
        player: {
          alive: game.player.alive,
          health: Math.round(game.player.health),
          position: game.player.controller.position.toArray().map(round3),
          yaw: round3(game.player.yaw),
          pitch: round3(game.player.pitch),
          stance: game.player.stance,
          sliding: game.player.sliding,
          speed: round3(game.player.speed2D)
        },
        grenades: {
          ...game.grenades.hudState(),
          live: game.combat.liveGrenades.length
        },
        weapon: {
          name: game.weapon.spec.name,
          ammo: game.weapon.ammo,
          reserve: game.weapon.reserve,
          mode: game.weapon.hudState().mode,
          reloading: game.weapon.reloading
        },
        ai: {
          total: game.director.agents.length,
          aliveA: game.director.aliveCount('A'),
          aliveB: game.director.aliveCount('B'),
          engaged: game.director.agents.filter((a) => a.alive && a.target).length
        },
        fx: {
          particles: game.combat.particles.count,
          decals: game.combat.decals.count
        },
        perf: {
          fps: Math.round(game.frameStats.fps),
          cpuMs: round3(game.frameStats.cpu),
          renderScale: round3(game.graph.renderScale),
          drawCalls: game.frameStats.drawCalls,
          triangles: game.frameStats.triangles
        }
      };
    },

    /**
     * Frame-time percentiles over a window, measured on the render loop.
     *
     * The warm-up is discarded rather than measured. Effects that have not been
     * drawn yet — a tracer, an impact decal, a ragdoll — link their programs on
     * first use, and a driver compile lands as a 100ms spike that says nothing
     * about how the frame paces once a fight is under way.
     */
    async profile(ms = 4000, warmupMs = 900) {
      const samples = [];
      const prev = game.onFrame;
      game.onFrame = null;
      await sleep(warmupMs);
      game.onFrame = (dt, cpu) => { samples.push({ dt: dt * 1000, cpu }); };
      await sleep(ms);
      game.onFrame = prev;
      if (!samples.length) return null;
      const frame = samples.map((s) => s.dt).sort((a, b) => a - b);
      const cpu = samples.map((s) => s.cpu).sort((a, b) => a - b);
      const pick = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
      return {
        frames: samples.length,
        fps: round3(1000 / (frame.reduce((a, b) => a + b, 0) / frame.length)),
        frameMs: { p50: round3(pick(frame, 0.5)), p95: round3(pick(frame, 0.95)), max: round3(frame[frame.length - 1]) },
        cpuMs: { p50: round3(pick(cpu, 0.5)), p95: round3(pick(cpu, 0.95)) },
        renderScale: round3(game.graph.renderScale)
      };
    },

    /** Downsampled RGBA readback of the presented frame. */
    capture(w, h) { return game.captureFrame(w, h); },

    // ---------------------------------------------------------------- config
    // Go through the same path the settings menu uses; writing to the store
    // alone changes nothing until the game reacts to it.
    setQuality(name) { api.setSetting('quality', name); },
    setSetting(key, value) {
      Settings.set(key, value);
      game.menu.onSettingChanged?.(key, value);
    },
    debugView(n) { game.graph.debugView = n; }
  };

  window.__harness = api;
  return api;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round3 = (v) => Math.round(v * 1000) / 1000;
