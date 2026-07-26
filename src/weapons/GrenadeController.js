import * as THREE from 'three';
import { GRENADE } from '../combat/Combat.js';

/**
 * The grenade in your hand.
 *
 * Deliberately modal: the key takes one out and puts it away again, and while
 * it is out the rifle is not available. Committing to the throw is the cost of
 * the throw, and being able to back out of it — same key, no penalty — is what
 * makes committing reasonable. A throw hands the rifle straight back.
 *
 * The fuse starts when the pin comes out, not when the grenade lands, so a long
 * charge is a real trade: distance against how much of the fuse is left when it
 * arrives. Cooking one too long is entirely possible.
 */

const STATE = {
  STOWED: 'stowed',
  RAISING: 'raising',
  READY: 'ready',
  CHARGING: 'charging',
  THROWING: 'throwing',
  LOWERING: 'lowering'
};

const RAISE_TIME = 0.34;
const LOWER_TIME = 0.26;
const THROW_TIME = 0.42;
/** Into the throw animation, the point the grenade actually leaves the hand. */
const RELEASE_AT = 0.17;
/** Thrown slightly above the crosshair, the way an arm actually works. */
const THROW_PITCH = 0.13;

export class GrenadeController {
  constructor({ player, audio, onThrow }) {
    this.player = player;
    this.audio = audio;
    this.onThrow = onThrow;

    this.count = GRENADE.carried;
    this.state = STATE.STOWED;
    this.stateTime = 0;
    this.charge = 0;
    this._released = false;
    this._wasFiring = false;
  }

  get equipped() { return this.state !== STATE.STOWED; }
  /** True while the rifle must stay out of the player's hands. */
  get blocksWeapon() { return this.equipped; }
  /** 0..1, how far the raise animation has come. */
  get raiseBlend() {
    if (this.state === STATE.RAISING) return Math.min(1, this.stateTime / RAISE_TIME);
    if (this.state === STATE.LOWERING) return 1 - Math.min(1, this.stateTime / LOWER_TIME);
    return this.state === STATE.STOWED ? 0 : 1;
  }
  /** 0..1 through the throw, for the arm animation. */
  get throwBlend() {
    return this.state === STATE.THROWING ? Math.min(1, this.stateTime / THROW_TIME) : 0;
  }

  reset() {
    this.count = GRENADE.carried;
    this.state = STATE.STOWED;
    this.stateTime = 0;
    this.charge = 0;
    this._released = false;
  }

  /** Same key that took it out puts it away — but not mid-throw. */
  toggle() {
    if (this.state === STATE.THROWING || this.state === STATE.LOWERING) return;
    if (this.state === STATE.STOWED) {
      if (this.count <= 0 || !this.player.alive) return;
      this.state = STATE.RAISING;
      this.stateTime = 0;
      this.audio?.playGrenadePin();
    } else {
      this.state = STATE.LOWERING;
      this.stateTime = 0;
      this.charge = 0;
    }
  }

  stow() {
    if (this.state === STATE.STOWED || this.state === STATE.THROWING) return;
    this.state = STATE.LOWERING;
    this.stateTime = 0;
    this.charge = 0;
  }

  update(dt, { firing }) {
    this.stateTime += dt;

    if (!this.player.alive && this.state !== STATE.STOWED) {
      this.state = STATE.STOWED;
      this.charge = 0;
      return;
    }

    switch (this.state) {
      case STATE.RAISING:
        if (this.stateTime >= RAISE_TIME) {
          this.state = STATE.READY;
          this.stateTime = 0;
          // A press that was already down when the grenade came up must not
          // start charging; the throw needs its own deliberate press.
          this._wasFiring = firing;
        }
        break;

      case STATE.READY:
        if (firing && !this._wasFiring) {
          this.state = STATE.CHARGING;
          this.stateTime = 0;
          this.charge = 0;
        }
        break;

      case STATE.CHARGING:
        this.charge = Math.min(1, this.charge + dt / GRENADE.chargeTime);
        if (!firing) this._release();
        break;

      case STATE.THROWING:
        if (!this._released && this.stateTime >= RELEASE_AT) this._spawn();
        if (this.stateTime >= THROW_TIME) {
          // Back to the rifle. Staying in grenade mode would leave the player
          // holding one and unable to shoot at the thing they just threw at.
          this.state = STATE.LOWERING;
          this.stateTime = 0;
          this.charge = 0;
        }
        break;

      case STATE.LOWERING:
        if (this.stateTime >= LOWER_TIME) {
          this.state = STATE.STOWED;
          this.stateTime = 0;
        }
        break;

      default:
        break;
    }

    this._wasFiring = firing;
  }

  _release() {
    this.state = STATE.THROWING;
    this.stateTime = 0;
    this._released = false;
    this.audio?.playGrenadeThrow();
  }

  _spawn() {
    this._released = true;
    if (this.count <= 0) return;
    this.count--;

    const p = this.player;
    const speed = THREE.MathUtils.lerp(GRENADE.minSpeed, GRENADE.maxSpeed, this.charge);

    // Out of the right hand rather than out of the eye, so a throw taken hard
    // against a wall does not start on the far side of it.
    _dir.set(0, 0, -1).applyEuler(_euler.set(p.viewPitch + THROW_PITCH, p.viewYaw, 0, 'YXZ'));
    _right.set(1, 0, 0).applyEuler(_euler.set(0, p.viewYaw, 0, 'YXZ'));
    _origin.copy(p.eye).addScaledVector(_right, 0.16).addScaledVector(_dir, 0.3);
    _origin.y -= 0.08;

    _vel.copy(_dir).multiplyScalar(speed);
    // Inherit what the thrower is doing; running throws go further.
    _vel.x += p.controller.velocity.x * 0.6;
    _vel.z += p.controller.velocity.z * 0.6;

    this.onThrow?.(_origin, _vel);
  }

  /** Everything the HUD needs, in one read. */
  hudState() {
    return {
      count: this.count,
      equipped: this.equipped,
      charging: this.state === STATE.CHARGING,
      charge: this.charge
    };
  }
}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _euler = new THREE.Euler();
