import * as THREE from 'three';
import { closestPointOnTriangleSoup } from './BVH.js';

/**
 * XPBD ragdoll. Particles are limb endpoints; constraints are distance (bone
 * length), cone (joint swing limit), twist damping via bone-frame alignment,
 * and iterative collision against the static BVH.
 *
 * Momentum from the killing shot is injected into the nearest particles so the
 * body reacts in the right direction, then everything settles and sleeps.
 */

const GRAVITY = -17.5;
const ITERATIONS = 6;
const PARTICLE_RADIUS = 0.075;

// Skeleton definition — indices into the particle array.
export const RD = {
  HEAD: 0, NECK: 1, CHEST: 2, PELVIS: 3,
  SHOULDER_L: 4, ELBOW_L: 5, HAND_L: 6,
  SHOULDER_R: 7, ELBOW_R: 8, HAND_R: 9,
  HIP_L: 10, KNEE_L: 11, FOOT_L: 12,
  HIP_R: 13, KNEE_R: 14, FOOT_R: 15
};
const PARTICLE_COUNT = 16;

const BONES = [
  [RD.HEAD, RD.NECK, 0.16], [RD.NECK, RD.CHEST, 0.20], [RD.CHEST, RD.PELVIS, 0.36],
  [RD.CHEST, RD.SHOULDER_L, 0.20], [RD.SHOULDER_L, RD.ELBOW_L, 0.28], [RD.ELBOW_L, RD.HAND_L, 0.26],
  [RD.CHEST, RD.SHOULDER_R, 0.20], [RD.SHOULDER_R, RD.ELBOW_R, 0.28], [RD.ELBOW_R, RD.HAND_R, 0.26],
  [RD.PELVIS, RD.HIP_L, 0.12], [RD.HIP_L, RD.KNEE_L, 0.42], [RD.KNEE_L, RD.FOOT_L, 0.42],
  [RD.PELVIS, RD.HIP_R, 0.12], [RD.HIP_R, RD.KNEE_R, 0.42], [RD.KNEE_R, RD.FOOT_R, 0.42]
];

// Shape-preserving cross links keep the torso from folding flat.
const STRUTS = [
  [RD.SHOULDER_L, RD.SHOULDER_R, 0.40, 0.85],
  [RD.HIP_L, RD.HIP_R, 0.24, 0.9],
  [RD.SHOULDER_L, RD.PELVIS, 0.52, 0.5],
  [RD.SHOULDER_R, RD.PELVIS, 0.52, 0.5],
  [RD.NECK, RD.HIP_L, 0.62, 0.25],
  [RD.NECK, RD.HIP_R, 0.62, 0.25],
  [RD.HEAD, RD.CHEST, 0.34, 0.6]
];

// Cone limits: [joint, parent, grandparent, maxAngleRad]
const CONES = [
  [RD.ELBOW_L, RD.SHOULDER_L, RD.CHEST, 2.4],
  [RD.ELBOW_R, RD.SHOULDER_R, RD.CHEST, 2.4],
  [RD.HAND_L, RD.ELBOW_L, RD.SHOULDER_L, 2.2],
  [RD.HAND_R, RD.ELBOW_R, RD.SHOULDER_R, 2.2],
  [RD.KNEE_L, RD.HIP_L, RD.PELVIS, 2.0],
  [RD.KNEE_R, RD.HIP_R, RD.PELVIS, 2.0],
  [RD.FOOT_L, RD.KNEE_L, RD.HIP_L, 1.7],
  [RD.FOOT_R, RD.KNEE_R, RD.HIP_R, 1.7],
  [RD.HEAD, RD.NECK, RD.CHEST, 1.0]
];

export class Ragdoll {
  constructor(bvh) {
    this.bvh = bvh;
    this.pos = new Float32Array(PARTICLE_COUNT * 3);
    this.prev = new Float32Array(PARTICLE_COUNT * 3);
    this.vel = new Float32Array(PARTICLE_COUNT * 3);
    this.invMass = new Float32Array(PARTICLE_COUNT).fill(1);
    this.invMass[RD.PELVIS] = 0.55;
    this.invMass[RD.CHEST] = 0.5;
    this.invMass[RD.HEAD] = 1.4;
    this.active = false;
    this.sleeping = false;
    this.sleepTimer = 0;
    this.age = 0;
    this.maxAge = 16;
    this._tris = [];
    this.bounds = new THREE.Box3();
    this.groundedTimer = 0;
  }

