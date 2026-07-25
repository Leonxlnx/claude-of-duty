import * as THREE from 'three';
import { SeededRandom } from '../core/SeededRandom.js';

/**
 * Fire control for the carbine.
 *
 * The recoil pattern is a fixed, learnable curve — the same magazine dumped
 * twice climbs the same way — while spread is a separate, state-driven cone
 * that only opens when the player does something that should cost accuracy.
 * First shot from a settled stance is exact.
 */

export const FIRE_MODE = { AUTO: 0, BURST: 1, SEMI: 2 };
export const FIRE_MODE_NAME = ['AUTO', 'BURST', 'SEMI'];

const CARBINE = {
  name: 'MK18 CARBINE',
  caliber: '5.56x45',
  rpm: 780,
  magSize: 30,
  reserve: 210,
  damage: 27,
  headMultiplier: 2.35,
  limbMultiplier: 0.82,
  muzzleVelocity: 860,
  falloffStart: 34,
  falloffEnd: 96,
  falloffFloor: 0.58,
  penetration: 0.85,
  reloadTactical: 2.05,
  reloadEmpty: 2.95,
  drawTime: 0.62,
  adsTime: 0.19,
  // spread in radians
  spreadBase: 0.0006,
  spreadAds: 0.00022,
  spreadMove: 0.0125,
  spreadAir: 0.030,
  spreadCrouch: 0.72,
  spreadPerShot: 0.00085,
  spreadDecay: 5.6,
  spreadMax: 0.026
};

/** Deterministic recoil: a rising trunk with a signed horizontal drift. */
function buildRecoilPattern(seed, count) {
  const rng = new SeededRandom(seed);
  const pattern = [];
  let x = 0;
  let drift = 0;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // vertical climbs fast for the first 6 rounds then tapers
    const vertical = 0.0090 * (1 - Math.exp(-i * 0.55)) + 0.0016 + t * 0.0010;
    // horizontal wanders in long strokes rather than jittering per shot
    if (i % 4 === 0) drift = (rng.next() * 2 - 1) * 0.0034 + (i > 8 ? 0.0016 : 0);
    x = x * 0.62 + drift * 0.38;
    const horizontal = x + Math.sin(i * 0.42) * 0.0009 * Math.min(1, i / 5);
    pattern.push([vertical, horizontal]);
  }
  return pattern;
}

export class Weapon {
  constructor({ audio, viewModel, player, combat, seed = 0x1f0a }) {
    this.spec = CARBINE;
    this.audio = audio;
    this.vm = viewModel;
    this.player = player;
    this.combat = combat;

    this.pattern = buildRecoilPattern(seed, this.spec.magSize + 4);
    this.rng = new SeededRandom(seed ^ 0x77);

    this.ammo = this.spec.magSize;
    this.reserve = this.spec.reserve;
    this.chambered = true;
    this.fireMode = FIRE_MODE.AUTO;
    this.shotIndex = 0;
    this.fireTimer = 0;
    this.triggerHeld = false;
    this.triggerPulled = false;
    this.burstRemaining = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.reloadType = null;
    this.spread = 0;
    this.lastShotTime = -99;
    this.boltLocked = false;
    this.heat = 0;
    this.totalShots = 0;
    this.hits = 0;
  }

  get magEmpty() { return this.ammo <= 0; }
  get shotInterval() { return 60 / this.spec.rpm; }

  cycleFireMode() {
    this.fireMode = (this.fireMode + 1) % 3;
    this.audio?.playSelector(this.player.eye);
    return FIRE_MODE_NAME[this.fireMode];
  }

  setTrigger(down) {
    if (down && !this.triggerHeld) this.triggerPulled = true;
    this.triggerHeld = down;
  }

  canFire() {
    return !this.reloading && this.ammo > 0 && this.fireTimer <= 0
      && !this.player.sprinting && this.player.alive;
  }

