import * as THREE from 'three';
import { BONE, BONE_COUNT, BONE_LENGTH } from './CharacterGeometry.js';
import { RD } from '../physics/Ragdoll.js';
import { damp } from '../core/Spring.js';

/**
 * Procedural animation rig. There are no clips: every pose is solved each
 * frame from the character's velocity, stance and aim, then the limbs are
 * placed with two-bone IK so the feet land on the ground and both hands stay
 * welded to the carbine.
 *
 * The rig exposes joint positions in the same index order the ragdoll uses, so
 * death is a straight handoff: the solver takes over from the animated pose
 * with no popping.
 */

const JOINT_COUNT = 16;

// Which two joints define each bone's segment, and the extra joint used to
// resolve roll. Bone-local +Y points from `from` toward `to`.
const BONE_JOINTS = [
  [BONE.PELVIS, RD.PELVIS, RD.CHEST],
  [BONE.CHEST, RD.CHEST, RD.NECK],
  [BONE.HEAD, RD.NECK, RD.HEAD],
  [BONE.UPPERARM_L, RD.SHOULDER_L, RD.ELBOW_L],
  [BONE.FOREARM_L, RD.ELBOW_L, RD.HAND_L],
  [BONE.UPPERARM_R, RD.SHOULDER_R, RD.ELBOW_R],
  [BONE.FOREARM_R, RD.ELBOW_R, RD.HAND_R],
  [BONE.THIGH_L, RD.HIP_L, RD.KNEE_L],
  [BONE.SHIN_L, RD.KNEE_L, RD.FOOT_L],
  [BONE.THIGH_R, RD.HIP_R, RD.KNEE_R],
  [BONE.SHIN_R, RD.KNEE_R, RD.FOOT_R]
];

const SHOULDER_X = 0.185;
const HIP_X = 0.105;
const STANCE_HEIGHT = { stand: 0.94, crouch: 0.60, prone: 0.30 };

/** Two-bone IK: place `mid` so the chain root→mid→end has the given lengths. */
function solveIK(root, end, l1, l2, poleDir, out) {
  _d.subVectors(end, root);
  let dist = _d.length();
  const maxReach = (l1 + l2) * 0.999;
  if (dist > maxReach) { dist = maxReach; _d.setLength(maxReach); end = _tmpEnd.copy(root).add(_d); }
  if (dist < 1e-4) { dist = 1e-4; _d.set(0, -1e-4, 0); }
  _d.multiplyScalar(1 / dist);

  // Distance from root to the projection of the mid joint on the root→end line.
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const hSq = l1 * l1 - a * a;
  const h = hSq > 0 ? Math.sqrt(hSq) : 0;

  // Orthogonalise the pole against the chain so the bend plane is stable.
  _pole.copy(poleDir).addScaledVector(_d, -poleDir.dot(_d));
  if (_pole.lengthSq() < 1e-8) {
    _pole.set(_d.z, 0, -_d.x);
    if (_pole.lengthSq() < 1e-8) _pole.set(1, 0, 0);
  }
  _pole.normalize();

  out.copy(root).addScaledVector(_d, a).addScaledVector(_pole, h);
  return out;
}

export class CharacterRig {
  constructor() {
    this.joints = [];
    for (let i = 0; i < JOINT_COUNT; i++) this.joints.push(new THREE.Vector3());
    this.matrices = [];
    for (let i = 0; i < BONE_COUNT; i++) this.matrices.push(new THREE.Matrix4());

    this.root = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.stanceHeight = STANCE_HEIGHT.stand;

    // gait state
    this.cycle = 0;
    this.speed = 0;
    this.strideScale = 0;
    this.lean = 0;
    this.leanSide = 0;
    this.bobY = 0;
    this.torsoTwist = 0;
    this.aimBlend = 1;      // 1 = weapon up at the shoulder, 0 = lowered
    this.fireKick = 0;
    this.reloadPhase = -1;
    this.hitLean = new THREE.Vector3();
    this.footPlant = [0, 0];

    // Ground probe results, filled by the owner before update().
    this.groundL = 0;
    this.groundR = 0;

    this._weapon = new THREE.Matrix4();
    this._aimDir = new THREE.Vector3(0, 0, -1);
  }

