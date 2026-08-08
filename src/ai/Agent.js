import * as THREE from 'three';
import { RayHit } from '../physics/BVH.js';
import { CharacterController } from '../physics/CharacterController.js';
import { damp } from '../core/Spring.js';

/**
 * A single AI combatant's brain and body.
 *
 * Behaviour is a small state machine driven by a threat model rather than by
 * omniscience: the agent only knows what it has seen or heard, its knowledge
 * decays, and it aims with human error that shrinks the longer it tracks a
 * target. That is what makes the fight feel like a fight instead of a lottery.
 */

export const AI_STATE = {
  IDLE: 'idle',
  PATROL: 'patrol',
  ADVANCE: 'advance',
  ENGAGE: 'engage',
  SEEK_COVER: 'cover',
  SUPPRESS: 'suppress',
  RELOAD: 'reload',
  INVESTIGATE: 'investigate',
  FLANK: 'flank',
  DEAD: 'dead'
};

const SKILL = {
  reactionTime: [0.34, 0.16],      // [worst, best] seconds
  aimSpeed: [5.0, 11.0],           // rad/s of turret slew
  aimError: [0.055, 0.014],        // radians of steady-state jitter
  burstMin: [2, 3],
  burstMax: [5, 8],
  interBurst: [0.55, 0.26],
  accuracyBias: [0.7, 1.0]
};

function lerpSkill(range, s) { return range[0] + (range[1] - range[0]) * s; }

const FOV_COS = Math.cos(1.15);        // ~132° total
const PERIPHERAL_COS = Math.cos(1.65);
const SIGHT_RANGE = 95;
const HEARING_RANGE = 60;

export class Agent {
  constructor({ character, nav, bvh, rng, skill = 0.55, squad = 0 }) {
    this.character = character;
    this.nav = nav;
    this.bvh = bvh;
    this.rng = rng;
    this.skill = skill;
    this.squad = squad;

    this.state = AI_STATE.IDLE;
    this.stateTime = 0;
    this.controller = new CharacterController(bvh, { radius: 0.34, height: 1.75 });
    this.velocity = new THREE.Vector3();
    this.desiredYaw = 0;
    this.aimYaw = 0;
    this.shotsFired = 0;
    this.aimPitch = 0;
    this.stance = 'stand';
    this.aiming = false;

    // ------------------------------------------------------- threat model
    this.target = null;
    this.targetVisible = false;
    this.lastSeenPos = new THREE.Vector3();
    this.lastSeenVel = new THREE.Vector3();
    this.lastSeenTime = -999;
    this.awareness = 0;             // 0..1 build-up before the agent reacts
    this.reactionTimer = 0;
    this.trackTime = 0;
    this.suspicionPoint = new THREE.Vector3();
    this.hasSuspicion = false;

    // ------------------------------------------------------------ pathing
    this.path = [];
    this.pathIndex = 0;
    this.pathTarget = new THREE.Vector3();
    this.repathTimer = 0;
    this.stuckTimer = 0;
    this._lastPos = new THREE.Vector3();

    // ------------------------------------------------------------ weapon
    this.ammo = 30;
    this.magSize = 30;
    this.reserve = 210;
    this.fireTimer = 0;
    this.burstLeft = 0;
    this.burstCooldown = 0;
    this.reloadTimer = 0;
    this.aimOffset = new THREE.Vector3();
    this.aimNoisePhase = rng.next() * 100;

    this.coverPoint = new THREE.Vector3();
    this.hasCover = false;
    this.peeking = false;
    this.peekTimer = 0;
    this.strafeDir = rng.next() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;

    // Being shot at, hit, or nearly blown up leaves a mark that decays: a
    // stressed agent tracks worse and holds the trigger longer, which is what
    // return fire from a human actually looks like.
    this.stress = 0;
    this._grenadeThreat = new THREE.Vector3();
    this._fleeingGrenade = false;

    this.onFire = null;             // (origin, direction, agent) => void
    this.onReload = null;
    this.onVocal = null;            // callouts

    this._hit = new RayHit();
  }

