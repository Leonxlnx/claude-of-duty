import * as THREE from 'three';
import { CharacterController } from '../physics/CharacterController.js';
import { Spring, Spring3, damp } from '../core/Spring.js';
import { Settings } from '../core/Settings.js';
import { SURFACE_INFO } from '../physics/BVH.js';

/**
 * First-person player: grounded acceleration-based movement with stance
 * blending, an eye rig that reacts to every impulse in the simulation, and the
 * accuracy state the weapon reads to place its shots.
 *
 * The controller integrates on the fixed step; the eye rig is evaluated at
 * render time from interpolated state so the view is always smooth.
 */

const STANCE = { STAND: 0, CROUCH: 1 };
const TAU = Math.PI * 2;

const SPEED = {
  walk: 4.25,
  sprint: 6.6,
  crouch: 2.15,
  ads: 2.5,
  air: 1.4
};

const ACCEL = { ground: 62, air: 11, friction: 11.5 };
const GRAVITY = 21.5;
const JUMP_VELOCITY = 6.15;

export class Player {
  constructor(world, input, audio) {
    this.world = world;
    this.input = input;
    this.audio = audio;

    this.controller = new CharacterController(world.bvh, {
      radius: 0.33, height: 1.76, crouchHeight: 1.16, stepOffset: 0.44, slopeLimit: 50
    });

    this.yaw = 0;
    this.pitch = 0;
    this.stance = STANCE.STAND;
    this.stanceBlend = 0;          // 0 stand, 1 crouch
    this.sprinting = false;
    this.wantsAds = false;
    this.adsBlend = 0;
    this.speed2D = 0;
    this.moveInput = new THREE.Vector2();
    this.wishDir = new THREE.Vector3();

    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.alive = true;
    this.lastDamageTime = -99;
    this.regenDelay = 5.5;
    this.regenRate = 14;

    this.team = 'A';
    this.kills = 0;
    this.deaths = 0;

    // --- eye rig
    this.eye = new THREE.Vector3();
    this.eyeHeight = 1.62;
    this.crouchEyeHeight = 1.06;
    this.bobPhase = 0;
    this.bobAmount = new Spring3(26, 1.0);
    this.leanSpring = new Spring(0, 15, 0.85);
    this.pitchKick = new Spring(0, 26, 0.62);
    this.yawKick = new Spring(0, 24, 0.66);
    this.rollKick = new Spring(0, 18, 0.7);
    this.heightSpring = new Spring(this.eyeHeight, 14, 1.0);
    this.landDip = new Spring(0, 19, 0.72);
    this.breath = 0;

    // recoil that the camera actually keeps (weapon adds to this)
    this.viewRecoil = new THREE.Vector2();
    this.recoilRecovery = new THREE.Vector2();

    this.footstepDistance = 0;
    this.lastSurface = 0;
    this.airTime = 0;
    this.timeSinceFire = 99;

    this._prevPosition = new THREE.Vector3();
    this._renderPosition = new THREE.Vector3();
    this.stepSmooth = 0;
    this.velocity = this.controller.velocity;
    this.spawnProtect = 0;
  }

  get position() { return this.controller.position; }
  get crouched() { return this.stance === STANCE.CROUCH; }

  spawn(point) {
    this.controller.position.copy(point);
    this.controller.velocity.set(0, 0, 0);
    this._prevPosition.copy(point);
    this.stepSmooth = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.stance = STANCE.STAND;
    this.stanceBlend = 0;
    this.heightSpring.set(this.eyeHeight);
    this.viewRecoil.set(0, 0);
    this.spawnProtect = 1.25;
    this.controller.setHeight(this.controller.standHeight);
  }

