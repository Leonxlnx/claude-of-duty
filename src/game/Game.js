import * as THREE from 'three';
import { Settings } from '../core/Settings.js';
import { Input } from '../core/Input.js';
import { GameLoop } from '../core/GameLoop.js';
import { SeededRandom, WORLD_SEED } from '../core/SeededRandom.js';

import { MaterialLibrary } from '../world/MaterialLibrary.js';
import { MaterialFactory } from '../render/Materials.js';
import { RenderGraph } from '../render/RenderGraph.js';
import { World } from '../world/World.js';

import { RigidWorld } from '../physics/RigidWorld.js';
import { NavGrid } from '../ai/NavGrid.js';
import { Director } from '../ai/Director.js';

import { Player } from './Player.js';
import { PlayerTarget } from './PlayerTarget.js';
import { Match } from './Match.js';
import { ViewModel } from '../weapons/ViewModel.js';
import { Weapon } from '../weapons/Weapon.js';
import { GrenadeController } from '../weapons/GrenadeController.js';
import { Combat } from '../combat/Combat.js';
import { AudioEngine } from '../audio/AudioEngine.js';

import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { Loading } from '../ui/Loading.js';
import { showFatalOverlay } from '../ui/Fatal.js';

/**
 * Assembles every subsystem and owns the frame.
 *
 * Simulation runs on a fixed 120 Hz step so ballistics, physics and AI are
 * frame-rate independent; the view, the weapon rig and the HUD are evaluated at
 * render rate from interpolated state.
 */

/**
 * How many hostiles hold the district. There is no friendly side, so this is
 * everyone in the match besides the player; they respawn on a timer, which
 * keeps the pressure roughly constant however fast the player clears them.
 */
const OPPOSITION = 6;
/**
 * Box-filter a GL readback into a small RGBA buffer, flipping the y axis so
 * row 0 is the top of the screen the way every other image API expects.
 */
function downsampleFlipped(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const bx = sw / dw, by = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((dh - 1 - y) * by), y1 = Math.max(y0 + 1, Math.floor((dh - y) * by));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * bx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * bx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: dw, height: dh, data: Array.from(out) };
}

/** Horizontal FOV in degrees to the vertical FOV three.js expects. */
function verticalFov(horizontalDeg, aspect) {
  const h = horizontalDeg * Math.PI / 360;
  return 2 * Math.atan(Math.tan(h) / aspect) * 180 / Math.PI;
}

/**
 * Turn the browser's context creation message into something a player can act
 * on. The common one by far is Chrome having switched the GPU off for the rest
 * of the session after the GPU process died, which looks identical to
 * unsupported hardware unless you read the status message.
 */
function describeContextFailure(statusMessage) {
  const msg = String(statusMessage);
  if (/Disabled|BindToCurrentSequence|GPU process/i.test(msg)) {
    return 'The browser has switched off GPU access for this session, usually after a '
      + 'graphics driver reset. Fully quit the browser and reopen it — a reload will not '
      + 'bring it back.';
  }
  if (/blocklist|blacklist|software/i.test(msg)) {
    return 'The browser is blocking hardware acceleration for this GPU. Enable '
      + '"Use graphics acceleration when available" in the browser settings and restart it.';
  }
  return msg ? `Error creating WebGL context: ${msg}` : '';
}

// How long a death is held before the respawn wait can be skipped, in seconds.
const RESPAWN_SKIP_AFTER = 1.1;

// Respawn placement: how many candidates to draw from the navmesh, how far an
// enemy has to be before a line-of-sight check is worth paying for, and the
// separation a candidate has to clear before it is considered at all.
const RESPAWN_CANDIDATES = 8;
const RESPAWN_SIGHT_RANGE = 55;
const RESPAWN_COMFORT = 34;

// Fraction of the hip-fire field of view kept while aiming.
const ADS_WORLD_ZOOM = 0.82;
const ADS_VIEWMODEL_ZOOM = 0.70;

// How far the world camera opens up at a full sprint.
const SPRINT_FOV_GAIN = 1.07;

/**
 * The frame time motion blur is tuned against.
 *
 * The velocity buffer holds how far each pixel moved over the last frame, so
 * using it raw ties the shutter to the frame rate: the slower the machine, the
 * longer every streak, which is precisely backwards — the frames that can least
 * afford to look worse get smeared the hardest, and a sprint on a struggling
 * machine drags the near wall clean across the screen. Rescaling to a fixed
 * reference makes the blur mean a shutter speed instead of a frame.
 */
const MOTION_BLUR_REFERENCE_DT = 1 / 60;