  startReload() {
    if (this.reloading || this.ammo >= this.spec.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadType = this.ammo <= 0 ? 'empty' : 'tactical';
    this.reloadTimer = this.reloadType === 'empty' ? this.spec.reloadEmpty : this.spec.reloadTactical;
    this._reloadTotal = this.reloadTimer;
    this._magOut = false;
    this._magIn = false;
    this._charged = this.reloadType !== 'empty';
    this.audio?.playReloadStart(this.player.eye, this.reloadType);
    this._playReloadAnim();
    return true;
  }

  _playReloadAnim() {
    const empty = this.reloadType === 'empty';
    const dur = this._reloadTotal;
    this.vm.startAction('reload', dur, (t, p, r, vm) => {
      // canted-in mag change; the gun rolls toward the support hand and dips
      const dip = Math.sin(Math.min(t * 3.6, Math.PI)) * 1.0;
      const roll = Math.sin(Math.min(t * 3.0, Math.PI)) * 1.0;
      p.x += 0.052 * dip;
      p.y += -0.078 * dip;
      p.z += 0.030 * dip;
      r.x += 0.30 * dip;
      r.y += -0.42 * roll;
      r.z += 0.55 * roll;

      if (empty) {
        // charging handle yank at the tail of the animation
        const c = THREE.MathUtils.clamp((t - 0.74) / 0.16, 0, 1);
        vm.chSpring.value = Math.sin(c * Math.PI);
        if (t > 0.86) vm.boltSpring.target = 0;
        const shake = Math.exp(-Math.pow((t - 0.80) * 22.0, 2.0));
        p.x -= 0.02 * shake;
        r.z += 0.10 * shake;
      }
    });
  }

  update(dt, time) {
    this.fireTimer -= dt;
    this.spread = Math.max(0, this.spread - this.spec.spreadDecay * this.spread * dt);
    this.heat = Math.max(0, this.heat - dt * 0.45);

    if (this.reloading) {
      this.reloadTimer -= dt;
      const progress = 1 - this.reloadTimer / this._reloadTotal;
      if (!this._magOut && progress > 0.26) {
        this._magOut = true;
        this.audio?.playMagOut(this.player.eye);
        this.combat?.dropMagazine(this.vm);
      }
      if (!this._magIn && progress > 0.62) {
        this._magIn = true;
        this.audio?.playMagIn(this.player.eye);
      }
      if (!this._charged && progress > 0.84) {
        this._charged = true;
        this.audio?.playChargingHandle(this.player.eye);
      }
      if (this.reloadTimer <= 0) this._finishReload();
      return;
    }

    if (this.player.sprinting) {
      this.triggerPulled = false;
      this.burstRemaining = 0;
      return;
    }

    let wantShot = false;
    if (this.fireMode === FIRE_MODE.AUTO) {
      wantShot = this.triggerHeld;
    } else if (this.fireMode === FIRE_MODE.SEMI) {
      wantShot = this.triggerPulled;
    } else {
      if (this.triggerPulled && this.burstRemaining === 0) this.burstRemaining = 3;
      wantShot = this.burstRemaining > 0;
    }
    this.triggerPulled = false;

    if (wantShot && this.canFire()) {
      this.fire(time);
      if (this.fireMode === FIRE_MODE.BURST) this.burstRemaining--;
    } else if (wantShot && this.ammo <= 0 && this.fireTimer <= 0 && !this.reloading) {
      this.fireTimer = 0.22;
      this.audio?.playDryFire(this.player.eye);
      this.boltLocked = true;
      this.burstRemaining = 0;
    }
  }

  _finishReload() {
    const need = this.spec.magSize - this.ammo;
    const take = Math.min(need + (this.reloadType === 'empty' ? 0 : 0), this.reserve);
    this.ammo += take;
    this.reserve -= take;
    this.reloading = false;
    this.boltLocked = false;
    this.shotIndex = 0;
    this.spread = 0;
  }

  fire(time) {
    this.ammo--;
    this.totalShots++;
    this.fireTimer = this.shotInterval;
    this.lastShotTime = time;
    this.player.timeSinceFire = 0;
    this.heat = Math.min(1, this.heat + 0.055);
    if (this.ammo <= 0) this.boltLocked = true;

    const idx = Math.min(this.shotIndex, this.pattern.length - 1);
    const [vert, horiz] = this.pattern[idx];
    this.shotIndex++;

    // stance and stability scale how much of the pattern reaches the view
    const adsScale = 1 - this.player.adsBlend * 0.30;
    const crouchScale = this.player.crouched ? 0.82 : 1;
    const moveScale = 1 + THREE.MathUtils.clamp(this.player.speed2D / 6, 0, 1) * 0.28;
    const kick = adsScale * crouchScale * moveScale;

    this.player.addRecoil(vert * kick, horiz * kick, 0.68);
    this.player.pitchKick.nudge(vert * kick * 5.5);
    this.player.yawKick.nudge(horiz * kick * 4.0);
    this.player.rollKick.nudge(-horiz * kick * 8.0);

    this.vm.applyRecoil({
      back: 0.030 * kick,
      rise: 0.11 * kick,
      yaw: horiz * 1.6,
      roll: 0.03 * kick,
      lateral: -horiz * 0.9
    });

    // spread grows per shot and with movement state
    this.spread = Math.min(this.spec.spreadMax, this.spread + this.spec.spreadPerShot);

    const dir = this._shotDirection();
    this.combat.fireBullet({
      origin: this.player.aimOrigin(_origin),
      direction: dir,
      owner: this.player,
      team: this.player.team,
      damage: this.spec.damage,
      spec: this.spec,
      muzzle: this.vm.muzzleWorld,
      viewModel: this.vm,
      firstPerson: true
    });

    this.audio?.playShot(this.player.eye, { heat: this.heat, indoors: this.combat.indoorFactor });
    this.combat.spawnMuzzleFlash(this.vm.muzzleWorld, this.vm.sightAxis, true);
    this.combat.ejectCasing(this.vm.ejectWorld, this.vm.ejectDirWorld, this.player.velocity);
    this.onFire?.();
  }

  /** Current aim cone, in radians. */
  currentSpread() {
    const p = this.player;
    let s = THREE.MathUtils.lerp(this.spec.spreadBase, this.spec.spreadAds, p.adsBlend);
    const moveNorm = THREE.MathUtils.clamp(p.speed2D / 4.25, 0, 1.5);
    s += this.spec.spreadMove * moveNorm * (1 - p.adsBlend * 0.55);
    if (!p.controller.grounded) s += this.spec.spreadAir * (1 - p.adsBlend * 0.35);
    if (p.crouched) s *= this.spec.spreadCrouch;
    s += this.spread * (1 - p.adsBlend * 0.35);
    return Math.min(s, this.spec.spreadMax * 2);
  }

  _shotDirection() {
    const dir = this.player.forward(_dir);
    const spread = this.currentSpread();
    if (spread > 1e-5) {
      // uniform disc in the aim plane, not a gaussian: the cone edge is a real limit
      const a = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(this.rng.next()) * spread;
      _right.set(dir.z, 0, -dir.x);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _right.normalize();
      _up.crossVectors(_right, dir).normalize();
      dir.addScaledVector(_right, Math.cos(a) * r);
      dir.addScaledVector(_up, Math.sin(a) * r);
      dir.normalize();
    }
    return dir;
  }

  hudState() {
    return {
      name: this.spec.name,
      ammo: this.ammo,
      magSize: this.spec.magSize,
      reserve: this.reserve,
      mode: FIRE_MODE_NAME[this.fireMode],
      reloading: this.reloading,
      reloadProgress: this.reloading ? 1 - this.reloadTimer / this._reloadTotal : 0,
      spread: this.currentSpread()
    };
  }
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
export { CARBINE };