  /** Mouse look is applied every frame, not on the fixed step. */
  look(dx, dy) {
    if (!this.alive) return;
    const scale = 1 - this.adsBlend * (1 - Settings.data.adsMultiplier);
    this.yaw -= dx * scale;
    this.pitch -= dy * scale;
    const limit = Math.PI * 0.5 - 0.015;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** Recoil is added to the aim and then partially recovered. */
  addRecoil(pitchRad, yawRad, recoverFraction = 0.72) {
    this.pitch += pitchRad;
    this.yaw += yawRad;
    this.viewRecoil.x += pitchRad * recoverFraction;
    this.viewRecoil.y += yawRad * recoverFraction;
    const limit = Math.PI * 0.5 - 0.015;
    this.pitch = Math.min(limit, this.pitch);
  }

  /** Called on the fixed simulation step. */
  update(dt, time) {
    this._prevPosition.copy(this.controller.position);
    this.timeSinceFire += dt;
    this.spawnProtect = Math.max(0, this.spawnProtect - dt);

    if (!this.alive) {
      this.controller.velocity.y -= GRAVITY * dt;
      _disp.copy(this.controller.velocity).multiplyScalar(dt);
      this.controller.move(dt, _disp);
      return;
    }

    const input = this.input;
    const fwd = (input.action('forward') ? 1 : 0) - (input.action('back') ? 1 : 0);
    const strafe = (input.action('right') ? 1 : 0) - (input.action('left') ? 1 : 0);
    this.moveInput.set(strafe, fwd);
    if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();

    // ---- stance
    const wantCrouch = input.action('crouch');
    if (wantCrouch && this.stance !== STANCE.CROUCH) {
      this.stance = STANCE.CROUCH;
    } else if (!wantCrouch && this.stance === STANCE.CROUCH) {
      this.controller.setHeight(this.controller.crouchHeight);
      if (this.controller.canStand()) this.stance = STANCE.STAND;
    }
    const targetBlend = this.stance === STANCE.CROUCH ? 1 : 0;
    this.stanceBlend = damp(this.stanceBlend, targetBlend, 13, dt);
    this.controller.setHeight(
      THREE.MathUtils.lerp(this.controller.standHeight, this.controller.crouchHeight, this.stanceBlend)
    );

    // ---- sprint / ads
    const movingForward = fwd > 0.1 && Math.abs(strafe) < 0.9;
    this.sprinting = input.action('sprint') && movingForward && !this.crouched
      && this.controller.grounded && !this.wantsAds && this.timeSinceFire > 0.16;
    const adsTarget = this.wantsAds && !this.sprinting ? 1 : 0;
    this.adsBlend = damp(this.adsBlend, adsTarget, adsTarget > 0.5 ? 17 : 14, dt);

    // ---- desired velocity
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    this.wishDir.set(
      this.moveInput.x * cos - this.moveInput.y * sin,
      0,
      -this.moveInput.x * sin - this.moveInput.y * cos
    );

    let maxSpeed = SPEED.walk;
    if (this.crouched) maxSpeed = SPEED.crouch;
    else if (this.sprinting) maxSpeed = SPEED.sprint;
    if (this.adsBlend > 0.05) maxSpeed = Math.min(maxSpeed, THREE.MathUtils.lerp(maxSpeed, SPEED.ads, this.adsBlend));

    const vel = this.controller.velocity;
    const grounded = this.controller.grounded;

    if (grounded) {
      // friction first, then acceleration — classic and predictable
      const speed = Math.hypot(vel.x, vel.z);
      if (speed > 0.001) {
        const drop = Math.max(speed, 2.4) * ACCEL.friction * dt;
        const k = Math.max(0, speed - drop) / speed;
        vel.x *= k; vel.z *= k;
      }
      const accel = ACCEL.ground * dt;
      const targetX = this.wishDir.x * maxSpeed;
      const targetZ = this.wishDir.z * maxSpeed;
      vel.x += THREE.MathUtils.clamp(targetX - vel.x, -accel, accel);
      vel.z += THREE.MathUtils.clamp(targetZ - vel.z, -accel, accel);
      this.airTime = 0;
    } else {
      // air control: only redirect, never add speed beyond the cap
      const wishSpeed = Math.min(maxSpeed, SPEED.air + 2.5);
      const current = vel.x * this.wishDir.x + vel.z * this.wishDir.z;
      const add = Math.min(wishSpeed - current, ACCEL.air * dt * maxSpeed / SPEED.walk);
      if (add > 0) {
        vel.x += this.wishDir.x * add;
        vel.z += this.wishDir.z * add;
      }
      this.airTime += dt;
    }

    // ---- jump
    if (input.action('jump') && grounded && this.controller.velocity.y <= 0.4) {
      vel.y = JUMP_VELOCITY * (this.crouched ? 0.82 : 1);
      this.controller.grounded = false;
      this.audio?.playJump(this.controller.position, this.controller.groundSurface);
    }

    vel.y -= GRAVITY * dt;
    vel.y = Math.max(vel.y, -58);

    _disp.copy(vel).multiplyScalar(dt);
    this.controller.move(dt, _disp);

    // Cancel the controller's vertical teleports out of the eye and let the
    // offset bleed off over a few frames. Without this, walking over kerbs and
    // road camber shows up as a hard vertical tick every step.
    this.stepSmooth = THREE.MathUtils.clamp(
      this.stepSmooth - this.controller.stepCorrection,
      -this.controller.stepOffset, this.controller.stepOffset
    );

    this.speed2D = Math.hypot(vel.x, vel.z);

    // ---- landing
    if (this.controller.landingImpact > 0) {
      const impact = this.controller.landingImpact;
      this.landDip.nudge(-impact * 3.4);
      this.pitchKick.nudge(impact * 0.42);
      this.audio?.playLand(this.controller.position, this.controller.groundSurface, impact);
      if (impact > 0.72) this.applyDamage((impact - 0.72) * 130, null, 'fall');
    }

    // ---- footsteps by distance travelled, not by timer
    if (grounded && this.speed2D > 0.6) {
      this.footstepDistance += this.speed2D * dt;
      const stride = this.crouched ? 1.35 : this.sprinting ? 2.05 : 1.75;
      if (this.footstepDistance >= stride) {
        this.footstepDistance -= stride;
        const loud = this.sprinting ? 1 : this.crouched ? 0.35 : 0.68;
        this.audio?.playFootstep(this.controller.position, this.controller.groundSurface, loud);
        this.onFootstep?.(loud, this.controller.groundSurface);
      }
    } else if (!grounded) {
      this.footstepDistance = 1.2;
    }

    // ---- recoil recovery pulls the view back toward where it was
    const recover = 1 - Math.exp(-8.5 * dt);
    const dx = this.viewRecoil.x * recover;
    const dy = this.viewRecoil.y * recover;
    this.pitch -= dx;
    this.yaw -= dy;
    this.viewRecoil.x -= dx;
    this.viewRecoil.y -= dy;

    // ---- health regeneration after a lull
    if (this.alive && time - this.lastDamageTime > this.regenDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + this.regenRate * dt);
    }

    this.lastSurface = this.controller.groundSurface;
  }

