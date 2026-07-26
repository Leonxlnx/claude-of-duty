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

// The eye chases the body's height rather than sitting on it, so kerbs and
// stairs arrive as a glide instead of a jump. Tracking an absolute target
// (rather than accumulating the controller's individual corrections, which can
// fire forty times in a rendered frame across substeps) means this can lag but
// can never ratchet or oscillate.
const EYE_FOLLOW = 16;   // per-second convergence onto the body height
const EYE_MAX_LAG = 0.45;

// Running over rough ground leaves the floor for a frame at a time. Treating
// those as real airtime makes the sprint flag, the gait and everything reading
// them flicker, so a short grace period counts as still being on your feet.
const COYOTE_TIME = 0.15;

// Peeking. The eye slides sideways off the body so the player can clear a
// corner and shoot without walking their whole hitbox into the open.
const LEAN_OFFSET = 0.46;   // metres the head travels at full lean
const LEAN_ROLL = 0.21;     // radians of camera roll at full lean
const LEAN_DROP = 0.07;     // the head dips as it goes over
const LEAN_MARGIN = 0.22;   // keep the eye this far off whatever it leans into
const LEAN_PROBE_HEIGHTS = [0.12, -0.02, -0.34];

const SPEED = {
  walk: 5.7,
  sprint: 8.8,
  crouch: 2.9,
  ads: 3.3,
  air: 2.0
};

// Slide: crouch out of a sprint and keep the pace for a moment.
const SLIDE = {
  boost: 1.22,      // fraction of sprint speed the slide starts at
  minSpeed: 0.9,    // of walking pace, below which a slide will not start
  endSpeed: 4.2,    // metres per second at which it gives out
  friction: 2.4,    // how quickly it bleeds off — sets the length of the slide
  duration: 1.05,   // hard ceiling so it cannot be held forever
  cooldown: 0.45,
  steer: 2.6        // how much the slide can be aimed while it runs
};

// `ground` is a multiple of the current speed cap per second, not an absolute
// acceleration, so the ramp feels the same whether crouched or sprinting. It
// has to stay above `friction` or the cap becomes unreachable.
const ACCEL = { ground: 14, air: 11, friction: 11.5 };
const GRAVITY = 21.5;
const JUMP_VELOCITY = 6.15;