// Dynamic resolution: step size, floor as a fraction of the preset, and the
// minimum seconds between two changes.
const DYNRES_STEP = 0.1;
const DYNRES_FLOOR = 0.6;
const DYNRES_COOLDOWN = 1.0;

const DIFFICULTY_SKILL = {
  recruit: [0.18, 0.38],
  regular: [0.38, 0.62],
  veteran: [0.58, 0.82],
  elite: [0.78, 0.98]
};

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.state = 'loading';       // loading | menu | playing | paused | ended
    this.time = 0;
    this.frameStats = { fps: 0, cpu: 0, drawCalls: 0, triangles: 0 };
    /** Optional per-frame observer, used by the automated profiler. */
    this.onFrame = null;
    this._resizePending = true;
    this._dynScale = Settings.preset.renderScale;
    this._dynCooldown = 0;
    this._frameTimes = [];
    this._pendingHits = [];
  }

  // ------------------------------------------------------------------- boot

  async boot() {
    const loading = new Loading(this.uiRoot);
    this.loading = loading;

    await loading.step(0.04, 'Creating context');
    // The browser reports why it refused through an event on the canvas, not
    // through the exception, and the reason matters: a driver that has been
    // switched off after repeated GPU crashes needs a very different fix from
    // hardware that never supported WebGL2.
    let creationError = '';
    this.canvas.addEventListener('webglcontextcreationerror',
      (e) => { creationError = e.statusMessage || ''; }, { once: true });

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: false, alpha: false, stencil: false,
        depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false
      });
    } catch (err) {
      throw new Error(describeContextFailure(creationError) || err.message);
    }
    this._bindContextLoss();
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (!this.renderer.capabilities.isWebGL2) {
      throw new Error('WebGL2 is required.');
    }

    this.quality = Settings.preset;
    const qp = new URLSearchParams(location.search);
    if (qp.has('nomb')) this.quality.motionBlur = 'off';
    if (qp.has('notaa')) this.quality.taa = false;
    if (qp.has('noao')) this.quality.aoEnabled = false;

    // Start the material shaders compiling and do not wait for them. The
    // driver compiles on its own threads, so everything below — the render
    // graph, the sky, the whole district, the navmesh — runs for free inside
    // that window instead of after it. Only the texture arrays themselves have
    // to exist now, and the constructor allocates those.
    await loading.step(0.10, 'Generating materials');
    this.materialLibrary = new MaterialLibrary(this.renderer, 512);
    const materialsCompiled = this.materialLibrary.compile();

    await loading.step(0.16, 'Building render graph');
    this.graph = new RenderGraph(this.renderer, this.quality);
    this.graph.resize(window.innerWidth, window.innerHeight, true);
    this.graph.debugView = parseInt(qp.get('debug') ?? '0', 10) || 0;

    await loading.step(0.22, 'Baking sky and irradiance');
    this.graph.sky.setSun(112, 41);
    this.graph.sky.bake();
    this.graph.updateSkyUniforms();

    this.factory = new MaterialFactory(this.graph.lightUniforms, this.materialLibrary);

    await loading.step(0.32, 'Generating district');
    this.world = new World(this.factory).build(WORLD_SEED);

    await loading.step(0.50, 'Baking navigation');
    this.nav = new NavGrid(this.world.bvh, this.world.bounds, {
      buildings: this.world.buildings, playBounds: this.world.playBounds
    }).bake();

    await loading.step(0.62, 'Painting surfaces');
    await materialsCompiled;
    await this.materialLibrary.draw(
      (f) => loading.tick(0.62 + f * 0.10, `Painting surfaces ${Math.round(f * 100)}%`)
    );

    await loading.step(0.74, 'Arming systems');
    // Sized for the heaviest preset; the live cap follows the quality setting.
    this.rigid = new RigidWorld(this.world.bvh, 260);
    this.rigid.maxBodies = this.quality.maxRigidBodies;
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);

    this.combat = new Combat({
      world: this.world, rigidWorld: this.rigid,
      lightUniforms: this.graph.lightUniforms,
      quality: this.quality, audio: this.audio
    });

    this.player = new Player(this.world, this.input, this.audio);
    this.player.team = 'A';
    this.playerTarget = new PlayerTarget(this.player);
    this.combat.registerCharacter(this.playerTarget);

    this.viewModel = new ViewModel(this.factory, this.graph.vmPrevViewProjection);
    this.weapon = new Weapon({
      audio: this.audio, viewModel: this.viewModel,
      player: this.player, combat: this.combat
    });
    this.grenades = new GrenadeController({
      player: this.player, audio: this.audio,
      onThrow: (origin, velocity) => {
        this.combat.throwGrenade({
          position: origin, velocity, owner: this.playerTarget, team: this.player.team
        });
      }
    });

    await loading.step(0.80, 'Deploying opposition');
    this.rng = new SeededRandom(WORLD_SEED ^ 0x51de);
    this.director = new Director({
      scene: this.world.scene, nav: this.nav, bvh: this.world.bvh,
      factory: this.factory, rng: this.rng,
      shadowSystem: this.graph.shadows,
      prevViewProjection: this.graph.prevViewProjection,
      combat: this.combat, audio: this.audio
    });
    this.director.setSpawnPoints(this.world.spawns.A, this.world.spawns.B);
    this.director.setPlayer(this.playerTarget);

    this.match = new Match({ scoreLimit: 30, timeLimit: 600 });

    await loading.step(0.88, 'Building interface');
    this.hud = new HUD(this.uiRoot);
    this.menu = new Menu(this.uiRoot, { audio: this.audio });

    this._wireCallbacks();

    // Cameras: the world camera and a narrower one for the viewmodel, so the
    // gun keeps its proportions no matter what FOV the player picks.
    this.camera = new THREE.PerspectiveCamera(Settings.data.fov, 1, 0.06, 600);
    this.vmCamera = new THREE.PerspectiveCamera(Settings.data.viewmodelFov, 1, 0.012, 12);
    this._applyResize();

    await loading.step(0.94, 'Compiling shaders');
    this._warmup();

    await loading.step(1.0, 'Ready');
    loading.done();
    this.bootTimings = loading.timings;

    this.state = 'menu';
    this.menu.showStart();
    this._startLoop();
    return this;
  }

  /**
   * A lost context leaves every buffer, texture and program invalid, and three
   * cannot rebuild the render graph underneath us. Stopping the loop and saying
   * so beats several thousand GL errors a second and a frozen tab.
   */
  _bindContextLoss() {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.loop?.stop();
      if (this.input) {
        this.input.enabled = false;
        this.input.releaseLock();
      }
      showFatalOverlay(this.uiRoot, 'Graphics context lost',
        'The graphics driver reset. Reload the page to start a new match.');
    });
    // Chrome keeps a context alive until the page is collected, and it caps how
    // many can exist at once. Releasing on pagehide means a player who reloads
    // a few times does not run the tab out of contexts.
    window.addEventListener('pagehide', () => {
      try { this.renderer?.dispose(); } catch { /* already gone */ }
      try { this.renderer?.forceContextLoss(); } catch { /* already gone */ }
    });
  }

  /**
   * Force every shader variant through the compiler before the first frame,
   * so the opening seconds are not a slideshow of pipeline stalls.
   */
  _warmup() {
    const cam = this.camera.clone();
    cam.position.copy(this.world.spawns.A[0] ?? new THREE.Vector3(0, 2, 0));
    cam.position.y += 1.6;
    cam.updateMatrixWorld();
    this.renderer.compile(this.world.scene, cam);
    this.renderer.compile(this.combat.scene, cam);
    this.renderer.compile(this.combat.transparentScene, cam);
    this.renderer.compile(this.viewModel.root, cam);
  }

  _wireCallbacks() {
    // ---- combat feedback into the HUD and audio
    this.combat.onHitConfirm = ({ zone, damage, killed, position }) => {
      this.hud.showHitmarker(killed);
      this.audio.playHitmarker(killed);
      this._pendingHits.push({ position, damage, headshot: zone === 'head' });
      this.match.registerShot(0, true);
    };
    this.combat.onKill = (owner, victim, zone) => {
      if (owner === this.playerTarget || owner === this.player) {
        this.match.registerKill(0, victim.id, { headshot: zone === 'head' });
      }
    };
    this.weapon.onFire = () => {
      this.match.registerShot(0, false);
      this.director.playerFired(this.player.eye);
    };

    // ---- the player taking hits
    this.playerTarget.onDamaged = (amount, info) => {
      this.hud.flashDamage(Math.min(0.75, amount / 55));
      this.audio.playHurt();
      if (info?.point) {
        // Arrow points at the shooter, relative to where the player is looking.
        _dir.subVectors(info.source?.position ?? info.point, this.player.eye);
        const angle = Math.atan2(_dir.x, -_dir.z) - Math.atan2(
          -Math.sin(this.player.yaw), -Math.cos(this.player.yaw)
        );
        this.hud.showDamageDirection(-angle);
      }
    };
    this.player.onDeath = (source) => {
      this._onPlayerDeath(source);
    };

    // ---- AI deaths feed the scoreboard
    this.director.onAgentKilled = (agent, info) => {
      const killerId = info?.source === this.playerTarget ? 0 : info?.source?.id ?? null;
      this.match.registerKill(killerId ?? null, agent.character.id, {
        headshot: info?.zone === 'head'
      });
    };

    this.match.onKill = (event) => {
      this.hud.addKill(event);
      if (event.involvesPlayer === 'killer') {
        if (event.streak === 3) this.hud.announce('Triple', 'three without dying');
        else if (event.streak === 5) this.hud.announce('Rampage', 'five without dying');
        else if (event.streak >= 8 && event.streak % 3 === 2) this.hud.announce('Unstoppable', `${event.streak} streak`);
      }
    };
    this.match.onEnd = (winner, reason) => this._onMatchEnd(winner, reason);

    // ---- menu
    this.menu.onStart = () => this.startMatch();
    this.menu.onResume = () => this.resume();
    this.menu.onRestart = () => this.startMatch();
    this.menu.onQuitToMenu = () => this.quitToMenu();
    this.menu.onSettingChanged = (key) => this._applySettings(key);
    // Saved settings from a previous session have to reach the renderer once
    // before the first frame, not only when the player opens the menu.
    this._applySettings('*');

    // ---- input
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    window.addEventListener('resize', () => { this._resizePending = true; });
    window.addEventListener('blur', () => { if (this.state === 'playing') this.pause(); });
  }

  // ------------------------------------------------------------ match flow

  startMatch() {
    this.menu.hide();
    this.menu.hideBoard();
    this.hud.clear();
    this.hud.setVisible(true);
    this.state = 'playing';

    this.match.reset();
    this.match.registerPlayer(0, { name: 'YOU', team: 'A', isLocal: true });

    // Rebuild the opposition so a restart is genuinely fresh. One side only:
    // the match is the player against the district, and a squad of friendlies
    // stealing kills makes the score on the HUD somebody else's business.
    this.director.dispose();
    const [lo, hi] = DIFFICULTY_SKILL[Settings.data.difficulty] ?? DIFFICULTY_SKILL.regular;
    this.director.spawnTeam('B', OPPOSITION, [lo, hi]);
    for (const c of this.director.characters) {
      const idx = this.match.players.size;
      const name = Match.callsign(c.team, idx);
      c.name = name;
      this.match.registerPlayer(c.id, { name, team: c.team });
    }

    this.combat.clear();
    this._respawnPlayer(true);
    this.match.start();

    this.audio.init().then(() => {
      this.audio.resume();
      this.audio.setVolumes({ master: Settings.data.masterVolume });
      this.audio.playStinger(false);
    });

    this.input.requestLock();
    this.hud.announce('Contact expected', 'Suq Al-Rimal — 13:40');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.menu.showPause();
    this.input.releaseLock();
    this.audio.setMuffle(0.55);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.menu.hide();
    this.state = 'playing';
    this.input.requestLock();
    this.audio.setMuffle(0);
  }

  quitToMenu() {
    this.state = 'menu';
    this.hud.setVisible(false);
    this.hud.clear();
    this.menu.hideBoard();
    this.menu.showStart();
    this.input.releaseLock();
    this.audio.setMuffle(0);
  }

  _onMatchEnd(winner, reason) {
    this.state = 'ended';
    this.hud.setVisible(false);
    this.input.releaseLock();
    this.audio.playStinger(true);
    this.menu.showBoard({
      won: winner === 'A',
      scoreA: this.match.scores.A,
      scoreB: this.match.scores.B,
      rows: this.match.scoreboard(),
      reason
    });
  }

  _onPlayerDeath(source) {
    this.respawnTimer = this.match.respawnDelay;
    const name = source?.name ?? 'the world';
    this.hud.showRespawn(name, this.respawnTimer);
    this.match.registerKill(source?.id ?? null, 0, { headshot: false });
    this.audio.setMuffle(0.35);
    this.weapon.setTrigger(false);
  }

  /**
   * Somewhere in the map to come back in.
   *
   * Redeploying at the same end of the street every time turns the second half
   * of a match into a commute, so candidates come from the whole navmesh rather
   * than a fixed spawn list. The navmesh supplies open ground well behind the
   * fighting; this then rejects anything an enemy can already see, because
   * "well behind" and "out of sight" are not the same thing on a street with
   * a clear line down it.
   */
  _pickRespawn() {
    const enemies = [];
    for (const c of this.director.characters) {
      if (c.alive && c.team !== this.player.team) enemies.push(c);
    }

    let fallback = null;
    for (let attempt = 0; attempt < RESPAWN_CANDIDATES; attempt++) {
      const p = this.nav.spawnPoint(this.rng, _candidate, {
        enemies, minEnemyDist: RESPAWN_COMFORT
      });
      if (!p) break;

      let exposed = false;
      for (const e of enemies) {
        if (p.distanceTo(e.position) > RESPAWN_SIGHT_RANGE) continue;
        _sightA.copy(p).y += 1.5;
        _sightB.copy(e.position).y += 1.5;
        if (!this.world.bvh.occluded(_sightA, _sightB)) { exposed = true; break; }
      }
      if (!exposed) return p;
      fallback = (fallback ?? new THREE.Vector3()).copy(p);
    }
    if (fallback) return fallback;

    // Nothing cleared the comfort distance. Being seen on arrival is a bad
    // start; arriving in a stranger's kitchen is a worse one, so drop the
    // separation requirement rather than the requirement to be outdoors.
    return this.nav.spawnPoint(this.rng, _candidate, {
      minEnemyDist: 0, clearance: 0.7, samples: 256
    });
  }

  _respawnPlayer(initial = false) {
    // Including the opening one. The map's spawn list predates the navmesh and
    // is not checked against it, and one of its points is inside a building —
    // which is where every match was starting.
    _spawn.copy(this._pickRespawn() ?? this.world.spawns.A[0]);
    _spawn.y = this.world.groundAt(_spawn.x, _spawn.z) + 0.08;
    this.player.spawn(_spawn);

    // Face the fight: the nearest living enemy if there is one, otherwise the
    // middle of the street. Coming back in staring at a wall is a free death.
    let face = null, faceDist = Infinity;
    for (const c of this.director.characters) {
      if (!c.alive || c.team === this.player.team) continue;
      const d = c.position.distanceToSquared(_spawn);
      if (d < faceDist) { faceDist = d; face = c.position; }
    }
    const tx = face ? face.x : 0, tz = face ? face.z : 0;
    this.player.yaw = Math.atan2(-(tx - _spawn.x), -(tz - _spawn.z));
    this.player.pitch = 0;
    this.weapon.ammo = this.weapon.spec.magSize;
    this.weapon.reserve = this.weapon.spec.reserve;
    this.weapon.reloading = false;
    this.weapon.boltLocked = false;
    this.hud.hideRespawn();
    this.hud.setDeathFade(0);
    this.audio.setMuffle(0);
    if (!initial) this.hud.announce('Redeployed', '');
  }

  // ------------------------------------------------------------- main loop

  _startLoop() {
    this.loop = new GameLoop({
      fixedHz: 120,
      maxSubSteps: 5,
      update: (dt) => this._fixedUpdate(dt),
      render: (dt, alpha) => this._render(dt, alpha)
    });
    this.loop.start();
  }

  _fixedUpdate(dt) {
    this.time += dt;
    this._steppedThisFrame = true;
    if (this.state !== 'playing') return;

    this.match.update(dt);

    if (this.player.alive) {
      const firing = this.input.action('fire');
      if (this.input.actionPressed('grenade')) this.grenades.toggle();
      this.grenades.update(dt, { firing });

      // While a grenade is in hand the trigger belongs to it, and so does the
      // right mouse button — there is nothing to aim down.
      const armed = !this.grenades.blocksWeapon;
      this.weapon.setTrigger(armed && firing);
      this.player.wantsAds = armed && this.input.action('aim');
      if (armed && this.input.actionPressed('reload')) this.weapon.startReload();
      if (armed && this.input.actionPressed('fireMode')) this.weapon.cycleFireMode();
      if (armed && this.input.actionPressed('inspect')) this._inspect();
    } else {
      this.grenades.stow();
      this.grenades.update(dt, { firing: false });
      this.weapon.setTrigger(false);
      this.respawnTimer -= dt;
      // A short beat so the kill registers, then the wait is the player's to
      // skip. Nobody wants to sit and watch a timer.
      const canSkip = this.respawnTimer <= this.match.respawnDelay - RESPAWN_SKIP_AFTER;
      const skipped = canSkip
        && (this.input.actionPressed('jump') || this.input.actionPressed('fire'));
      if (this.respawnTimer <= 0 || skipped) this._respawnPlayer();
    }

    this.player.update(dt, this.time);
    this.playerTarget.sync();
    this.weapon.update(dt, this.time);
    this.director.update(dt);
    this.rigid.step(dt);
    this.combat.update(dt, this.time, this.camera);
  }

  _render(dt, alpha) {
    if (this._resizePending) this._applyResize();
    const t0 = performance.now();

    // ------------------------------------------------------------ view
    if (this.state === 'playing' || this.state === 'paused') {
      const look = this.input.consumeLook();
      if (this.state === 'playing' && this.player.alive) this.player.look(look.x, look.y);
      this.player.updateView(dt, alpha, this.time);
      this.player.applyToCamera(this.camera);
      this._applyAdsZoom(this.player.adsBlend, dt);
      this.vmCamera.position.copy(this.camera.position);
      this.vmCamera.quaternion.copy(this.camera.quaternion);
      this.vmCamera.updateMatrixWorld();

      this.viewModel.update(dt, {
        camera: this.vmCamera,
        player: this.player,
        weapon: this.weapon,
        lookDelta: _look.set(look.x * 0.0022, look.y * 0.0022),
        wallProximity: this._wallProximity(),
        grenade: this.grenades
      });
      this.viewModel.root.visible = this.player.alive;
    } else {
      this._menuCamera(dt);
    }

    this.world.update(dt, this.time);
    this.graph.sky.update(dt, this.time);
    this.graph.updateSkyUniforms();
    this.graph.setPointLights(this.combat.activeLights());

    this.graph.render(
      this.camera, this.vmCamera,
      {
        world: this.world.scene,
        transparent: this.combat.transparentScene,
        viewmodel: this.viewModel.root,
        viewmodelTransparent: this.viewModel.transparent
      },
      dt,
      {
        time: this.time,
        damageFlash: this.hud.damageFlash,
        criticalHealth: this.player.alive
          ? Math.max(0, 1 - this.player.health / 32) : 1,
        motionBlurScale: MOTION_BLUR_REFERENCE_DT / Math.max(dt, 1e-4)
      }
    );

    this._captureRequest?.();
    this._updateHud(dt);

    // Only retire unconsumed key edges once the simulation has actually had a
    // look at them. Render runs every frame; the fixed step only runs when the
    // accumulator has filled, so a frame that arrives early has no step in it
    // at all. Clearing regardless threw away whichever presses happened to land
    // in those frames, and reload, fire mode and the grenade key would silently
    // do nothing perhaps one press in ten — the kind of fault that reads as the
    // key being unreliable rather than as a bug.
    if (this._steppedThisFrame) {
      this.input.endFrame();
      this._steppedThisFrame = false;
    }
    this._trackPerformance(performance.now() - t0, dt);
  }

  /**
   * Read the presented frame back off the GPU. This has to happen inside the
   * render loop: without `preserveDrawingBuffer` the back buffer is gone by
   * the time anything outside a frame could look at it. Used by the tests.
   */
  captureFrame(width = 192, height = 108) {
    return new Promise((resolve) => {
      this._captureRequest = () => {
        this._captureRequest = null;
        const gl = this.renderer.getContext();
        const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
        const raw = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        resolve(downsampleFlipped(raw, w, h, width, height));
      };
    });
  }

  /** Slow orbit over the street behind the menu. */
  _menuCamera(dt) {
    this._menuAngle = (this._menuAngle ?? 0) + dt * 0.045;
    const r = 46;
    const a = this._menuAngle;
    const x = Math.sin(a) * r * 0.5;
    const z = Math.cos(a) * r;
    const y = this.world.groundAt(x, z) + 9.5 + Math.sin(a * 1.7) * 1.6;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, this.world.groundAt(0, 0) + 3.2, 0);
    this.camera.updateMatrixWorld();
    this.vmCamera.position.copy(this.camera.position);
    this.vmCamera.quaternion.copy(this.camera.quaternion);
    this.vmCamera.updateMatrixWorld();
    this.viewModel.root.visible = false;
  }

  /**
   * Narrow both cameras while aiming.
   *
   * The world only tightens a little, the way a 1x optic actually behaves. The
   * viewmodel tightens much harder, because the alternative is moving the gun
   * toward the eye until the sight window is big enough to aim through, and at
   * that distance the receiver clips the near plane and fills half the screen.
   * Magnifying the viewmodel camera instead grows the sight picture and leaves
   * the weapon where it is. The reticle stays on the camera axis either way, so
   * the two cameras disagreeing does not move the point of impact.
   */
  _applyAdsZoom(blend, dt = 0) {
    // A sprint widens the world camera slightly. Speed is only legible as the
    // rate the edges of the frame move, and at a fixed field of view a fast
    // run down an open street reads no differently from a walk. The viewmodel
    // camera is deliberately left out: widening it would swing the weapon
    // around the frame every time the player breaks into a run.
    //
    // Driven by actual ground speed, not the sprint flag. That flag drops for a
    // frame every time the player clears a kerb, and a boolean feeding a field
    // of view turns each of those into a visible lurch toward the horizon and
    // back — the game appears to surge forwards and backwards while running.
    const wantSprint = this.player?.alive ? this.player.sprintNorm : 0;
    this._sprintFov = dt > 0
      ? this._sprintFov + (wantSprint - this._sprintFov) * Math.min(1, dt * 6)
      : wantSprint;

    if (blend === this._adsZoomApplied && this._sprintFov === this._sprintFovApplied) return;
    this._adsZoomApplied = blend;
    this._sprintFovApplied = this._sprintFov;

    const t = blend * blend * (3 - 2 * blend);
    const sprint = 1 + this._sprintFov * (SPRINT_FOV_GAIN - 1) * (1 - t);
    this.camera.fov = this._baseFov * (1 - t * (1 - ADS_WORLD_ZOOM)) * sprint;
    this.camera.updateProjectionMatrix();
    this.vmCamera.fov = this._baseVmFov * (1 - t * (1 - ADS_VIEWMODEL_ZOOM));
    this.vmCamera.updateProjectionMatrix();
  }

  /** Lower the weapon when the muzzle would otherwise clip a wall. */
  _wallProximity() {
    this.player.forward(_dir);
    _origin.copy(this.player.eye);
    const hit = this.world.bvh.raycast(_origin, _dir, 0.9, this.combat.hit);
    if (!hit.hit) return 0;
    return THREE.MathUtils.clamp(1 - (hit.t - 0.35) / 0.5, 0, 1);
  }

  _inspect() {
    if (this.viewModel.busy) return;
    this.viewModel.startAction('inspect', 2.1, (t, p, r) => {
      // Bring the gun up and rotate it, then set it back down.
      const s = Math.sin(Math.min(1, t / 0.22) * Math.PI * 0.5)
        * (1 - Math.max(0, (t - 0.78) / 0.22));
      p.x += -0.055 * s;
      p.y += 0.055 * s;
      p.z += 0.075 * s;
      r.x += 0.22 * s;
      r.y += 0.95 * s * Math.sin(t * Math.PI * 1.1);
      r.z += -0.55 * s;
    });
    this.audio.playBolt(false);
  }

  _updateHud(dt) {
    this.hud.update(dt);
    if (this.state !== 'playing' && this.state !== 'paused') return;

    const w = this.weapon.hudState();
    this.hud.updateAmmo(w.ammo, w.reserve, w.mode, w.reloading);
    this.hud.updateHealth(this.player.health, this.player.maxHealth);
    this.hud.updateGrenades(this.grenades.hudState());
    this.hud.updateStance(
      this.player.crouched, this.player.sprinting,
      this.player.adsBlend > 0.6, Math.abs(this.player.leanBlend) > 0.25
    );
    // One personal tally, not a team score: kills against the clock, and the
    // losses column so the run has a cost attached to it.
    const me = this.match.localPlayer();
    this.hud.updateScore(
      me?.kills ?? 0, me?.deaths ?? 0, this.match.timeLeft, this.match.scoreLimit
    );
    this.hud.updateCompass(this.player.yaw);
    this.hud.updateCrosshair(
      w.spread, this.camera.fov * Math.PI / 180, this.graph.height,
      this.player.adsBlend > 0.62 || !this.player.alive
    );

    if (!this.player.alive) {
      this.hud.setDeathFade(Math.min(0.55, (this.match.respawnDelay - this.respawnTimer) * 0.5));
      this.hud.updateRespawn(
        this.respawnTimer,
        this.respawnTimer <= this.match.respawnDelay - RESPAWN_SKIP_AFTER
      );
    }

    // Damage numbers are projected here, once, rather than tracked in 3D.
    for (const hit of this._pendingHits) {
      _proj.copy(hit.position).project(this.camera);
      if (_proj.z < 1) {
        this.hud.showDamageNumber(
          hit.damage,
          (_proj.x * 0.5 + 0.5) * this.graph.width,
          (-_proj.y * 0.5 + 0.5) * this.graph.height,
          hit.headshot
        );
      }
    }
    this._pendingHits.length = 0;
  }

  // ------------------------------------------------------------- plumbing

  _applyResize() {
    this._resizePending = false;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // The FOV setting is horizontal, the way players read it; three wants
    // vertical.
    this.camera.aspect = aspect;
    this._baseFov = verticalFov(Settings.data.fov, aspect);
    this._baseVmFov = verticalFov(Settings.data.viewmodelFov, aspect);
    this.camera.fov = this._baseFov;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = aspect;
    this.vmCamera.fov = this._baseVmFov;
    this.vmCamera.updateProjectionMatrix();
    this._adsZoomApplied = -1;
    this._sprintFovApplied = -1;
    this._sprintFov = this._sprintFov ?? 0;
    this._applyAdsZoom(this.player?.adsBlend ?? 0);
    this.graph.resize(w, h, true);
  }

  /**
   * Dynamic resolution: move the render scale to hold the frame budget.
   *
   * Changing the scale is not cheap — every target in the graph is reallocated
   * and the temporal history is thrown away with them. Nudging by a fiftieth
   * every frame therefore did the opposite of its job: once the frame budget
   * slipped, it reallocated the whole graph on every single frame, which cost
   * more than it saved, drove the scale straight to the floor and left it
   * there, and reset TAA continuously so the image tore itself apart. Steps
   * are now coarse, quantised so only a handful of sizes ever exist, and rate
   * limited so a bad second cannot become a bad minute.
   */
  _trackPerformance(cpuMs, dt) {
    this._frameTimes.push(dt);
    if (this._frameTimes.length > 60) this._frameTimes.shift();
    const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
    this.frameStats.fps = 1 / Math.max(avg, 1e-4);
    this.frameStats.cpu = cpuMs;
    this.frameStats.drawCalls = this.graph.stats.drawCalls;
    this.frameStats.triangles = this.graph.stats.triangles;
    this.onFrame?.(dt, cpuMs);

    this._dynCooldown = Math.max(0, this._dynCooldown - dt);
    if (Settings.data.dynamicResolution && this._frameTimes.length >= 60 && this._dynCooldown === 0) {
      const target = 1 / 60;
      const base = this.quality.renderScale;
      let next = this._dynScale;
      if (avg > target * 1.25) next = this._dynScale - DYNRES_STEP;
      else if (avg < target * 0.80) next = this._dynScale + DYNRES_STEP;
      next = THREE.MathUtils.clamp(
        Math.round(next / DYNRES_STEP) * DYNRES_STEP, base * DYNRES_FLOOR, base
      );
      if (Math.abs(next - this.graph.renderScale) > 1e-3) {
        this._dynScale = next;
        this.graph.renderScale = next;
        this.graph.resize(this.graph.width, this.graph.height, true);
        this._dynCooldown = DYNRES_COOLDOWN;
      }
    }

    if (Settings.data.showFps) {
      this.hud.setPerfVisible(true);
      this.hud.setPerfText(
        `${this.frameStats.fps.toFixed(0)} fps   ${(avg * 1000).toFixed(1)} ms\n`
        + `cpu ${cpuMs.toFixed(1)} ms   scale ${(this.graph.renderScale * 100).toFixed(0)}%\n`
        + `${this.frameStats.drawCalls} draws   ${(this.frameStats.triangles / 1000).toFixed(0)}k tris\n`
        + `${this.combat.particles.count} particles   ${this.director.agents.length} agents`
      );
    } else {
      this.hud.setPerfVisible(false);
    }
  }

  _applySettings(key) {
    if (key === 'quality' || key === '*') {
      this.quality = Settings.preset;
      // setQuality reaches the shadow maps, AO, clouds and render scale; just
      // assigning the preset object leaves everything but the resolution stale.
      this.graph.setQuality(this.quality);
      this.combat.setQuality?.(this.quality);
      this._dynScale = this.quality.renderScale;
      this._resizePending = true;
    }
    if (key === 'fov' || key === 'viewmodelFov' || key === '*') this._resizePending = true;
    if (key === 'masterVolume' || key === '*') {
      this.audio.setVolumes({ master: Settings.data.masterVolume });
    }
    const cp = this.graph.compositePass.uniforms;
    cp.uGrain.value = Settings.data.filmGrain;
    cp.uChromatic.value = Settings.data.chromaticAberration;
    cp.uVignette.value = Settings.data.vignette;
  }

  /** Global keys that work in every state. */
  handleKey(code) {
    if (code === Settings.data.keybinds.pause) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.menu.settingsOpen) this.menu.toggleSettings(false);
      return true;
    }
    if (code === 'Enter' && this.state === 'menu') { this.startMatch(); return true; }
    if (code === 'KeyO' && this.menu.visible) { this.menu.toggleSettings(); return true; }
    if (code === 'Backquote') {
      this.graph.debugView = (this.graph.debugView + 1) % 10;
      return true;
    }
    return false;
  }

  dispose() {
    this.loop?.stop();
    this.director.dispose();
    this.combat.dispose();
    this.viewModel.dispose();
    this.world.dispose();
    this.graph.dispose();
    this.factory.dispose();
    this.materialLibrary.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _spawn = new THREE.Vector3();
const _candidate = new THREE.Vector3();
const _sightA = new THREE.Vector3();
const _sightB = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _look = new THREE.Vector2();