  spawn(position, yaw) {
    this.controller.position.copy(position);
    this.controller.velocity.set(0, 0, 0);
    this.character.spawn(position, yaw);
    this.aimYaw = yaw;
    this.desiredYaw = yaw;
    this.aimPitch = 0;
    this.state = AI_STATE.PATROL;
    this.stateTime = 0;
    this.target = null;
    this.awareness = 0;
    this.ammo = this.magSize;
    this.reserve = 210;
    this.path.length = 0;
    this.hasCover = false;
    this.hasSuspicion = false;
  }

  get position() { return this.controller.position; }
  get alive() { return this.character.alive; }

  // ------------------------------------------------------------------ senses

  /** True when this agent can currently see `point`. */
  canSee(point, maxRange = SIGHT_RANGE) {
    _eye.copy(this.controller.position);
    _eye.y += this.stance === 'crouch' ? 1.15 : 1.62;
    _dir.subVectors(point, _eye);
    const dist = _dir.length();
    if (dist > maxRange) return false;
    _dir.multiplyScalar(1 / dist);

    facingOf(this.aimYaw, _facing);
    const dot = _dir.x * _facing.x + _dir.z * _facing.z;
    // Peripheral vision exists, it is just slow; the awareness ramp handles that.
    if (dot < PERIPHERAL_COS) return false;

    return !this.bvh.raycast(_eye, _dir, dist - 0.25, this._hit).hit;
  }

  /**
   * Update the threat model. `enemies` are the living characters on the other
   * team; the agent picks the most dangerous one it can actually see.
   */
  sense(dt, enemies) {
    let bestTarget = null;
    let bestScore = -Infinity;
    let sawTarget = false;

    for (const e of enemies) {
      if (!e.alive) continue;
      e.getEyePosition(_probe);
      // Aim at the chest, but check visibility against both chest and head so
      // an agent behind a low wall is not fully invisible.
      _chest.copy(e.position);
      _chest.y = _probe.y - 0.32;
      const visible = this.canSee(_chest) || this.canSee(_probe);
      if (!visible) continue;

      const dist = this.controller.position.distanceTo(e.position);
      facingOf(this.aimYaw, _facing);
      _dir.subVectors(e.position, this.controller.position).normalize();
      const centrality = _dir.x * _facing.x + _dir.z * _facing.z;
      const score = 100 - dist * 0.8 + centrality * 24 + (e === this.target ? 18 : 0);
      if (score > bestScore) { bestScore = score; bestTarget = e; }
    }

    if (bestTarget) {
      sawTarget = true;
      const switching = bestTarget !== this.target;
      this.target = bestTarget;
      if (switching) this.trackTime = 0;

      // Awareness builds faster for close, centred, moving targets.
      const dist = this.controller.position.distanceTo(bestTarget.position);
      const speed = bestTarget.velocity ? bestTarget.velocity.length() : 0;
      const rate = (1.6 + speed * 0.16) * (1 - Math.min(dist / 110, 0.7));
      this.awareness = Math.min(1, this.awareness + rate * dt);
      this.lastSeenPos.copy(bestTarget.position);
      if (bestTarget.velocity) this.lastSeenVel.copy(bestTarget.velocity);
      this.lastSeenTime = 0;
      this.trackTime += dt;
    } else {
      this.lastSeenTime += dt;
      this.trackTime = Math.max(0, this.trackTime - dt * 1.5);
      // Knowledge decays: after a few seconds the agent no longer trusts it.
      this.awareness = Math.max(0, this.awareness - dt * 0.35);
      if (this.lastSeenTime > 7) this.target = null;
    }
    this.targetVisible = sawTarget;
    return sawTarget;
  }

