import * as THREE from 'three';
import { CharacterRig } from './CharacterRig.js';
import { buildSoldier, BONE_COUNT } from './CharacterGeometry.js';
import { Ragdoll, RD } from '../physics/Ragdoll.js';
import { RayHit } from '../physics/BVH.js';

/**
 * One AI soldier: rig, hitboxes, health and the mesh that draws it.
 *
 * The geometry is shared per team and the pose lives entirely in the bone
 * uniform, so adding a combatant costs one draw call and no extra memory.
 */

const HITBOX_DEFS = [
  { name: 'head', zone: 'head', a: RD.NECK, b: RD.HEAD, radius: 0.115, extend: 0.05 },
  { name: 'chest', zone: 'body', a: RD.CHEST, b: RD.NECK, radius: 0.20 },
  { name: 'abdomen', zone: 'body', a: RD.PELVIS, b: RD.CHEST, radius: 0.185 },
  { name: 'upperarm_l', zone: 'limb', a: RD.SHOULDER_L, b: RD.ELBOW_L, radius: 0.075 },
  { name: 'forearm_l', zone: 'limb', a: RD.ELBOW_L, b: RD.HAND_L, radius: 0.062 },
  { name: 'upperarm_r', zone: 'limb', a: RD.SHOULDER_R, b: RD.ELBOW_R, radius: 0.075 },
  { name: 'forearm_r', zone: 'limb', a: RD.ELBOW_R, b: RD.HAND_R, radius: 0.062 },
  { name: 'thigh_l', zone: 'limb', a: RD.HIP_L, b: RD.KNEE_L, radius: 0.098 },
  { name: 'shin_l', zone: 'limb', a: RD.KNEE_L, b: RD.FOOT_L, radius: 0.078 },
  { name: 'thigh_r', zone: 'limb', a: RD.HIP_R, b: RD.KNEE_R, radius: 0.098 },
  { name: 'shin_r', zone: 'limb', a: RD.KNEE_R, b: RD.FOOT_R, radius: 0.078 }
];

const _geometryCache = new Map();

function soldierGeometry(team, variant, rng) {
  const key = `${team}:${variant}`;
  let geo = _geometryCache.get(key);
  if (!geo) {
    geo = buildSoldier(team, variant, rng);
    _geometryCache.set(key, geo);
  }
  return geo;
}

export class Character {
  constructor({ id, team, variant, factory, bvh, rng, prevViewProjection, shadowSystem }) {
    this.id = id;
    this.team = team;
    this.alive = true;
    this.health = 100;
    this.maxHealth = 100;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';
    this.aiming = true;
    this.boundsRadius = 1.15;
    this.hitFlash = 0;
    this.deathTime = -1;
    this.lastDamageFrom = null;

    this.rig = new CharacterRig();
    this.ragdoll = new Ragdoll(bvh);
    this.bvh = bvh;

    this.hitboxes = HITBOX_DEFS.map((d) => ({
      name: d.name, zone: d.zone, radius: d.radius,
      a: new THREE.Vector3(), b: new THREE.Vector3(), def: d
    }));

    const geometry = soldierGeometry(team, variant ?? 0, rng);
    this.material = factory.createCharacter(prevViewProjection);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;

    this._prevBones = [];
    for (let i = 0; i < BONE_COUNT; i++) this._prevBones.push(new THREE.Matrix4());
    this.material.uniforms.uBones.value = this.rig.matrices;
    this.material.uniforms.uPrevBones.value = this._prevBones;
    if (shadowSystem) {
      this.shadowMaterial = shadowSystem.createSkinnedMaterial(this.material.uniforms.uBones);
      this.mesh.userData.shadowMaterial = this.shadowMaterial;
    }
  }

  spawn(position, yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.deathTime = -1;
    this.hitFlash = 0;
    this.ragdoll.deactivate();
    this.mesh.visible = true;
    this.rig.root.copy(position);
    this.rig.yaw = yaw;
    this._poseHistory = false;
  }