  /**
   * @param dt          seconds
   * @param opts.velocity   world-space planar velocity
   * @param opts.yaw        facing yaw (radians, 0 = -Z)
   * @param opts.pitch      aim pitch
   * @param opts.stance     'stand' | 'crouch' | 'prone'
   * @param opts.aiming     weapon shouldered
   */
  update(dt, opts) {
    const vel = opts.velocity;
    const planar = Math.hypot(vel.x, vel.z);
    this.speed = damp(this.speed, planar, 12, dt);
    this.yaw = opts.yaw;
    this.pitch = damp(this.pitch, opts.pitch, 16, dt);

    const targetHeight = STANCE_HEIGHT[opts.stance] ?? STANCE_HEIGHT.stand;
    this.stanceHeight = damp(this.stanceHeight, targetHeight, 9, dt);
    this.aimBlend = damp(this.aimBlend, opts.aiming ? 1 : 0.35, 8, dt);

    // Stride frequency scales with the square root of speed the way real gait
    // does: doubling speed lengthens the stride more than it quickens it.
    const strideLen = 1.05 + Math.min(planar, 7) * 0.14;
    const freq = planar > 0.05 ? planar / strideLen : 0;
    this.cycle = (this.cycle + freq * dt) % 1;
    this.strideScale = damp(this.strideScale, Math.min(planar / 5.2, 1), 7, dt);

    // Body lean into acceleration, and a sideways lean when strafing.
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const fwdSpeed = vel.x * fx + vel.z * fz;
    const sideSpeed = vel.x * -fz + vel.z * fx;
    this.lean = damp(this.lean, THREE.MathUtils.clamp(fwdSpeed * 0.035, -0.12, 0.22), 6, dt);
    this.leanSide = damp(this.leanSide, THREE.MathUtils.clamp(-sideSpeed * 0.030, -0.16, 0.16), 6, dt);

    this.fireKick = Math.max(0, this.fireKick - dt * 7);
    this.hitLean.multiplyScalar(Math.max(0, 1 - dt * 5));

    this._solvePose(dt);
    this._buildMatrices();
  }

  addRecoil(amount = 1) { this.fireKick = Math.min(1, this.fireKick + amount); }
  addHitReaction(dirX, dirZ, amount) {
    this.hitLean.x += dirX * amount;
    this.hitLean.z += dirZ * amount;
  }

  _solvePose(dt) {
    const J = this.joints;
    const yaw = this.yaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    // Same basis the camera uses: yaw rotates the -Z forward axis about +Y.
    const fwd = _fwd.set(-sy, 0, -cy);
    const right = _right.set(cy, 0, -sy);
    const up = _up.set(0, 1, 0);

    const cycle = this.cycle * Math.PI * 2;
    const bounce = Math.sin(cycle * 2) * 0.022 * this.strideScale;
    const sway = Math.sin(cycle) * 0.020 * this.strideScale;
    this.bobY = damp(this.bobY, bounce, 20, dt);

    // ------------------------------------------------------------- torso
    const hipY = this.root.y + this.stanceHeight + this.bobY - this.fireKick * 0.012;
    _pelvis.copy(this.root)
      .addScaledVector(right, sway)
      .setY(hipY);
    J[RD.PELVIS].copy(_pelvis);

    // Chest sits above the pelvis, leaning with acceleration and counter-
    // rotating against the stride so the shoulders swing opposite the hips.
    const twistTarget = -Math.sin(cycle) * 0.20 * this.strideScale;
    this.torsoTwist = damp(this.torsoTwist, twistTarget, 12, dt);
    const spineLen = BONE_LENGTH[BONE.PELVIS];
    _chest.copy(_pelvis)
      .addScaledVector(up, spineLen * Math.cos(this.lean))
      .addScaledVector(fwd, spineLen * Math.sin(this.lean) + this.hitLean.z * 0.1)
      .addScaledVector(right, spineLen * Math.sin(this.leanSide) + this.hitLean.x * 0.1);
    J[RD.CHEST].copy(_chest);

    const neckLen = BONE_LENGTH[BONE.CHEST];
    _neck.copy(_chest)
      .addScaledVector(up, neckLen * 0.94)
      .addScaledVector(fwd, neckLen * (0.20 + this.lean * 0.5));
    J[RD.NECK].copy(_neck);

    // Head tracks the aim pitch but only partially, like a real shooter who
    // keeps their head more level than their weapon.
    const headLen = BONE_LENGTH[BONE.HEAD];
    const headPitch = this.pitch * 0.55;
    J[RD.HEAD].copy(_neck)
      .addScaledVector(up, headLen * Math.cos(headPitch))
      .addScaledVector(fwd, -headLen * Math.sin(headPitch) * 0.6 + headLen * 0.10);

    // Shoulders and hips as offsets from their spine joints, twisted.
    const shoulderTwist = this.torsoTwist;
    const hipTwist = -this.torsoTwist * 0.6;
    _offset(J[RD.SHOULDER_L], _chest, right, fwd, up, -SHOULDER_X, 0.15, shoulderTwist);
    _offset(J[RD.SHOULDER_R], _chest, right, fwd, up, SHOULDER_X, 0.15, shoulderTwist);
    _offset(J[RD.HIP_L], _pelvis, right, fwd, up, -HIP_X, 0.0, hipTwist);
    _offset(J[RD.HIP_R], _pelvis, right, fwd, up, HIP_X, 0.0, hipTwist);

    // ------------------------------------------------------------- legs
    const legLen = BONE_LENGTH[BONE.THIGH_L];
    const shinLen = BONE_LENGTH[BONE.SHIN_L];
    const strideDist = 0.46 * this.strideScale;
    const lift = 0.20 * this.strideScale;

    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? -1 : 1;
      const hip = s === 0 ? J[RD.HIP_L] : J[RD.HIP_R];
      const knee = s === 0 ? J[RD.KNEE_L] : J[RD.KNEE_R];
      const foot = s === 0 ? J[RD.FOOT_L] : J[RD.FOOT_R];
      const phase = cycle + (s === 0 ? 0 : Math.PI);

      // Stride: the foot travels forward through the air quickly and back
      // along the ground slowly, which is what reads as "planted".
      const swing = Math.sin(phase);
      const airborne = Math.max(0, Math.sin(phase + Math.PI * 0.5));
      const height = Math.pow(airborne, 1.6) * lift;
      this.footPlant[s] = 1 - airborne;

      const groundY = s === 0 ? this.groundL : this.groundR;
      _footTarget.copy(this.root)
        .addScaledVector(right, sign * HIP_X * 0.92)
        .addScaledVector(fwd, swing * strideDist)
        .setY(Math.max(groundY, this.root.y - 0.15) + height + 0.045);

      // Idle stance widens and settles slightly instead of standing rigid.
      if (this.strideScale < 0.02) {
        _footTarget.copy(this.root)
          .addScaledVector(right, sign * HIP_X * (1.15 + (1 - this.stanceHeight) * 0.4))
          .addScaledVector(fwd, sign * 0.045)
          .setY(groundY + 0.045);
      }

      foot.copy(_footTarget);
      // Knees point forward and slightly outward.
      _poleTmp.copy(fwd).addScaledVector(right, sign * 0.25).normalize();
      solveIK(hip, foot, legLen, shinLen, _poleTmp, knee);
    }