  /** Render-rate eye rig: bob, sway, lean, kick, breathing. */
  updateView(dt, alpha, time) {
    const c = this.controller;
    this._renderPosition.lerpVectors(this._prevPosition, c.position, alpha);

    const standEye = THREE.MathUtils.lerp(this.eyeHeight, this.crouchEyeHeight, this.stanceBlend);
    this.heightSpring.target = standEye;
    this.heightSpring.update(dt);

    // walk cycle drives a figure-eight, scaled by actual speed
    const speedNorm = THREE.MathUtils.clamp(this.speed2D / SPEED.walk, 0, 1.6);
    const grounded = c.grounded;
    const bobRate = this.sprinting ? 10.4 : this.crouched ? 6.2 : 8.4;
    if (grounded) {
      this.bobPhase = (this.bobPhase + dt * bobRate * Math.min(speedNorm, 1.4)) % TAU;
    }

    const bobScale = (grounded ? speedNorm : 0) * (1 - this.adsBlend * 0.78) * Settings.data.cameraShake;
    // A smooth figure-eight: lateral at stride rate, vertical at twice that.
    // abs(sin) is the obvious way to get two dips per stride and it is wrong —
    // it has a corner at every zero, so the head changes vertical direction
    // instantly and running reads as a stutter rather than a gait.
    this.bobAmount.target.set(
      Math.sin(this.bobPhase) * 0.026 * bobScale,
      Math.cos(this.bobPhase * 2) * -0.012 * bobScale,
      0
    );
    this.bobAmount.update(dt);

    // lean into strafing, roll out of it when aiming
    const strafeLean = -this.moveInput.x * (this.sprinting ? 0.055 : 0.034) * (1 - this.adsBlend * 0.85);
    this.leanSpring.target = strafeLean;
    this.leanSpring.update(dt);

    this.landDip.target = 0;
    this.landDip.update(dt);
    this.pitchKick.target = 0; this.pitchKick.update(dt);
    this.yawKick.target = 0; this.yawKick.update(dt);
    this.rollKick.target = 0; this.rollKick.update(dt);

    // idle breathing, stronger when winded, almost gone when aiming
    this.breath += dt * (this.sprinting ? 2.4 : 1.05);
    const breathAmp = (0.0016 + (1 - THREE.MathUtils.clamp(this.health / 100, 0, 1)) * 0.0035)
      * (1 - this.adsBlend * 0.6);

    this.stepSmooth *= Math.exp(-dt / 0.055);
    this.eye.copy(this._renderPosition);
    this.eye.y += this.heightSpring.value + this.landDip.value * 0.055 + this.stepSmooth;

    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const bob = this.bobAmount.value;
    this.eye.x += (bob.x * cos) ;
    this.eye.z += (-bob.x * sin);
    this.eye.y += bob.y;

    this.viewPitch = this.pitch + this.pitchKick.value + Math.sin(this.breath * 1.7) * breathAmp;
    this.viewYaw = this.yaw + this.yawKick.value + Math.sin(this.breath * 0.9 + 1.2) * breathAmp * 1.4;
    this.viewRoll = this.leanSpring.value + this.rollKick.value
      + Math.sin(this.bobPhase + 1.1) * 0.012 * bobScale;
  }

  applyToCamera(camera) {
    camera.position.copy(this.eye);
    camera.quaternion.setFromEuler(_euler.set(this.viewPitch, this.viewYaw, this.viewRoll, 'YXZ'));
    camera.updateMatrixWorld();
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Aim origin sits at the eye so shots always match the reticle. */
  aimOrigin(out = new THREE.Vector3()) {
    return out.copy(this.eye);
  }

  applyDamage(amount, source, kind = 'bullet') {
    if (!this.alive || this.spawnProtect > 0) return false;
    this.health -= amount;
    this.lastDamage = { amount, source, kind, time: performance.now() / 1000 };
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      this.onDeath?.(source);
      return true;
    }
    return false;
  }

  surfaceName() {
    return SURFACE_INFO[this.lastSurface]?.name ?? 'concrete';
  }
}

const _disp = new THREE.Vector3();
const _euler = new THREE.Euler();
export { STANCE, SPEED };