  applyDamage(amount, info) {
    if (!this.alive) return false;
    this.health -= amount;
    this.hitFlash = Math.min(1, this.hitFlash + 0.55);
    this.lastDamageFrom = info.source ?? null;
    this.onDamaged?.(amount, info);

    // A body shot staggers the torso away from the impact.
    if (info.direction) {
      this.rig.addHitReaction(info.direction.x, info.direction.z, Math.min(0.35, amount * 0.006));
    }
    if (this.health <= 0) {
      this.kill(info);
      return true;
    }
    return false;
  }

  kill(info) {
    if (!this.alive) return;
    this.alive = false;
    this.deathTime = 0;
    const impulse = _impulse.set(0, 0, 0);
    if (info?.direction) {
      impulse.copy(info.direction).multiplyScalar(info.impulse ?? 8);
      impulse.y += 1.4;
    }
    this.ragdoll.activate(
      (index, out) => this.rig.getJoint(index, out),
      this.velocity,
      info?.point ?? this.position,
      impulse
    );
    this.onKilled?.(info);
  }

  /**
   * @param dt seconds
   * @param control  { moveX, moveZ, yaw, pitch, stance, aiming } from the AI
   */
  update(dt, control) {
    // previous pose captured before the new one overwrites it
    for (let i = 0; i < BONE_COUNT; i++) this._prevBones[i].copy(this.rig.matrices[i]);

    this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);
    this.material.uniforms.uHitFlash.value = this.hitFlash * this.hitFlash;

    if (this.alive) {
      this.yaw = control.yaw;
      this.pitch = control.pitch;
      this.stance = control.stance;
      this.aiming = control.aiming;
      this.rig.root.copy(this.position);

      // Feet sample the ground independently so the stance follows slopes and
      // kerbs instead of floating over them.
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      this.rig.groundL = this._groundAt(this.position.x - cy * 0.11, this.position.z - sy * 0.11);
      this.rig.groundR = this._groundAt(this.position.x + cy * 0.11, this.position.z + sy * 0.11);

      this.rig.update(dt, {
        velocity: this.velocity,
        yaw: this.yaw,
        pitch: this.pitch,
        stance: this.stance,
        aiming: this.aiming
      });
    } else {
      this.deathTime += dt;
      this.ragdoll.step(dt);
      this.rig.setFromRagdoll(this.ragdoll);
      this.position.copy(this.rig.joints[RD.PELVIS]);
      // Bodies stay as cover and scenery; they only fade out very late.
      if (this.deathTime > 45) this.mesh.visible = false;
    }

    // On the first pose after a spawn there is no history, and an identity
    // previous pose would smear the whole body across the motion buffer.
    if (this._poseHistory === false) {
      for (let i = 0; i < BONE_COUNT; i++) this._prevBones[i].copy(this.rig.matrices[i]);
      this._poseHistory = true;
    }

    this._updateHitboxes();
  }

  _groundAt(x, z) {
    _rayOrigin.set(x, this.position.y + 1.0, z);
    const hit = this.bvh.raycast(_rayOrigin, _down, 2.4, _groundHit);
    return hit.hit ? hit.point.y : this.position.y;
  }

  _updateHitboxes() {
    const J = this.rig.joints;
    for (const hb of this.hitboxes) {
      hb.a.copy(J[hb.def.a]);
      hb.b.copy(J[hb.def.b]);
      if (hb.def.extend) {
        _dir.subVectors(hb.b, hb.a);
        if (_dir.lengthSq() > 1e-8) hb.b.addScaledVector(_dir.normalize(), hb.def.extend);
      }
    }
    // bounding sphere follows the pelvis so the broad-phase stays tight
    this.boundsRadius = this.alive ? 1.15 : 1.0;
  }

  /** Eye position used by AI line-of-sight and by the audio listener. */
  getEyePosition(out) {
    return out.copy(this.rig.joints[RD.HEAD]);
  }

  dispose() {
    this.material.dispose();
    this.shadowMaterial?.dispose();
  }
}

export function disposeSharedCharacterGeometry() {
  for (const geo of _geometryCache.values()) geo.dispose();
  _geometryCache.clear();
}

const _impulse = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _groundHit = new RayHit();