  /** Gunshots and impacts pull attention even through walls. */
  hearSound(position, loudness) {
    const dist = this.controller.position.distanceTo(position);
    if (dist > HEARING_RANGE * loudness) return;
    const strength = (1 - dist / (HEARING_RANGE * loudness)) * loudness;
    if (strength < 0.06) return;
    this.awareness = Math.min(1, this.awareness + strength * 0.55);
    if (!this.targetVisible) {
      this.suspicionPoint.copy(position);
      this.hasSuspicion = true;
      if (this.state === AI_STATE.PATROL || this.state === AI_STATE.IDLE) {
        this._setState(AI_STATE.INVESTIGATE);
      }
    }
  }

  /** Being shot at is the strongest sense there is. */
  onDamaged(info) {
    this.awareness = 1;
    this.stress = Math.min(1, this.stress + 0.65);
    // Taking a round interrupts the firing solution: the flinch knocks the
    // aim off and buys the shooter a beat before return fire resumes. An
    // agent that keeps tracking through hits reads as a turret.
    this.reactionTimer = Math.max(this.reactionTimer, 0.22 + (1 - this.skill) * 0.25);
    this.aimYaw += (this.rng.next() - 0.5) * 0.3;
    this.aimPitch += (this.rng.next() - 0.5) * 0.18;
    if (info?.point) {
      this.suspicionPoint.copy(info.point);
      this.hasSuspicion = true;
    }
    if (info?.source && info.source.alive) {
      this.target = info.source;
      this.lastSeenPos.copy(info.source.position);
      this.lastSeenTime = 0;
    }
    // Take cover if hurt badly and not already behind something.
    if (this.character.health < 45 && this.state !== AI_STATE.SEEK_COVER) {
      this._setState(AI_STATE.SEEK_COVER);
    }
  }

  /**
   * A round went past without connecting.
   *
   * Suppression used to need a hit, which made missing free — an agent stood
   * in the open and returned fire at leisure while rounds cracked past its
   * head. Now the near miss costs it accuracy through `stress`, buys the
   * shooter a beat of interrupted tracking, and points it at where the round
   * came from even if it never saw the muzzle. It is deliberately weaker than
   * `onDamaged`: being missed is frightening, being hit is worse.
   */
  onNearMiss({ intensity = 1, source = null } = {}) {
    this.stress = Math.min(1, this.stress + 0.30 * intensity);
    this.awareness = Math.min(1, this.awareness + 0.45 * intensity);
    // Flinch, but only for a close one, and never as hard as a hit — an agent
    // that ducks off its aim every time anyone fires in its direction cannot
    // hold a firefight at all.
    if (intensity > 0.45) {
      this.reactionTimer = Math.max(this.reactionTimer, 0.12 * intensity);
      this.aimYaw += (this.rng.next() - 0.5) * 0.12 * intensity;
    }
    if (source?.alive && !this.targetVisible) {
      this.suspicionPoint.copy(source.position);
      this.hasSuspicion = true;
      if (this.state === AI_STATE.PATROL || this.state === AI_STATE.IDLE) {
        this._setState(AI_STATE.INVESTIGATE);
      }
    }
    // Pinned in the open by fire that is finding its range: get behind
    // something. This is the behaviour the whole feature is for.
    if (this.stress > 0.72 && !this.hasCover
        && this.state !== AI_STATE.SEEK_COVER && this.state !== AI_STATE.DEAD) {
      this._setState(AI_STATE.SEEK_COVER);
    }
  }

  /**
   * A live grenade in range overrides every other plan.
   *
   * The flee is a straight steering override rather than a state: it has to
   * win instantly, survive for as long as the threat does, and hand back to
   * whatever the agent was doing without re-planning. Nothing else in the
   * machine works on a two-second fuse.
   */
  _checkGrenades(grenades) {
    this._fleeingGrenade = false;
    if (!grenades || !grenades.length) return;
    const p = this.controller.position;
    let nearest = null, nearestD2 = 11 * 11;
    for (const g of grenades) {
      const gp = g.body?.position;
      if (!gp) continue;
      const d2 = (gp.x - p.x) * (gp.x - p.x) + (gp.z - p.z) * (gp.z - p.z);
      if (d2 < nearestD2) { nearestD2 = d2; nearest = gp; }
    }
    if (!nearest) return;
    this._grenadeThreat.copy(nearest);
    this._fleeingGrenade = true;
    this.stress = Math.min(1, this.stress + 0.4);
  }