export class Player {
  constructor(world, input, audio) {
    this.world = world;
    this.input = input;
    this.audio = audio;

    this.controller = new CharacterController(world.bvh, {
      radius: 0.33, height: 1.76, crouchHeight: 0.95, stepOffset: 0.44, slopeLimit: 50
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
    this.crouchEyeHeight = 0.86;
    this.bobPhase = 0;
    this.bobAmount = new Spring3(26, 1.0);
    this.leanSpring = new Spring(0, 15, 0.85);
    this.pitchKick = new Spring(0, 26, 0.62);
    this.yawKick = new Spring(0, 24, 0.66);
    this.rollKick = new Spring(0, 18, 0.7);
    this.heightSpring = new Spring(this.eyeHeight, 17, 1.0);
    this.landDip = new Spring(0, 19, 0.72);
    this.breath = 0;

    // Peek. `leanInput` is what the keys ask for, `lean` is what the geometry
    // allows after the wall probe, `leanBlend` is what the camera actually
    // shows once it has eased there.
    this.leanInput = 0;
    this.lean = 0;
    this.leanBlend = 0;

    // recoil that the camera actually keeps (weapon adds to this)
    this.viewRecoil = new THREE.Vector2();
    this.recoilRecovery = new THREE.Vector2();

    this.footstepDistance = 0;
    this.lastSurface = 0;
    this.airTime = 0;
    this.timeSinceFire = 99;

    this._prevPosition = new THREE.Vector3();
    this._renderPosition = new THREE.Vector3();
    this._eyeY = null;
    this.airborneFor = 0;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideDir = new THREE.Vector3();
    this.velocity = this.controller.velocity;
    this.spawnProtect = 0;
  }

  get position() { return this.controller.position; }
  get crouched() { return this.stance === STANCE.CROUCH; }

  spawn(point) {
    this.controller.position.copy(point);
    this.controller.velocity.set(0, 0, 0);
    this._prevPosition.copy(point);
    this._eyeY = null;
    this.airborneFor = 0;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.stance = STANCE.STAND;
    this.stanceBlend = 0;
    this.heightSpring.set(this.eyeHeight);
    this.viewRecoil.set(0, 0);
    this.lean = this.leanBlend = this.leanInput = 0;
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

    // ---- slide
    // Crouching out of a sprint converts the run into a slide: the speed cap
    // lifts for a moment and then bleeds away, so it buys ground and a low
    // profile at the cost of not being able to change your mind.
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    const wantSlide = input.action('slide');
    // Gated on the sprint key plus real pace, not on `this.sprinting`. That
    // flag drops for a frame whenever a foot leaves the ground, and a slide
    // that silently refuses to start because of a kerb reads as broken rather
    // than strict. The speed bar sits just under walking pace so a run down a
    // street full of market stalls, which rarely gets near the sprint cap,
    // still slides — while standing still leaves C as a plain crouch.
    if (wantSlide && !this.sliding && this.slideCooldown === 0 && !this.crouched
        && input.action('sprint') && this.airborneFor < COYOTE_TIME
        && this.speed2D > SPEED.walk * SLIDE.minSpeed) {
      this.sliding = true;
      this.slideTime = 0;
      const speed = Math.hypot(this.controller.velocity.x, this.controller.velocity.z) || 1;
      this.slideDir.set(this.controller.velocity.x / speed, 0, this.controller.velocity.z / speed);
      // A shove on top of the pace already there, capped, rather than a jump to
      // a fixed number — otherwise sliding out of a cramped alley at half speed
      // would hand out more velocity than running down the open street.
      const boost = Math.min(speed * SLIDE.boost, SPEED.sprint * SLIDE.boost);
      this.controller.velocity.x = this.slideDir.x * boost;
      this.controller.velocity.z = this.slideDir.z * boost;
      this.audio?.playFootstep(this.controller.position, this.controller.groundSurface, 1);
      this.onSlide?.();
    }
    if (this.sliding) {
      this.slideTime += dt;
      const speed = Math.hypot(this.controller.velocity.x, this.controller.velocity.z);
      const done = !input.action('slide')
        || this.slideTime > SLIDE.duration
        || speed < SLIDE.endSpeed
        || this.airborneFor > COYOTE_TIME;
      if (done) {
        this.sliding = false;
        this.slideCooldown = SLIDE.cooldown;
      }
    }

    // ---- stance
    // The slide key is a crouch key that happens to launch a slide when there
    // is pace behind it, so it still does something sensible standing still.
    // A slide is itself a crouch you have not asked to leave yet.
    const wantCrouch = input.action('crouch') || input.action('slide') || this.sliding;
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

    // ---- peek
    this.leanInput = (input.action('leanRight') ? 1 : 0) - (input.action('leanLeft') ? 1 : 0);

    // ---- sprint / ads
    const movingForward = fwd > 0.1 && Math.abs(strafe) < 0.9;
    this.sprinting = input.action('sprint') && movingForward && !this.crouched
      && this.airborneFor < COYOTE_TIME && !this.wantsAds && this.timeSinceFire > 0.16;
    const adsTarget = this.wantsAds && !this.sprinting ? 1 : 0;
    this.adsBlend = damp(this.adsBlend, adsTarget, adsTarget > 0.5 ? 17 : 14, dt);

    // Sprinting is both hands on the weapon and a full stride; there is no
    // shoulder left to hang a lean off.
    this.lean = this.sprinting ? 0 : this._allowedLean(this.leanInput);

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

    if (grounded && this.sliding) {
      // A slide keeps its momentum and only bleeds off. Steering is deliberately
      // weak: committing to the direction is the whole cost of the move.
      const speed = Math.hypot(vel.x, vel.z);
      if (speed > 0.001) {
        const drop = speed * SLIDE.friction * dt;
        const k = Math.max(0, speed - drop) / speed;
        vel.x *= k; vel.z *= k;
      }
      vel.x += this.wishDir.x * SLIDE.steer * dt;
      vel.z += this.wishDir.z * SLIDE.steer * dt;
      this.airTime = 0;
    } else if (grounded) {
      // friction first, then acceleration — classic and predictable
      const speed = Math.hypot(vel.x, vel.z);
      if (speed > 0.001) {
        const drop = Math.max(speed, 2.4) * ACCEL.friction * dt;
        const k = Math.max(0, speed - drop) / speed;
        vel.x *= k; vel.z *= k;
      }
      // Accelerate along the wish direction, never past the cap.
      //
      // The obvious version — clamp the step toward `wishDir * maxSpeed` to a
      // fixed metres-per-second-squared — quietly does not work, because
      // friction is proportional to speed and the accelerating clamp is not.
      // They meet at accel/friction and the run stops there no matter what the
      // cap says, which is why raising the sprint number changed nothing: walk
      // and sprint both settled around seven. Budgeting the step against the
      // cap instead means friction can only ever take back a fixed fraction,
      // so `maxSpeed` is reached exactly, and the ratio sets the ramp rather
      // than the top speed.
      const current = vel.x * this.wishDir.x + vel.z * this.wishDir.z;
      const room = maxSpeed - current;
      if (room > 0) {
        const add = Math.min(ACCEL.ground * maxSpeed * dt, room);
        vel.x += this.wishDir.x * add;
        vel.z += this.wishDir.z * add;
      }
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

    this.speed2D = Math.hypot(vel.x, vel.z);
    this.airborneFor = this.controller.grounded ? 0 : this.airborneFor + dt;

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
      // Moving faster lengthens the stride as well as quickening the cadence,
      // so these scale with the speed table rather than sitting at fixed
      // metres — otherwise a quicker player just machine-guns footstep audio.
      const stride = this.crouched ? 1.9 : this.sprinting ? 2.75 : 2.35;
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

  /**
   * How far the head may travel sideways before it would be inside a wall,
   * as a signed fraction of a full lean.
   *
   * Peeking is only worth having if it stops at the corner rather than
   * pushing the camera through it — and since the camera is also the muzzle,
   * a lean through a wall would be a shot through a wall.
   */
  _allowedLean(direction) {
    if (direction === 0) return 0;
    const eyeY = THREE.MathUtils.lerp(this.eyeHeight, this.crouchEyeHeight, this.stanceBlend);
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    _leanDir.set(cos * direction, 0, -sin * direction);

    const reach = LEAN_OFFSET + LEAN_MARGIN;
    let limit = LEAN_OFFSET;
    // Three heights: a single ray at eye level will happily lean out over a
    // waist-high crate, or under a low balcony the shoulder would hit.
    for (const dy of LEAN_PROBE_HEIGHTS) {
      _leanFrom.copy(this.controller.position);
      _leanFrom.y += eyeY + dy;
      const hit = this.world.bvh.raycast(_leanFrom, _leanDir, reach);
      if (hit.hit) limit = Math.min(limit, Math.max(0, hit.t - LEAN_MARGIN));
    }
    return direction * (limit / LEAN_OFFSET);
  }

  /**
   * Ground speed as a fraction of a normal walk. Everything that reacts to how
   * fast the player is moving — bob, sway, weapon spread — reads this rather
   * than raw metres per second, so retuning the speed table does not silently
   * retune half the game with it.
   */
  get speedNorm() {
    return THREE.MathUtils.clamp(this.speed2D / SPEED.walk, 0, 1.6);
  }

  /**
   * How far into a sprint the player is, 0 at a walk and 1 at full pace.
   *
   * Continuous on purpose. The `sprinting` flag is a decision about intent and
   * it legitimately drops for single frames — one foot off a kerb clears
   * `grounded`, a shot clears `timeSinceFire`. Anything visual that reads the
   * flag directly inherits that stutter, so gait and camera read this instead
   * and only the simulation reads the flag.
   */
  get sprintNorm() {
    const span = SPEED.sprint / SPEED.walk - 1;
    return THREE.MathUtils.clamp((this.speedNorm - 1) / span, 0, 1);
  }

  /**
   * How hard the gait swings the head and the weapon.
   *
   * Not simply proportional to speed. A sprint is a little over half again as
   * fast as a walk, and letting the amplitude follow that puts four centimetres
   * of lateral travel and a degree of roll through the camera one and a half
   * times a second, which is where "the screen rocks about while running" comes
   * from. Real running has a longer stride, not a wildly bigger one, so
   * everything past walking pace is heavily compressed: faster still reads as
   * faster, mostly through the rate, without the view becoming a fairground
   * ride. Both the eye rig and the viewmodel read this so they cannot disagree.
   */
  get bobStrength() {
    const n = this.speedNorm;
    return n <= 1 ? n : 1 + (n - 1) * 0.3;
  }

  /** Render-rate eye rig: bob, sway, lean, kick, breathing. */
  updateView(dt, alpha, time) {
    const c = this.controller;
    this._renderPosition.lerpVectors(this._prevPosition, c.position, alpha);

    const standEye = THREE.MathUtils.lerp(this.eyeHeight, this.crouchEyeHeight, this.stanceBlend);
    this.heightSpring.target = standEye;
    this.heightSpring.update(dt);

    // walk cycle drives a figure-eight, scaled by actual speed
    const speedNorm = this.speedNorm;
    const grounded = c.grounded;

    // Gait blends between stances and paces rather than switching between
    // them. Stepping the rate discretely puts a kink in the bob phase every
    // time the sprint flag or the stance flips, which reads as the head
    // jerking mid-stride.
    const bobRate = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(8.4, 6.2, this.stanceBlend), 10.4, this.sprintNorm
    );
    if (this.airborneFor < COYOTE_TIME) {
      this.bobPhase = (this.bobPhase + dt * bobRate * Math.min(speedNorm, 1.4)) % TAU;
    }

    const settled = 1 - THREE.MathUtils.clamp(this.airborneFor / COYOTE_TIME, 0, 1);
    const bobScale = this.bobStrength * settled * (1 - this.adsBlend * 0.78) * Settings.data.cameraShake;
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

    // Ease into the peek. Snapping out from behind cover would be free
    // information; the travel time is what makes it a decision.
    this.leanBlend = damp(this.leanBlend, this.lean, 11, dt);

    // Where the eye belongs this frame if it sat rigidly on the body.
    const targetEyeY = this._renderPosition.y
      + this.heightSpring.value + this.landDip.value * 0.055
      - Math.abs(this.leanBlend) * LEAN_DROP;

    // Chase it rather than snap to it, but only on the ground: in the air the
    // whole point is that the body's vertical motion is the motion, and lagging
    // behind a jump or a fall reads as floating.
    if (this._eyeY === null || !grounded) {
      this._eyeY = targetEyeY;
    } else {
      this._eyeY += (targetEyeY - this._eyeY) * (1 - Math.exp(-dt * EYE_FOLLOW));
      this._eyeY = THREE.MathUtils.clamp(
        this._eyeY, targetEyeY - EYE_MAX_LAG, targetEyeY + EYE_MAX_LAG
      );
    }

    this.eye.copy(this._renderPosition);
    this.eye.y = this._eyeY;

    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const bob = this.bobAmount.value;
    const lateral = bob.x + this.leanBlend * LEAN_OFFSET;
    this.eye.x += lateral * cos;
    this.eye.z += -lateral * sin;
    this.eye.y += bob.y;

    this.viewPitch = this.pitch + this.pitchKick.value + Math.sin(this.breath * 1.7) * breathAmp;
    this.viewYaw = this.yaw + this.yawKick.value + Math.sin(this.breath * 0.9 + 1.2) * breathAmp * 1.4;
    this.viewRoll = this.leanSpring.value + this.rollKick.value
      - this.leanBlend * LEAN_ROLL
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
const _leanDir = new THREE.Vector3();
const _leanFrom = new THREE.Vector3();
export { STANCE, SPEED };