  /**
   * Start from a posed skeleton. `getJoint(index, outVec3)` supplies world
   * positions so the ragdoll inherits the exact animated pose.
   */
  activate(getJoint, velocity, hitPoint, hitImpulse) {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      getJoint(i, _v);
      this.pos[i * 3] = _v.x; this.pos[i * 3 + 1] = _v.y; this.pos[i * 3 + 2] = _v.z;
      this.vel[i * 3] = velocity.x;
      this.vel[i * 3 + 1] = velocity.y;
      this.vel[i * 3 + 2] = velocity.z;
    }
    this.prev.set(this.pos);

    if (hitPoint && hitImpulse) {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const dx = this.pos[i * 3] - hitPoint.x;
        const dy = this.pos[i * 3 + 1] - hitPoint.y;
        const dz = this.pos[i * 3 + 2] - hitPoint.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const w = 1 / (1 + d2 * 9);
        this.vel[i * 3] += hitImpulse.x * w;
        this.vel[i * 3 + 1] += hitImpulse.y * w;
        this.vel[i * 3 + 2] += hitImpulse.z * w;
      }
    }
    this.active = true;
    this.sleeping = false;
    this.sleepTimer = 0;
    this.groundedTimer = 0;
    this.age = 0;
  }

  deactivate() { this.active = false; }

  step(dt) {
    if (!this.active || this.sleeping) return;
    this.age += dt;
    if (this.age > this.maxAge) { this.sleeping = true; return; }

    const p = this.pos, pr = this.prev, v = this.vel;
    const damp = Math.max(0, 1 - 0.9 * dt);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      pr[i3] = p[i3]; pr[i3 + 1] = p[i3 + 1]; pr[i3 + 2] = p[i3 + 2];
      v[i3 + 1] += GRAVITY * dt;
      v[i3] *= damp; v[i3 + 1] *= damp; v[i3 + 2] *= damp;
      p[i3] += v[i3] * dt;
      p[i3 + 1] += v[i3 + 1] * dt;
      p[i3 + 2] += v[i3 + 2] * dt;
    }

    for (let it = 0; it < ITERATIONS; it++) {
      this._solveDistance();
      this._solveCones();
      this._solveCollision();
    }

    let energy = 0;
    const invDt = 1 / dt;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      v[i3] = (p[i3] - pr[i3]) * invDt;
      v[i3 + 1] = (p[i3 + 1] - pr[i3 + 1]) * invDt;
      v[i3 + 2] = (p[i3 + 2] - pr[i3 + 2]) * invDt;
      energy += v[i3] * v[i3] + v[i3 + 1] * v[i3 + 1] + v[i3 + 2] * v[i3 + 2];
    }

    if (energy / PARTICLE_COUNT < 0.09) {
      this.sleepTimer += dt;
      if (this.sleepTimer > 0.7) this.sleeping = true;
    } else this.sleepTimer = 0;
  }

  _solveDistance() {
    const p = this.pos, im = this.invMass;
    for (let k = 0; k < BONES.length; k++) {
      const [a, b, rest] = BONES[k];
      solveDist(p, im, a, b, rest, 1.0);
    }
    for (let k = 0; k < STRUTS.length; k++) {
      const [a, b, rest, stiff] = STRUTS[k];
      solveDist(p, im, a, b, rest, stiff);
    }
  }

  _solveCones() {
    const p = this.pos, im = this.invMass;
    for (let k = 0; k < CONES.length; k++) {
      const [child, joint, parent, maxAngle] = CONES[k];
      _a.set(p[joint * 3] - p[parent * 3], p[joint * 3 + 1] - p[parent * 3 + 1], p[joint * 3 + 2] - p[parent * 3 + 2]);
      _b.set(p[child * 3] - p[joint * 3], p[child * 3 + 1] - p[joint * 3 + 1], p[child * 3 + 2] - p[joint * 3 + 2]);
      const la = _a.length(), lb = _b.length();
      if (la < 1e-5 || lb < 1e-5) continue;
      _a.multiplyScalar(1 / la);
      _b.multiplyScalar(1 / lb);
      const cosA = THREE.MathUtils.clamp(_a.dot(_b), -1, 1);
      const angle = Math.acos(cosA);
      if (angle <= maxAngle) continue;
      // rotate the child limb back inside the cone
      _axis.crossVectors(_a, _b);
      if (_axis.lengthSq() < 1e-10) continue;
      _axis.normalize();
      _q.setFromAxisAngle(_axis, -(angle - maxAngle) * 0.6);
      _b.applyQuaternion(_q).multiplyScalar(lb);
      const tx = p[joint * 3] + _b.x, ty = p[joint * 3 + 1] + _b.y, tz = p[joint * 3 + 2] + _b.z;
      const w = im[child] / (im[child] + im[joint] + 1e-9);
      p[child * 3] += (tx - p[child * 3]) * w;
      p[child * 3 + 1] += (ty - p[child * 3 + 1]) * w;
      p[child * 3 + 2] += (tz - p[child * 3 + 2]) * w;
    }
  }

  _solveCollision() {
    const p = this.pos;
    const soup = this.bvh.soup;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const x = p[i3], y = p[i3 + 1], z = p[i3 + 2];
      let count = 0;
      const tris = this._tris;
      this.bvh.overlapBox(
        x - PARTICLE_RADIUS, y - PARTICLE_RADIUS, z - PARTICLE_RADIUS,
        x + PARTICLE_RADIUS, y + PARTICLE_RADIUS, z + PARTICLE_RADIUS,
        (t) => { if (count < 24) tris[count++] = t; }
      );
      for (let c = 0; c < count; c++) {
        closestPointOnTriangleSoup(soup, tris[c], p[i3], p[i3 + 1], p[i3 + 2], _cp);
        _d.set(p[i3] - _cp.x, p[i3 + 1] - _cp.y, p[i3 + 2] - _cp.z);
        const dist = _d.length();
        if (dist >= PARTICLE_RADIUS) continue;
        if (dist < 1e-6) this.bvh.triangleNormal(tris[c], _d);
        else _d.multiplyScalar(1 / dist);
        const pen = PARTICLE_RADIUS - dist;
        p[i3] += _d.x * pen;
        p[i3 + 1] += _d.y * pen;
        p[i3 + 2] += _d.z * pen;
        // ground friction so limbs do not skate
        if (_d.y > 0.6) {
          const fr = 0.35;
          p[i3] += (this.prev[i3] - p[i3]) * fr;
          p[i3 + 2] += (this.prev[i3 + 2] - p[i3 + 2]) * fr;
        }
      }
    }
  }

  getParticle(i, out) {
    out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    return out;
  }

  computeBounds() {
    this.bounds.makeEmpty();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.bounds.expandByPoint(_v);
    }
    return this.bounds;
  }
}

function solveDist(p, im, a, b, rest, stiff) {
  const a3 = a * 3, b3 = b * 3;
  const dx = p[b3] - p[a3];
  const dy = p[b3 + 1] - p[a3 + 1];
  const dz = p[b3 + 2] - p[a3 + 2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return;
  const wSum = im[a] + im[b];
  if (wSum < 1e-9) return;
  const corr = ((d - rest) / d) * stiff;
  const ca = im[a] / wSum * corr;
  const cb = im[b] / wSum * corr;
  p[a3] += dx * ca; p[a3 + 1] += dy * ca; p[a3 + 2] += dz * ca;
  p[b3] -= dx * cb; p[b3 + 1] -= dy * cb; p[b3 + 2] -= dz * cb;
}

export const RAGDOLL_PARTICLES = PARTICLE_COUNT;

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _cp = new THREE.Vector3();
const _d = new THREE.Vector3();