  // ------------------------------------------------------------------ think

  update(dt, ctx) {
    if (!this.character.alive) {
      if (this.state !== AI_STATE.DEAD) this._setState(AI_STATE.DEAD);
      this.character.update(dt, EMPTY_CONTROL);
      return;
    }

    this.stateTime += dt;
    this.stress = Math.max(0, this.stress - dt * 0.35);
    this._checkGrenades(ctx.grenades);
    this.sense(dt, ctx.enemies);
    this._think(dt, ctx);
    this._move(dt);
    this._aimAndShoot(dt, ctx);

    // Hand the solved intent to the character so the rig can animate it.
    this.character.position.copy(this.controller.position);
    this.character.velocity.copy(this.controller.velocity);
    this.character.update(dt, {
      yaw: this.aimYaw,
      pitch: this.aimPitch,
      stance: this.stance,
      aiming: this.aiming
    });
  }

  _setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
    this.path.length = 0;
    this.pathIndex = 0;
    this.repathTimer = 0;
  }

  _think(dt, ctx) {
    const engaged = this.target && this.awareness > 0.5;
    const reloadNeeded = this.ammo <= 0 && this.reloadTimer <= 0;

    if (reloadNeeded && this.state !== AI_STATE.RELOAD) {
      this._setState(AI_STATE.RELOAD);
      this.reloadTimer = 2.35;
      this.onReload?.(this);
    }

    switch (this.state) {
      case AI_STATE.IDLE:
      case AI_STATE.PATROL: {
        this.stance = 'stand';
        this.aiming = false;
        if (engaged) { this._engageOrCover(); break; }
        if (!this.path.length || this.pathIndex >= this.path.length) {
          const point = this.nav.randomPoint(this.rng, _dest, this.controller.position, 14);
          if (point) this._repath(point);
        }
        break;
      }

      case AI_STATE.INVESTIGATE: {
        this.aiming = true;
        this.stance = 'stand';
        if (engaged) { this._engageOrCover(); break; }
        if (this.hasSuspicion && (!this.path.length || this.pathIndex >= this.path.length)) {
          if (this.controller.position.distanceTo(this.suspicionPoint) < 3.5 || this.stateTime > 12) {
            this.hasSuspicion = false;
            this._setState(AI_STATE.PATROL);
          } else this._repath(this.suspicionPoint);
        } else if (!this.hasSuspicion) this._setState(AI_STATE.PATROL);
        break;
      }

      case AI_STATE.ENGAGE: {
        this.aiming = true;
        if (!this.target || !this.target.alive) { this._setState(AI_STATE.PATROL); break; }

        const dist = this.controller.position.distanceTo(this.target.position);
        // Reposition when the target is lost for a while, or when caught in the open.
        if (!this.targetVisible && this.lastSeenTime > 1.6) {
          this._setState(AI_STATE.ADVANCE);
          break;
        }
        // Self-preservation scales with skill. A recruit trades in the open
        // until it is nearly dead; an elite breaks contact while it still has
        // the health to survive the move. This is most of what separates the
        // difficulties in play — before, every setting fought identically and
        // only shot straighter, so "harder" read as "luckier".
        const breakOff = 26 + this.skill * 34;
        if (this.character.health < breakOff && this.rng.next() < dt * (0.5 + this.skill * 1.1)) {
          this._setState(AI_STATE.SEEK_COVER);
          break;
        }
        // Being shot at without being hit is also a reason to move. Standing
        // in the open through incoming fire is the single most obviously
        // stupid thing an agent can do, and only skilled ones avoided it.
        if (this.stress > 0.55 && !this.hasCover
            && this.rng.next() < dt * this.stress * (0.6 + this.skill * 1.4)) {
          this._setState(AI_STATE.SEEK_COVER);
          break;
        }
        // Close in if too far to be effective, back off if uncomfortably close.
        if (dist > 42 && this.stateTime > 1.2) { this._setState(AI_STATE.ADVANCE); break; }

        // Skilled agents fight small: they crouch behind whatever they have,
        // and from further out. A recruit stands up in cover and wastes it.
        const crouchRange = 6 + this.skill * 14;
        this.stance = this.hasCover && dist > crouchRange ? 'crouch' : 'stand';
        this._combatStrafe(dt);
        break;
      }

      case AI_STATE.ADVANCE: {
        this.aiming = true;
        this.stance = 'stand';
        if (this.targetVisible && this.target) {
          const dist = this.controller.position.distanceTo(this.target.position);
          if (dist < 38) { this._setState(AI_STATE.ENGAGE); break; }
        }
        if (!this.path.length || this.pathIndex >= this.path.length || this.repathTimer <= 0) {
          const goal = this.target && this.lastSeenTime < 6 ? this.lastSeenPos : this.suspicionPoint;
          if (goal) this._repath(goal);
          this.repathTimer = 1.4;
        }
        if (this.stateTime > 14) this._setState(AI_STATE.PATROL);
        break;
      }

      case AI_STATE.SEEK_COVER: {
        this.aiming = true;
        if (!this.hasCover) {
          const threat = this.target ? this.target.position : this.lastSeenPos;
          const found = this.nav.findCover(this.controller.position, threat, 16, this.rng, _dest);
          if (found) {
            this.coverPoint.copy(found);
            this.hasCover = true;
            this._repath(found);
          } else {
            this._setState(AI_STATE.ENGAGE);
            break;
          }
        }
        const atCover = this.controller.position.distanceTo(this.coverPoint) < 1.2;
        if (atCover) {
          this.stance = 'crouch';
          // Pop up periodically to fire, then duck again.
          this.peekTimer -= dt;
          if (this.peekTimer <= 0) {
            this.peeking = !this.peeking;
            this.peekTimer = this.peeking ? 0.9 + this.rng.next() * 1.1 : 0.7 + this.rng.next() * 1.3;
          }
          this.stance = this.peeking ? 'stand' : 'crouch';
          if (this.character.health > 65 && this.stateTime > 5) {
            this.hasCover = false;
            this._setState(AI_STATE.ENGAGE);
          }
        } else if (this.stateTime > 8) {
          this.hasCover = false;
          this._setState(AI_STATE.ENGAGE);
        }
        break;
      }

      case AI_STATE.FLANK: {
        this.aiming = true;
        this.stance = 'stand';
        if (!this.path.length || this.pathIndex >= this.path.length) {
          if (this.targetVisible) this._setState(AI_STATE.ENGAGE);
          else this._setState(AI_STATE.ADVANCE);
        }
        if (this.stateTime > 16) this._setState(AI_STATE.ADVANCE);
        break;
      }

      case AI_STATE.RELOAD: {
        this.aiming = false;
        this.reloadTimer -= dt;
        // Reloading in the open is a mistake; back into cover while doing it.
        if (this.target && this.targetVisible && !this.hasCover && this.stateTime < 0.3) {
          const threat = this.target.position;
          const found = this.nav.findCover(this.controller.position, threat, 12, this.rng, _dest);
          if (found) { this.coverPoint.copy(found); this.hasCover = true; this._repath(found); }
        }
        if (this.reloadTimer <= 0) {
          const take = Math.min(this.magSize, this.reserve);
          this.ammo = take;
          this.reserve -= take;
          this._setState(this.target ? AI_STATE.ENGAGE : AI_STATE.PATROL);
        }
        break;
      }

      default: break;
    }

    this.repathTimer -= dt;
    void ctx;
  }

  _engageOrCover() {
    this.triggerReaction();
    // A hurt agent goes for cover; a healthy one closes and fights.
    if (this.character.health < 55 && this.rng.next() < 0.6) {
      this._setState(AI_STATE.SEEK_COVER);
    } else if (this.rng.next() < 0.22) {
      this._setState(AI_STATE.FLANK);
      this._planFlank();
    } else {
      this._setState(AI_STATE.ENGAGE);
    }
  }

  _planFlank() {
    if (!this.target) return;
    // Pick a point off to one side of the target, roughly 90° around.
    _dir.subVectors(this.target.position, this.controller.position);
    _dir.y = 0;
    const dist = Math.max(6, _dir.length());
    _dir.normalize();
    const side = this.rng.next() < 0.5 ? 1 : -1;
    _dest.copy(this.target.position)
      .addScaledVector(_dir, -dist * 0.45)
      .add(_side.set(-_dir.z, 0, _dir.x).multiplyScalar(side * dist * 0.7));
    this._repath(_dest);
  }

  _repath(goal) {
    const p = this.nav.findPath(
      this.controller.position.x, this.controller.position.z,
      goal.x, goal.z, this.path
    );
    this.pathIndex = 0;
    this.pathTarget.copy(goal);
    if (!p) this.path.length = 0;
  }

  /** Lateral movement while shooting, so agents are not static targets. */
  _combatStrafe(dt) {
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 0.8 + this.rng.next() * 1.6;
      if (this.rng.next() < 0.55) this.strafeDir *= -1;
    }
    if (!this.target) return;
    _dir.subVectors(this.target.position, this.controller.position);
    _dir.y = 0;
    const dist = _dir.length();
    _dir.normalize();
    _side.set(-_dir.z, 0, _dir.x).multiplyScalar(this.strafeDir);
    // Hold a comfortable band: push in when far, ease out when very close.
    const push = dist > 24 ? 0.55 : dist < 8 ? -0.5 : 0;
    _dest.copy(this.controller.position)
      .addScaledVector(_side, 2.6)
      .addScaledVector(_dir, push * 3.0);
    if (this.nav.isWalkableAt(_dest.x, _dest.z)) {
      this._steerDirect(_dest);
    } else {
      this.strafeDir *= -1;
      this._desiredMove.set(0, 0, 0);
    }
  }

  _steerDirect(point) {
    this._desiredMove.subVectors(point, this.controller.position);
    this._desiredMove.y = 0;
    if (this._desiredMove.lengthSq() > 1e-6) this._desiredMove.normalize();
  }

  _move(dt) {
    const move = this._desiredMove;
    // Follow the path unless a direct steer was already issued this frame.
    if (this.path.length && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      const dx = wp.x - this.controller.position.x;
      const dz = wp.z - this.controller.position.z;
      const d2 = dx * dx + dz * dz;
      const arrive = this.pathIndex === this.path.length - 1 ? 0.5 : 0.9;
      if (d2 < arrive * arrive) {
        this.pathIndex++;
      } else {
        const inv = 1 / Math.sqrt(d2);
        move.set(dx * inv, 0, dz * inv);
      }
    }

    // Speed by state: patrol walks, advance jogs, contact sprints for cover.
    let speed = 1.9;
    if (this.state === AI_STATE.ADVANCE || this.state === AI_STATE.FLANK) speed = 4.4;
    else if (this.state === AI_STATE.SEEK_COVER) speed = 5.0;
    else if (this.state === AI_STATE.ENGAGE) speed = 2.6;
    else if (this.state === AI_STATE.INVESTIGATE) speed = 2.8;
    if (this.stance === 'crouch') speed *= 0.55;

    // A live grenade beats the plan: run straight away from it, upright, at a
    // dead sprint, whatever the state machine had in mind.
    if (this._fleeingGrenade) {
      const dx = this.controller.position.x - this._grenadeThreat.x;
      const dz = this.controller.position.z - this._grenadeThreat.z;
      const d = Math.hypot(dx, dz) || 1e-4;
      move.set(dx / d, 0, dz / d);
      this.stance = 'stand';
      speed = 5.6;
    }

    // Separation from squadmates keeps a fireteam from stacking into one body.
    if (this._separation.lengthSq() > 1e-6) {
      move.add(this._separation);
      if (move.lengthSq() > 1e-6) move.normalize();
      this._separation.set(0, 0, 0);
    }

    const c = this.controller;
    c.setHeight(this.stance === 'crouch' ? 1.20 : 1.78);
    const target = _vel.copy(move).multiplyScalar(speed);
    c.velocity.x = damp(c.velocity.x, target.x, 11, dt);
    c.velocity.z = damp(c.velocity.z, target.z, 11, dt);
    c.velocity.y -= 21 * dt;
    _disp.copy(c.velocity).multiplyScalar(dt);
    c.move(dt, _disp);
    if (c.grounded && c.velocity.y < 0) c.velocity.y = -1.2;

    // Unstick: if the agent has barely moved while trying to, force a repath.
    const moved = this._lastPos.distanceToSquared(c.position);
    this._lastPos.copy(c.position);
    if (move.lengthSq() > 0.1 && moved < 0.00035) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.55) {
        this.stuckTimer = 0;
        this.path.length = 0;
        this.strafeDir *= -1;
        const p = this.nav.randomPoint(this.rng, _dest, this.controller.position, 4);
        if (p) this._repath(p);
      }
    } else this.stuckTimer = 0;

    move.set(0, 0, 0);
  }

  addSeparation(x, z) { this._separation.x += x; this._separation.z += z; }

  // ---------------------------------------------------------- aim and fire

  _aimAndShoot(dt, ctx) {
    const s = this.skill;
    let wantYaw = this.aimYaw;
    let wantPitch = this.aimPitch;

    if (this.target && this.lastSeenTime < 4) {
      // Lead the target using the last observed velocity. Agents overestimate
      // lead slightly at low skill, which is exactly what humans do.
      const leadTime = this.controller.position.distanceTo(this.lastSeenPos) / 780;
      _aimPoint.copy(this.targetVisible ? this.target.position : this.lastSeenPos)
        .addScaledVector(this.lastSeenVel, leadTime * (1.4 - s * 0.5));
      _aimPoint.y += this.targetVisible ? 1.28 : 1.1;

      _eye.copy(this.controller.position);
      _eye.y += this.stance === 'crouch' ? 1.15 : 1.55;
      _dir.subVectors(_aimPoint, _eye);
      const dist = _dir.length();
      _dir.multiplyScalar(1 / dist);

      wantYaw = yawTo(_dir.x, _dir.z);
      wantPitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
    } else if (this.hasSuspicion) {
      _dir.subVectors(this.suspicionPoint, this.controller.position);
      wantYaw = yawTo(_dir.x, _dir.z);
      wantPitch *= 0.9;
    } else if (this.path.length && this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex];
      wantYaw = yawTo(wp.x - this.controller.position.x, wp.z - this.controller.position.z);
      wantPitch *= 0.9;
    }

    // Slew toward the desired direction at a finite rate, with jitter that
    // settles as the agent keeps the target tracked.
    const slew = lerpSkill(SKILL.aimSpeed, s) * (this.targetVisible ? 1 : 0.6);
    this.aimYaw = approachAngle(this.aimYaw, wantYaw, slew * dt);
    this.aimPitch = approachAngle(this.aimPitch, wantPitch, slew * dt);

    this.aimNoisePhase += dt;
    const settle = 1 / (1 + this.trackTime * 2.4);
    // Stress widens the cone: an agent that has just been hit or shot at does
    // not track like one calmly resting on a windowsill.
    const jitter = lerpSkill(SKILL.aimError, s) * (0.35 + settle) * (1 + this.stress * 1.5);
    this.aimYaw += Math.sin(this.aimNoisePhase * 2.7) * jitter * 0.5;
    this.aimPitch += Math.sin(this.aimNoisePhase * 3.9 + 1.3) * jitter * 0.35;

    // ------------------------------------------------------------- firing
    this.fireTimer -= dt;
    this.burstCooldown -= dt;
    if (this.state === AI_STATE.RELOAD || this.ammo <= 0) return;
    if (!this.target || !this.targetVisible) { this.burstLeft = 0; return; }
    if (this.awareness < 0.62) return;

    // Reaction delay before the first shot of an engagement.
    if (this.reactionTimer > 0) { this.reactionTimer -= dt; return; }

    // Do not fire while sprinting for cover, fleeing a grenade, or while a
    // teammate is in the way.
    if (this.state === AI_STATE.SEEK_COVER && !this.peeking) return;
    if (this._fleeingGrenade) return;
    if (this._friendlyInLine(ctx)) return;

    const aimErr = angleBetweenYaw(this.aimYaw, yawTo(
      this.target.position.x - this.controller.position.x,
      this.target.position.z - this.controller.position.z
    ));
    if (Math.abs(aimErr) > 0.12) return;    // still swinging onto the target

    if (this.burstLeft <= 0) {
      if (this.burstCooldown > 0) return;
      const min = Math.round(lerpSkill(SKILL.burstMin, s));
      const max = Math.round(lerpSkill(SKILL.burstMax, s));
      this.burstLeft = min + Math.floor(this.rng.next() * (max - min + 1));
    }

    if (this.fireTimer <= 0) {
      this._fire(ctx);
      this.fireTimer = 0.0857;              // 700 rpm
      this.burstLeft--;
      if (this.burstLeft <= 0) this.burstCooldown = lerpSkill(SKILL.interBurst, s) * (0.7 + this.rng.next() * 0.6);
    }
  }

  _fire(ctx) {
    this.ammo--;
    this.shotsFired++;
    this.character.rig.addRecoil(0.85);
    this.character.rig.getMuzzle(_muzzle, _fireDir);

    // Cone of fire: tighter with skill and with time on target, wider while
    // moving. The direction already includes the aim jitter above.
    const s = this.skill;
    const moving = this.controller.velocity.lengthSq() > 1.2 ? 1.6 : 1.0;
    const spread = (0.010 + 0.020 * (1 - s)) * moving / (1 + this.trackTime);
    _fireDir.x += (this.rng.next() * 2 - 1) * spread;
    _fireDir.y += (this.rng.next() * 2 - 1) * spread * 0.8;
    _fireDir.z += (this.rng.next() * 2 - 1) * spread;
    _fireDir.normalize();

    this.onFire?.(_muzzle, _fireDir, this);
    if (this.ammo <= 0) {
      this._setState(AI_STATE.RELOAD);
      this.reloadTimer = 2.35;
      this.onReload?.(this);
    }
    void ctx;
  }

  /** Do not shoot through friends. */
  _friendlyInLine(ctx) {
    if (!ctx.allies) return false;
    facingOf(this.aimYaw, _dir);
    const maxDist = this.controller.position.distanceTo(this.target.position);
    for (const a of ctx.allies) {
      if (a === this || !a.alive) continue;
      _to.subVectors(a.position, this.controller.position);
      const along = _to.x * _dir.x + _to.z * _dir.z;
      if (along < 0.5 || along > maxDist) continue;
      const perp2 = _to.x * _to.x + _to.z * _to.z - along * along;
      if (perp2 < 0.9) return true;
    }
    return false;
  }

  /** Called when this agent first acquires a target, to add reaction delay. */
  triggerReaction() {
    this.reactionTimer = lerpSkill(SKILL.reactionTime, this.skill) * (0.7 + this.rng.next() * 0.7);
  }

  _desiredMove = new THREE.Vector3();
  _separation = new THREE.Vector3();
}

/** Yaw convention matches the camera: forward = (-sin y, 0, -cos y). */
function facingOf(yaw, out) {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}
function yawTo(dx, dz) {
  return Math.atan2(-dx, -dz);
}

function approachAngle(current, target, maxDelta) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

function angleBetweenYaw(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const EMPTY_CONTROL = { yaw: 0, pitch: 0, stance: 'stand', aiming: false };
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _facing = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _dest = new THREE.Vector3();
const _side = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _fireDir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _disp = new THREE.Vector3();
