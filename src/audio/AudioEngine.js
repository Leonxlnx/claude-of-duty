import * as THREE from 'three';
import { SURFACE_INFO } from '../physics/BVH.js';

/**
 * Fully procedural audio. There is not a single sample in the build: every
 * sound is synthesised at startup into short offline-rendered buffers, or
 * generated live from oscillators and filtered noise.
 *
 * Gunfire is the hard case. A rifle report is a pressure spike, a body
 * resonance, a mechanical action and a tail of reflections arriving from the
 * surrounding geometry. Synthesising those four parts separately and mixing
 * them by distance is what keeps a shot from sounding like a click.
 */

const SR = 48000;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.buffers = {};
    this.listenerPos = new THREE.Vector3();
    /** Number of synthesised buffers; the test suite asserts nothing is loaded. */
    Object.defineProperty(this, 'bufferCount', {
      get: () => Object.keys(this.buffers).length
    });
    this.listenerFwd = new THREE.Vector3(0, 0, -1);
    this.listenerUp = new THREE.Vector3(0, 1, 0);
    this.masterVolume = 0.8;
    this.sfxVolume = 1.0;
    this.muffle = 0;              // 0..1, raised while deafened or hurt
    this._voices = 0;
    this._maxVoices = 48;
    this._lastShot = 0;
    this._rrIndex = 0;
  }

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) return this;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: SR, latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;

    // A gentle limiter keeps a burst of simultaneous shots from clipping.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 9;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    // Global muffle for concussion and low health.
    this.muffleFilter = this.ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;

    // Two convolution sends: a short street slap and a longer alley tail.
    this.reverbNear = this.ctx.createConvolver();
    this.reverbFar = this.ctx.createConvolver();
    this.reverbNear.buffer = this._impulseResponse(0.55, 2.6, 3600);
    this.reverbFar.buffer = this._impulseResponse(1.9, 1.7, 1800);
    this.sendNear = this.ctx.createGain();
    this.sendFar = this.ctx.createGain();
    this.sendNear.gain.value = 0.30;
    this.sendFar.gain.value = 0.18;

    this.sfxBus.connect(this.muffleFilter);
    this.sfxBus.connect(this.sendNear);
    this.sfxBus.connect(this.sendFar);
    this.sendNear.connect(this.reverbNear);
    this.sendFar.connect(this.reverbFar);
    this.reverbNear.connect(this.muffleFilter);
    this.reverbFar.connect(this.muffleFilter);
    this.muffleFilter.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(this.ctx.destination);

    await this._renderBuffers();
    this.ready = true;
    return this;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx?.state === 'running') this.ctx.suspend(); }

  setVolumes({ master, sfx }) {
    if (master !== undefined) {
      this.masterVolume = master;
      if (this.master) this.master.gain.value = master;
    }
    if (sfx !== undefined) {
      this.sfxVolume = sfx;
      if (this.sfxBus) this.sfxBus.gain.value = sfx;
    }
  }

  setListener(position, forward, up) {
    this.listenerPos.copy(position);
    this.listenerFwd.copy(forward);
    this.listenerUp.copy(up);
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(position.x, t, 0.01);
      l.positionY.setTargetAtTime(position.y, t, 0.01);
      l.positionZ.setTargetAtTime(position.z, t, 0.01);
      l.forwardX.setTargetAtTime(forward.x, t, 0.01);
      l.forwardY.setTargetAtTime(forward.y, t, 0.01);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.01);
      l.upX.setTargetAtTime(up.x, t, 0.01);
      l.upY.setTargetAtTime(up.y, t, 0.01);
      l.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** Concussion / low-health muffling. */
  setMuffle(amount) {
    this.muffle = amount;
    if (!this.muffleFilter) return;
    const f = 20000 * Math.pow(0.045, amount);
    this.muffleFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------- synthesis

  _buffer(seconds, channels = 1) {
    return this.ctx.createBuffer(channels, Math.max(1, Math.ceil(seconds * SR)), SR);
  }

  /**
   * Exponentially decaying noise, band-shaped by a simple one-pole pair.
   * Cheap, and the ear reads it as a room.
   */
  _impulseResponse(seconds, decay, brightness) {
    const buf = this._buffer(seconds, 2);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      const a = Math.exp(-2 * Math.PI * brightness / SR);
      for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        // Early reflections as discrete taps, then a diffuse tail.
        let s = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        if (i < SR * 0.06 && Math.random() < 0.004) s += (Math.random() * 2 - 1) * 0.8;
        lp = a * lp + (1 - a) * s;
        d[i] = lp * 1.6;
      }
    }
    return buf;
  }

  /** Render the fixed one-shots offline once, at load. */
  async _renderBuffers() {
    const jobs = [
      ['shot', 0.62, (ctx) => this._buildGunshot(ctx, 1.0)],
      ['shotAlt', 0.62, (ctx) => this._buildGunshot(ctx, 1.06)],
      ['shotDistant', 0.9, (ctx) => this._buildDistantShot(ctx)],
      ['tail', 1.5, (ctx) => this._buildTail(ctx)],
      ['supersonic', 0.16, (ctx) => this._buildCrack(ctx)],
      ['casing', 0.55, (ctx) => this._buildCasing(ctx)],
      ['magOut', 0.35, (ctx) => this._buildMagOut(ctx)],
      ['magIn', 0.4, (ctx) => this._buildMagIn(ctx)],
      ['boltBack', 0.24, (ctx) => this._buildBolt(ctx, true)],
      ['boltForward', 0.22, (ctx) => this._buildBolt(ctx, false)],
      ['dryFire', 0.12, (ctx) => this._buildDryFire(ctx)],
      ['selector', 0.09, (ctx) => this._buildSelector(ctx)],
      ['fleshBody', 0.28, (ctx) => this._buildFlesh(ctx, false)],
      ['fleshHead', 0.30, (ctx) => this._buildFlesh(ctx, true)],
      ['impactConcrete', 0.36, (ctx) => this._buildImpact(ctx, 'concrete')],
      ['impactMetal', 0.5, (ctx) => this._buildImpact(ctx, 'metal')],
      ['impactWood', 0.32, (ctx) => this._buildImpact(ctx, 'wood')],
      ['impactGlass', 0.6, (ctx) => this._buildImpact(ctx, 'glass')],
      ['impactSand', 0.28, (ctx) => this._buildImpact(ctx, 'sand')],
      ['ricochet', 0.5, (ctx) => this._buildRicochet(ctx)],
      ['hitmarker', 0.09, (ctx) => this._buildHitmarker(ctx, false)],
      ['hitmarkerKill', 0.22, (ctx) => this._buildHitmarker(ctx, true)],
      ['hurt', 0.4, (ctx) => this._buildHurt(ctx)],
      ['uiClick', 0.07, (ctx) => this._buildUI(ctx, 780)],
      ['uiHover', 0.05, (ctx) => this._buildUI(ctx, 1350)],
      ['uiBack', 0.09, (ctx) => this._buildUI(ctx, 420)],
      ['matchStart', 1.4, (ctx) => this._buildStinger(ctx, false)],
      ['matchEnd', 1.8, (ctx) => this._buildStinger(ctx, true)]
    ];
    // Footsteps get several variants per surface so repetition is inaudible.
    for (const surf of ['stone', 'sand', 'gravel', 'wood', 'metal']) {
      for (let v = 0; v < 4; v++) {
        jobs.push([`step_${surf}_${v}`, 0.24, (ctx) => this._buildFootstep(ctx, surf, v)]);
      }
    }

    const results = await Promise.all(jobs.map(async ([name, seconds, build]) => {
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const ctx = new OfflineCtx(1, Math.ceil(seconds * SR), SR);
      build(ctx);
      const buf = await ctx.startRendering();
      return [name, buf];
    }));
    for (const [name, buf] of results) this.buffers[name] = buf;
  }

  // ----- individual synth graphs (all run inside an OfflineAudioContext) ----

  _noise(ctx, seconds, color = 0) {
    const len = Math.ceil(seconds * SR);
    const buf = ctx.createBuffer(1, len, SR);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // color < 0 → darker (brown-ish), > 0 → brighter (blue-ish)
      last = last * (0.5 - color * 0.45) + w * (0.5 + color * 0.45);
      d[i] = color < 0 ? last : w * (1 + color) - last * color;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  _env(ctx, node, t0, peak, attack, decay, curve = 'exp') {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    else g.gain.linearRampToValueAtTime(0, t0 + attack + decay);
    node.connect(g);
    return g;
  }

  /**
   * Close rifle report: blast, body, mechanical action, and a short room slap.
   */
  _buildGunshot(ctx, pitch) {
    const out = ctx.destination;
    const t = 0;

    // 1) Muzzle blast: very short burst of bright noise through a resonant
    //    bandpass, which gives the "crack" its pitch without a tone.
    const blast = this._noise(ctx, 0.10, 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.06);
    bp.Q.value = 0.9;
    const blastEnv = this._env(ctx, bp, t, 1.0, 0.0006, 0.075);
    blast.connect(bp);
    blastEnv.connect(out);
    blast.start(t);

    // 2) Body: a fast downward sine sweep is the pressure wave.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(320 * pitch, t);
    body.frequency.exponentialRampToValueAtTime(58, t + 0.11);
    const bodyEnv = this._env(ctx, body, t, 0.85, 0.001, 0.13);
    bodyEnv.connect(out);
    body.start(t); body.stop(t + 0.2);

    // 3) A second, slightly detuned blast layer adds weight and stops the
    //    report from sounding synthetic when fired quickly.
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(150 * pitch, t);
    sub.frequency.exponentialRampToValueAtTime(44, t + 0.16);
    const subEnv = this._env(ctx, sub, t, 0.5, 0.002, 0.18);
    subEnv.connect(out);
    sub.start(t); sub.stop(t + 0.25);

    // 4) Mechanical: bolt cycling, 8 ms after the shot.
    const mech = this._noise(ctx, 0.09, 0.9);
    const mechHp = ctx.createBiquadFilter();
    mechHp.type = 'highpass';
    mechHp.frequency.value = 2600;
    const mechEnv = this._env(ctx, mechHp, t + 0.008, 0.22, 0.001, 0.07);
    mech.connect(mechHp);
    mechEnv.connect(out);
    mech.start(t + 0.008);

    // 5) Street slap: filtered noise burst arriving a few ms later.
    const slap = this._noise(ctx, 0.42, -0.2);
    const slapBp = ctx.createBiquadFilter();
    slapBp.type = 'bandpass';
    slapBp.frequency.value = 900;
    slapBp.Q.value = 0.7;
    const slapEnv = this._env(ctx, slapBp, t + 0.02, 0.30, 0.01, 0.40);
    slap.connect(slapBp);
    slapEnv.connect(out);
    slap.start(t + 0.02);
  }

  /** Distant report: the crack is gone, only the low thump and tail survive. */
  _buildDistantShot(ctx) {
    const out = ctx.destination;
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(180, 0);
    thump.frequency.exponentialRampToValueAtTime(52, 0.14);
    this._env(ctx, thump, 0, 0.7, 0.004, 0.20).connect(out);
    thump.start(0); thump.stop(0.3);

    const air = this._noise(ctx, 0.85, -0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, 0);
    lp.frequency.exponentialRampToValueAtTime(320, 0.7);
    const env = this._env(ctx, lp, 0.006, 0.45, 0.02, 0.72);
    air.connect(lp); env.connect(out); air.start(0);
  }

  /** The long reflected tail that follows any shot in a built-up street. */
  _buildTail(ctx) {
    const out = ctx.destination;
    const n = this._noise(ctx, 1.45, -0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(760, 0);
    bp.frequency.exponentialRampToValueAtTime(240, 1.2);
    bp.Q.value = 0.5;
    const env = this._env(ctx, bp, 0.03, 0.34, 0.05, 1.25);
    n.connect(bp); env.connect(out); n.start(0);
  }

  /** Supersonic crack of a round passing nearby. */
  _buildCrack(ctx) {
    const out = ctx.destination;
    const n = this._noise(ctx, 0.1, 1.0);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 4200;
    bp.gain.value = 9;
    bp.Q.value = 1.4;
    const env = this._env(ctx, bp, 0, 0.9, 0.0004, 0.028);
    n.connect(hp); hp.connect(bp); env.connect(out); n.start(0);
  }

  _buildCasing(ctx) {
    const out = ctx.destination;
    // Two or three bright metallic pings with random spacing.
    for (let i = 0; i < 3; i++) {
      const t = i * (0.055 + Math.random() * 0.07);
      const gainScale = Math.pow(0.55, i);
      for (const f of [3100, 4700, 6900, 9400]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * (0.92 + Math.random() * 0.16);
        const g = this._env(ctx, o, t, 0.10 * gainScale * (3100 / f), 0.0005, 0.09 + Math.random() * 0.06);
        g.connect(out);
        o.start(t); o.stop(t + 0.2);
      }
      const tick = this._noise(ctx, 0.03, 1.0);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4000;
      const e = this._env(ctx, hp, t, 0.09 * gainScale, 0.0004, 0.02);
      tick.connect(hp); e.connect(out); tick.start(t);
    }
  }

  _buildMagOut(ctx) {
    const out = ctx.destination;
    // Release button click, then the magazine sliding free.
    this._click(ctx, out, 0, 2600, 0.16, 0.012);
    const slide = this._noise(ctx, 0.2, 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.6;
    const env = this._env(ctx, bp, 0.03, 0.10, 0.02, 0.18);
    slide.connect(bp); env.connect(out); slide.start(0.03);
    this._click(ctx, out, 0.2, 900, 0.14, 0.03);
  }

  _buildMagIn(ctx) {
    const out = ctx.destination;
    const rustle = this._noise(ctx, 0.14, 0);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.5;
    const env = this._env(ctx, bp, 0, 0.09, 0.02, 0.13);
    rustle.connect(bp); env.connect(out); rustle.start(0);
    // Seat: a solid low-mid thunk followed by the catch clicking home.
    const thunk = ctx.createOscillator();
    thunk.type = 'triangle';
    thunk.frequency.setValueAtTime(420, 0.19);
    thunk.frequency.exponentialRampToValueAtTime(140, 0.27);
    this._env(ctx, thunk, 0.19, 0.42, 0.001, 0.10).connect(out);
    thunk.start(0.19); thunk.stop(0.32);
    this._click(ctx, out, 0.20, 3400, 0.20, 0.014);
    this._click(ctx, out, 0.235, 2100, 0.10, 0.02);
  }

  _buildBolt(ctx, back) {
    const out = ctx.destination;
    const t = 0;
    const slide = this._noise(ctx, 0.09, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(back ? 1800 : 2600, t);
    bp.frequency.exponentialRampToValueAtTime(back ? 3200 : 1400, t + 0.07);
    bp.Q.value = 0.8;
    const env = this._env(ctx, bp, t, 0.24, 0.002, 0.075);
    slide.connect(bp); env.connect(out); slide.start(t);
    // The clack at the end of travel.
    this._click(ctx, out, t + (back ? 0.075 : 0.055), back ? 2400 : 1500, 0.42, 0.03);
    if (!back) {
      const ring = ctx.createOscillator();
      ring.type = 'sine'; ring.frequency.value = 5200;
      this._env(ctx, ring, t + 0.056, 0.05, 0.0005, 0.11).connect(out);
      ring.start(t + 0.056); ring.stop(t + 0.2);
    }
  }

  _buildDryFire(ctx) {
    this._click(ctx, ctx.destination, 0, 2900, 0.3, 0.02);
    this._click(ctx, ctx.destination, 0.012, 1400, 0.12, 0.03);
  }

  _buildSelector(ctx) {
    this._click(ctx, ctx.destination, 0, 4200, 0.28, 0.012);
  }

  _click(ctx, out, t, freq, gain, decay) {
    const n = this._noise(ctx, decay + 0.01, 0.8);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2.2;
    const env = this._env(ctx, bp, t, gain, 0.0004, decay);
    n.connect(bp); env.connect(out); n.start(t);
  }

  _buildFlesh(ctx, head) {
    const out = ctx.destination;
    // Wet slap: low thud plus a short splatter of mid noise.
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(head ? 260 : 190, 0);
    thud.frequency.exponentialRampToValueAtTime(head ? 70 : 55, 0.1);
    this._env(ctx, thud, 0, head ? 0.75 : 0.55, 0.001, 0.11).connect(out);
    thud.start(0); thud.stop(0.2);

    const splat = this._noise(ctx, 0.2, 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(head ? 1600 : 1000, 0);
    bp.frequency.exponentialRampToValueAtTime(320, 0.16);
    bp.Q.value = 0.6;
    const env = this._env(ctx, bp, 0.002, head ? 0.5 : 0.34, 0.002, 0.18);
    splat.connect(bp); env.connect(out); splat.start(0);

    if (head) {
      // A hard crack on top, which is the cue players learn to recognise.
      const crack = this._noise(ctx, 0.05, 1.0);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3200;
      const e = this._env(ctx, hp, 0, 0.36, 0.0004, 0.035);
      crack.connect(hp); e.connect(out); crack.start(0);
    }
  }

  _buildImpact(ctx, kind) {
    const out = ctx.destination;
    const profile = {
      concrete: { f0: 1500, f1: 380, decay: 0.14, gain: 0.55, color: 0.2, ring: 0 },
      metal: { f0: 2600, f1: 900, decay: 0.10, gain: 0.5, color: 0.7, ring: 2400 },
      wood: { f0: 900, f1: 260, decay: 0.13, gain: 0.5, color: -0.1, ring: 420 },
      glass: { f0: 3400, f1: 1500, decay: 0.22, gain: 0.42, color: 0.9, ring: 5200 },
      sand: { f0: 700, f1: 180, decay: 0.11, gain: 0.4, color: -0.4, ring: 0 }
    }[kind];

    const n = this._noise(ctx, profile.decay + 0.12, profile.color);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(profile.f0, 0);
    bp.frequency.exponentialRampToValueAtTime(profile.f1, profile.decay);
    bp.Q.value = 0.8;
    const env = this._env(ctx, bp, 0, profile.gain, 0.0008, profile.decay);
    n.connect(bp); env.connect(out); n.start(0);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(profile.f1 * 0.6, 0);
    thud.frequency.exponentialRampToValueAtTime(60, profile.decay * 1.2);
    this._env(ctx, thud, 0, 0.28, 0.001, profile.decay * 1.3).connect(out);
    thud.start(0); thud.stop(profile.decay * 1.6);

    if (profile.ring) {
      for (let h = 0; h < 3; h++) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = profile.ring * (1 + h * 0.63) * (0.95 + Math.random() * 0.1);
        this._env(ctx, o, 0.001, 0.09 / (1 + h), 0.0008, 0.18 + h * 0.06).connect(out);
        o.start(0.001); o.stop(0.5);
      }
    }
    if (kind === 'glass') {
      // shards falling after the break
      for (let i = 0; i < 9; i++) {
        const t = 0.06 + Math.random() * 0.4;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 3000 + Math.random() * 4500;
        this._env(ctx, o, t, 0.035, 0.0005, 0.04 + Math.random() * 0.05).connect(out);
        o.start(t); o.stop(t + 0.12);
      }
    }
  }

  _buildRicochet(ctx) {
    const out = ctx.destination;
    // Descending whine: two detuned saws through a sweeping bandpass.
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 2600 + Math.random() * 1400;
      o.frequency.setValueAtTime(f0, 0);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.22, 0.42);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 8;
      bp.frequency.setValueAtTime(f0, 0);
      bp.frequency.exponentialRampToValueAtTime(f0 * 0.25, 0.42);
      o.connect(bp);
      const env = this._env(ctx, bp, 0.004, 0.16, 0.006, 0.44);
      env.connect(out);
      o.start(0); o.stop(0.5);
    }
    this._click(ctx, out, 0, 3600, 0.3, 0.02);
  }

  _buildHitmarker(ctx, kill) {
    const out = ctx.destination;
    const freqs = kill ? [1180, 1570, 2100] : [1750];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const t = i * 0.045;
      const g = this._env(ctx, o, t, kill ? 0.13 : 0.16, 0.001, kill ? 0.10 : 0.045);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 4200;
      g.connect(lp); lp.connect(out);
      o.start(t); o.stop(t + 0.2);
    });
  }

  _buildHurt(ctx) {
    const out = ctx.destination;
    const n = this._noise(ctx, 0.35, -0.3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, 0);
    bp.frequency.exponentialRampToValueAtTime(130, 0.3);
    const env = this._env(ctx, bp, 0, 0.5, 0.002, 0.33);
    n.connect(bp); env.connect(out); n.start(0);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, 0);
    o.frequency.exponentialRampToValueAtTime(45, 0.3);
    this._env(ctx, o, 0, 0.4, 0.002, 0.32).connect(out);
    o.start(0); o.stop(0.4);
  }

  _buildFootstep(ctx, surface, variant) {
    const out = ctx.destination;
    const p = {
      stone: { f: 900, decay: 0.075, color: 0.1, gain: 0.34, grit: 0.25 },
      sand: { f: 1500, decay: 0.10, color: 0.5, gain: 0.26, grit: 0.9 },
      gravel: { f: 1900, decay: 0.13, color: 0.7, gain: 0.30, grit: 1.0 },
      wood: { f: 620, decay: 0.11, color: -0.1, gain: 0.34, grit: 0.15 },
      metal: { f: 1700, decay: 0.16, color: 0.6, gain: 0.30, grit: 0.1 }
    }[surface];
    const jitter = 0.88 + variant * 0.08;

    // Heel: short filtered thump.
    const n = this._noise(ctx, p.decay + 0.06, p.color);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(p.f * jitter, 0);
    bp.frequency.exponentialRampToValueAtTime(p.f * 0.35, p.decay);
    bp.Q.value = 0.7;
    const env = this._env(ctx, bp, 0, p.gain, 0.001, p.decay);
    n.connect(bp); env.connect(out); n.start(0);

    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(150 * jitter, 0);
    body.frequency.exponentialRampToValueAtTime(58, p.decay);
    this._env(ctx, body, 0, 0.22, 0.001, p.decay * 1.1).connect(out);
    body.start(0); body.stop(0.25);

    // Toe scuff: the grit that tells you what you are walking on.
    if (p.grit > 0.05) {
      const g = this._noise(ctx, 0.14, 0.9);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2400 * jitter;
      const ge = this._env(ctx, hp, 0.018, 0.13 * p.grit, 0.006, 0.11);
      g.connect(hp); ge.connect(out); g.start(0.018);
    }
    if (surface === 'metal') {
      const ring = ctx.createOscillator();
      ring.type = 'sine';
      ring.frequency.value = 2300 * jitter;
      this._env(ctx, ring, 0.002, 0.06, 0.001, 0.16).connect(out);
      ring.start(0.002); ring.stop(0.25);
    }
  }

  _buildUI(ctx, freq) {
    const out = ctx.destination;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, 0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.8, 0.05);
    this._env(ctx, o, 0, 0.10, 0.0008, 0.05).connect(out);
    o.start(0); o.stop(0.1);
    this._click(ctx, out, 0, freq * 2.4, 0.05, 0.01);
  }

  _buildStinger(ctx, end) {
    const out = ctx.destination;
    const root = end ? 98 : 131;
    const chord = end ? [1, 1.2, 1.5] : [1, 1.5, 2];
    chord.forEach((mul, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = root * mul;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(300, 0);
      lp.frequency.exponentialRampToValueAtTime(2400, 0.5);
      lp.frequency.exponentialRampToValueAtTime(400, end ? 1.7 : 1.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), 0.14);
      g.gain.exponentialRampToValueAtTime(0.0001, end ? 1.75 : 1.3);
      o.connect(lp); lp.connect(g); g.connect(out);
      o.start(0); o.stop(end ? 1.8 : 1.4);
    });
    // Low percussive hit at the top of the stinger.
    const hit = ctx.createOscillator();
    hit.type = 'sine';
    hit.frequency.setValueAtTime(120, 0);
    hit.frequency.exponentialRampToValueAtTime(38, 0.4);
    this._env(ctx, hit, 0, 0.5, 0.002, 0.45).connect(out);
    hit.start(0); hit.stop(0.6);
  }

  // ------------------------------------------------------------- playback

  _panner() {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3.5;
    p.maxDistance = 400;
    p.rolloffFactor = 0.9;
    return p;
  }

  /**
   * Play a rendered buffer at a world position.
   * Distance also drives a lowpass, because air and geometry eat high
   * frequencies long before they eat volume.
   */
  play(name, position, { gain = 1, rate = 1, delay = 0, filter = true, reverb = 1 } = {}) {
    if (!this.ready || this._voices > this._maxVoices) return null;
    const buf = this.buffers[name];
    if (!buf) return null;
    const t = this.ctx.currentTime + delay;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const g = this.ctx.createGain();
    g.gain.value = gain;

    let node = src;
    if (position) {
      const dist = this.listenerPos.distanceTo(position);
      if (filter) {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        // ~-6 dB per doubling above 20 m, floored so distant shots stay audible
        lp.frequency.value = THREE.MathUtils.clamp(19000 * Math.pow(0.55, dist / 22), 320, 19000);
        node.connect(lp);
        node = lp;
      }
      const panner = this._panner();
      panner.positionX ? panner.positionX.value = position.x : panner.setPosition(position.x, position.y, position.z);
      if (panner.positionX) { panner.positionY.value = position.y; panner.positionZ.value = position.z; }
      node.connect(panner);
      node = panner;
    }
    node.connect(g);

    if (reverb !== 1) {
      const dry = this.ctx.createGain();
      dry.gain.value = 1;
      g.connect(dry);
      dry.connect(this.muffleFilter);
      const wet = this.ctx.createGain();
      wet.gain.value = reverb * 0.3;
      g.connect(wet);
      wet.connect(this.reverbNear);
    } else {
      g.connect(this.sfxBus);
    }

    this._voices++;
    src.onended = () => { this._voices--; };
    src.start(t);
    return src;
  }

  // ---- game-facing helpers -------------------------------------------------

  playGunshot(position, { firstPerson = false } = {}) {
    if (!this.ready) return;
    const dist = this.listenerPos.distanceTo(position);
    const near = dist < 45;
    const gain = firstPerson ? 0.85 : THREE.MathUtils.clamp(1.6 / (1 + dist * 0.05), 0.08, 1.0);

    if (near) {
      this.play(this._rrIndex++ & 1 ? 'shot' : 'shotAlt', firstPerson ? null : position, {
        gain, rate: 0.97 + Math.random() * 0.06, reverb: 1
      });
    }
    // The travel time of sound is a real cue at these ranges.
    const delay = Math.min(dist / 343, 0.9);
    if (!near || dist > 12) {
      this.play('shotDistant', position, {
        gain: gain * (near ? 0.35 : 1.1), rate: 0.94 + Math.random() * 0.12, delay
      });
    }
    this.play('tail', position, {
      gain: gain * (firstPerson ? 0.35 : 0.5), delay: delay + 0.02, rate: 0.9 + Math.random() * 0.2
    });
  }

  /** Round cracking past the listener. */
  playSupersonicCrack(position, gain = 0.6) {
    this.play('supersonic', position, { gain, rate: 0.9 + Math.random() * 0.25 });
  }

  playImpact(position, surface, energy = 1) {
    const surfaceName = surfaceNameOf(surface);
    const map = {
      concrete: 'impactConcrete', plaster: 'impactConcrete', brick: 'impactConcrete',
      tile: 'impactConcrete', metal: 'impactMetal', wood: 'impactWood',
      glass: 'impactGlass', sand: 'impactSand', dirt: 'impactSand',
      fabric: 'impactSand', sandbag: 'impactSand', rubber: 'impactWood'
    };
    this.play(map[surfaceName] || 'impactConcrete', position, {
      gain: 0.5 * energy, rate: 0.85 + Math.random() * 0.35
    });
  }

  playRicochet(position) {
    this.play('ricochet', position, { gain: 0.42, rate: 0.8 + Math.random() * 0.5 });
  }

  playFleshImpact(position, zone) {
    this.play(zone === 'head' ? 'fleshHead' : 'fleshBody', position, {
      gain: 0.6, rate: 0.9 + Math.random() * 0.2
    });
  }

  playFootstep(position, surface, intensity = 1) {
    const map = {
      concrete: 'stone', plaster: 'stone', brick: 'stone', tile: 'stone',
      metal: 'metal', wood: 'wood', glass: 'stone',
      sand: 'sand', dirt: 'gravel', fabric: 'sand', sandbag: 'sand', rubber: 'wood'
    };
    const surf = map[surfaceNameOf(surface)] || 'stone';
    const v = (Math.random() * 4) | 0;
    this.play(`step_${surf}_${v}`, position, {
      gain: 0.42 * intensity, rate: 0.9 + Math.random() * 0.2
    });
  }

  playReload(position, gain = 1) {
    this.play('magOut', position, { gain: 0.5 * gain });
    this.play('magIn', position, { gain: 0.55 * gain, delay: 0.85 });
  }

  playHitmarker(kill) {
    this.play(kill ? 'hitmarkerKill' : 'hitmarker', null, { gain: 0.5 });
  }

  playUI(kind) {
    this.play(kind === 'back' ? 'uiBack' : kind === 'hover' ? 'uiHover' : 'uiClick', null, {
      gain: kind === 'hover' ? 0.25 : 0.4
    });
  }

  playStinger(end) { this.play(end ? 'matchEnd' : 'matchStart', null, { gain: 0.7 }); }
  playHurt() { this.play('hurt', null, { gain: 0.6 }); }
  playCasing(position) { this.play('casing', position, { gain: 0.32, rate: 0.85 + Math.random() * 0.3 }); }
  playBolt(back) { this.play(back ? 'boltBack' : 'boltForward', null, { gain: 0.45 }); }

  // ---- first-person weapon events -----------------------------------------
  // These play unpositioned: the gun is at the listener's shoulder, and
  // panning something that close only makes it sound detached from the view.

  /**
   * The player's own shot. A hot barrel gets a slightly sharper report, and
   * firing indoors swaps the street slap for a much wetter room.
   */
  playShot(position, { heat = 0, indoors = 0 } = {}) {
    if (!this.ready) return;
    this.play(this._rrIndex++ & 1 ? 'shot' : 'shotAlt', null, {
      gain: 0.9, rate: 0.985 + heat * 0.03 + Math.random() * 0.02, reverb: 1
    });
    this.play('tail', null, {
      gain: 0.3 + indoors * 0.5, delay: 0.015, rate: indoors > 0.4 ? 1.25 : 0.95
    });
    // Reflections off the far side of the street arrive a beat later.
    this.play('shotDistant', position || null, { gain: 0.22, delay: 0.09, rate: 0.8 });
  }

  playDryFire() { this.play('dryFire', null, { gain: 0.45 }); }
  playSelector() { this.play('selector', null, { gain: 0.4 }); }
  playReloadStart() { /* the individual stages below carry the sound */ }
  playMagOut() { this.play('magOut', null, { gain: 0.6 }); }
  playMagIn() { this.play('magIn', null, { gain: 0.65 }); }
  playChargingHandle() {
    this.play('boltBack', null, { gain: 0.6 });
    this.play('boltForward', null, { gain: 0.65, delay: 0.11 });
  }

  playJump(position, surface) {
    this.playFootstep(position, surface, 0.5);
  }

  playLand(position, surface, impact) {
    this.playFootstep(position, surface, Math.min(1.6, 0.7 + impact * 1.4));
    if (impact > 0.5) this.play('hurt', null, { gain: impact * 0.25 });
  }

  dispose() { this.ctx?.close(); }
}

/** Accept either a SURFACE index or a name, since both are used upstream. */
function surfaceNameOf(surface) {
  if (typeof surface === 'string') return surface;
  return SURFACE_INFO[surface]?.name ?? 'concrete';
}