    // ------------------------------------------------------------- weapon
    // The carbine is positioned relative to the chest, then both hands are
    // solved onto it. Doing it in this order guarantees the grip never slides.
    const shoulderMid = _shoulderMid.copy(J[RD.SHOULDER_L]).add(J[RD.SHOULDER_R]).multiplyScalar(0.5);
    const aimed = this.aimBlend;
    const gunLocal = _gunPos.copy(shoulderMid)
      .addScaledVector(right, THREE.MathUtils.lerp(0.16, 0.035, aimed))
      .addScaledVector(up, THREE.MathUtils.lerp(-0.16, -0.055, aimed))
      .addScaledVector(fwd, THREE.MathUtils.lerp(0.14, 0.22, aimed) - this.fireKick * 0.05);

    // Weapon orientation: yaw with the body, pitch with the aim, plus a small
    // muzzle rise from recoil.
    const gunPitch = this.pitch * THREE.MathUtils.lerp(0.55, 1.0, aimed) - this.fireKick * 0.18;
    _aimDir.copy(fwd).multiplyScalar(Math.cos(gunPitch)).addScaledVector(up, Math.sin(gunPitch)).normalize();
    this._aimDir.copy(_aimDir);

    const gunRight = _gunRight.crossVectors(_aimDir, up).normalize();
    const gunUp = _gunUp.crossVectors(gunRight, _aimDir).normalize();

    // Hand anchors in weapon space (matching the viewmodel's grip landmarks).
    _handR.copy(gunLocal).addScaledVector(_aimDir, 0.055).addScaledVector(gunUp, -0.085);
    _handL.copy(gunLocal).addScaledVector(_aimDir, 0.30).addScaledVector(gunUp, -0.055)
      .addScaledVector(gunRight, -0.02);
    J[RD.HAND_R].copy(_handR);
    J[RD.HAND_L].copy(_handL);

    const uaLen = BONE_LENGTH[BONE.UPPERARM_L];
    const faLen = BONE_LENGTH[BONE.FOREARM_L];
    // Right elbow tucks down and back; the left flares out under the handguard.
    _poleTmp.copy(right).multiplyScalar(0.9).addScaledVector(up, -1).normalize();
    solveIK(J[RD.SHOULDER_R], J[RD.HAND_R], uaLen, faLen, _poleTmp, J[RD.ELBOW_R]);
    _poleTmp.copy(right).multiplyScalar(-0.55).addScaledVector(up, -1)
      .addScaledVector(fwd, -0.2 * aimed).normalize();
    solveIK(J[RD.SHOULDER_L], J[RD.HAND_L], uaLen, faLen, _poleTmp, J[RD.ELBOW_L]);

    this._weapon.makeBasis(gunRight, gunUp, _negAim.copy(_aimDir).negate());
    this._weapon.setPosition(gunLocal);
  }

  /** Rebuild the pose straight from ragdoll particle positions. */
  setFromRagdoll(ragdoll) {
    const p = ragdoll.pos;
    for (let i = 0; i < JOINT_COUNT; i++) {
      this.joints[i].set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    // Weapon drops with the right hand, pointing along the forearm.
    _d.subVectors(this.joints[RD.HAND_R], this.joints[RD.ELBOW_R]);
    if (_d.lengthSq() < 1e-8) _d.set(0, -1, 0);
    _d.normalize();
    _gunRight.set(_d.z, 0, -_d.x);
    if (_gunRight.lengthSq() < 1e-6) _gunRight.set(1, 0, 0);
    _gunRight.normalize();
    _gunUp.crossVectors(_gunRight, _d).normalize();
    this._weapon.makeBasis(_gunRight, _gunUp, _negAim.copy(_d).negate());
    this._weapon.setPosition(this.joints[RD.HAND_R]);
    this._buildMatrices();
  }

  _buildMatrices() {
    const J = this.joints;
    // A single non-finite joint would poison every bone downstream and take
    // the uniform upload with it, so the pose is validated before it is used.
    for (let i = 0; i < JOINT_COUNT; i++) {
      const j = J[i];
      if (!Number.isFinite(j.x) || !Number.isFinite(j.y) || !Number.isFinite(j.z)) {
        j.copy(this.root);
        j.y += 1.0;
      }
    }

    const refFwd = _refFwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));

    for (let k = 0; k < BONE_JOINTS.length; k++) {
      const [bone, from, to] = BONE_JOINTS[k];
      _boneDir.subVectors(J[to], J[from]);
      if (_boneDir.lengthSq() < 1e-10) _boneDir.set(0, 1, 0); else _boneDir.normalize();
      _basisX.crossVectors(refFwd, _boneDir);
      if (_basisX.lengthSq() < 1e-8) _basisX.crossVectors(_up.set(0, 1, 0), _boneDir);
      if (_basisX.lengthSq() < 1e-8) _basisX.set(1, 0, 0);
      _basisX.normalize();
      _basisZ.crossVectors(_basisX, _boneDir).normalize();
      this.matrices[bone].makeBasis(_basisX, _boneDir, _basisZ);
      this.matrices[bone].setPosition(J[from]);
    }

    // Hands and feet inherit their parent's frame with the joint as origin.
    _copyFrame(this.matrices[BONE.HAND_L], this.matrices[BONE.FOREARM_L], J[RD.HAND_L]);
    _copyFrame(this.matrices[BONE.HAND_R], this.matrices[BONE.FOREARM_R], J[RD.HAND_R]);
    _copyFrame(this.matrices[BONE.FOOT_L], this.matrices[BONE.SHIN_L], J[RD.FOOT_L]);
    _copyFrame(this.matrices[BONE.FOOT_R], this.matrices[BONE.SHIN_R], J[RD.FOOT_R]);
    this.matrices[BONE.WEAPON].copy(this._weapon);
  }

  /** World-space muzzle position and direction for AI fire. */
  getMuzzle(outPos, outDir) {
    outPos.set(0, 0, -0.47).applyMatrix4(this._weapon);
    outDir.copy(this._aimDir);
    return outPos;
  }

  getJoint(index, out) { return out.copy(this.joints[index]); }
}

function _offset(out, origin, right, fwd, up, x, y, twist) {
  const c = Math.cos(twist), s = Math.sin(twist);
  const rx = x * c, rz = -x * s;
  out.copy(origin).addScaledVector(right, rx).addScaledVector(fwd, rz).addScaledVector(up, y);
}

function _copyFrame(out, parent, position) {
  out.copy(parent);
  out.setPosition(position);
}

const _d = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _tmpEnd = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _pelvis = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _neck = new THREE.Vector3();
const _footTarget = new THREE.Vector3();
const _poleTmp = new THREE.Vector3();
const _shoulderMid = new THREE.Vector3();
const _gunPos = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _gunRight = new THREE.Vector3();
const _gunUp = new THREE.Vector3();
const _negAim = new THREE.Vector3();
const _handL = new THREE.Vector3();
const _handR = new THREE.Vector3();
const _refFwd = new THREE.Vector3();
const _boneDir = new THREE.Vector3();
const _basisX = new THREE.Vector3();
const _basisZ = new THREE.Vector3();
