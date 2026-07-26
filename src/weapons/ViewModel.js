import * as THREE from 'three';
import { GeometryBuilder } from '../world/GeometryBuilder.js';
import {
  buildCarbine, buildHands, buildBoltCarrier, buildChargingHandle, buildMagazine,
  buildGrenadeHand, WEAPON_ANCHORS
} from './WeaponGeometry.js';
import { Spring, Spring3, damp } from '../core/Spring.js';
import { Settings } from '../core/Settings.js';
import { RETICLE_FRAG, RETICLE_VERT, GLASS_FRAG } from '../render/shaders/optic.glsl.js';

/**
 * The first-person weapon rig.
 *
 * Nothing here is keyframed to a clock and then blended: every pose is a target
 * that springs chase, and the scripted actions (reload, inspect) only move
 * those targets. That is what makes the gun feel attached to a body instead of
 * playing an animation at you.
 */

/**
 * Viewmodel scale. A carbine held the way a person actually holds one puts the
 * buttplate behind the eye, and you spend the match looking at the inside of a
 * stock. Every shooter solves this the same way: shrink the gun and push it
 * forward until the whole silhouette clears the near plane.
 */
const VM_SCALE = 0.86;
const TAU = Math.PI * 2;
const STOCK_BACK = 0.375 * VM_SCALE;   // buttplate, behind the receiver origin
const SIGHT_UP = WEAPON_ANCHORS.sightAxisOffsetY * VM_SCALE;

/**
 * Poses are the weapon origin — the receiver centre, on the bore line — in eye
 * space. `z` is chosen so the buttplate stays in front of the camera in every
 * pose but the deepest sprint carry.
 */
const POSE = {
  hip:    { p: [0.104, -0.118, -0.520], r: [0.020, -0.058, 0.032] },
  // ADS drops the bore by exactly the sight height, which puts the red dot on
  // the camera axis without a magic number.
  ads:    { p: [0.000, -SIGHT_UP, -0.400], r: [0.000, 0.000, 0.000] },
  sprint: { p: [0.146, -0.186, -0.430], r: [0.320, -0.520, 0.460] },
  low:    { p: [0.126, -0.226, -0.470], r: [0.620, -0.180, 0.130] },
  crouch: { p: [0.098, -0.106, -0.530], r: [0.010, -0.050, 0.028] },
  // Rifle dropped to the hip while the other hand has a grenade in it.
  stow:   { p: [0.150, -0.330, -0.430], r: [0.880, -0.300, 0.220] }
};

/**
 * The grenade arm, as positions and rotations of the hand in eye space. It
 * comes up from under the frame, winds back as the throw charges, and whips
 * through `release` on the way out.
 */
const GRENADE_POSE = {
  down:    { p: [0.300, -0.520, -0.360], r: [0.90, -0.30, 0.10] },
  ready:   { p: [0.235, -0.180, -0.395], r: [0.16, -0.34, 0.05] },
  wound:   { p: [0.315, -0.120, -0.250], r: [-0.30, -0.60, 0.28] },
  release: { p: [0.055, 0.055, -0.620], r: [-0.55, 0.10, -0.22] }
};

export class ViewModel {
  constructor(materialFactory, prevViewProjection) {
    this.factory = materialFactory;
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    this.root.matrixAutoUpdate = false;

    this.transparent = new THREE.Group();
    this.transparent.matrixAutoUpdate = false;

    // Each mesh moves on its own, and the velocity pass needs a previous world
    // matrix per mesh, so each one gets its own material. The expensive
    // uniforms — texture arrays and lighting — are shared by reference.
    const vmMaterial = (name) =>
      materialFactory.createViewmodel(name, prevViewProjection, { detailStrength: 1.6 });

    // ---- static body (receiver, furniture, optic shell, hands, sleeves)
    this.bodyMaterial = vmMaterial('vm-body');
    const body = new GeometryBuilder(null, 'vm-body');
    buildCarbine(body, { wear: 0.55 });
    buildHands(body);
    this.bodyMesh = new THREE.Mesh(body.build(), this.bodyMaterial);
    this.bodyMesh.frustumCulled = false;

    // ---- moving parts
    const chGeo = new GeometryBuilder(null, 'vm-ch');
    buildChargingHandle(chGeo);
    this.chargingHandle = new THREE.Mesh(chGeo.build(), vmMaterial('vm-ch'));
    this.chargingHandle.position.copy(WEAPON_ANCHORS.chargingHandle);
    this.chargingHandle.frustumCulled = false;

    const bcGeo = new GeometryBuilder(null, 'vm-bolt');
    buildBoltCarrier(bcGeo);
    this.bolt = new THREE.Mesh(bcGeo.build(), vmMaterial('vm-bolt'));
    this.bolt.position.copy(WEAPON_ANCHORS.boltCarrier);
    this.bolt.frustumCulled = false;

    const magGeo = new GeometryBuilder(null, 'vm-mag');
    buildMagazine(magGeo);
    this.spareMag = new THREE.Mesh(magGeo.build(), vmMaterial('vm-mag'));
    this.spareMag.visible = false;
    this.spareMag.frustumCulled = false;

    // ---- grenade in the off hand, its own group so it can swing independently
    const grenGeo = new GeometryBuilder(null, 'vm-grenade');
    buildGrenadeHand(grenGeo);
    this.grenadeMesh = new THREE.Mesh(grenGeo.build(), vmMaterial('vm-grenade'));
    this.grenadeMesh.frustumCulled = false;
    this.grenadeMesh.visible = false;
    this.grenadeArm = new THREE.Group();
    this.grenadeArm.add(this.grenadeMesh);
    this.root.add(this.grenadeArm);

    this._velocityMeshes = [this.bodyMesh, this.chargingHandle, this.bolt, this.spareMag, this.grenadeMesh];
    this._prevWorld = this._velocityMeshes.map(() => new THREE.Matrix4());
    this._historyValid = false;

    this.weapon = new THREE.Group();
    this.weapon.add(this.bodyMesh, this.chargingHandle, this.bolt, this.spareMag);
    this.weapon.scale.setScalar(VM_SCALE);
    this.root.add(this.weapon);

    this._buildOptic();

    // ---- animation state
    this.posSpring = new Spring3(30, 0.90);
    this.rotSpring = new Spring3(26, 0.92);
    this.swaySpring = new Spring3(13, 0.62);
    this.recoilPos = new Spring3(34, 0.52);
    this.recoilRot = new Spring3(30, 0.48);
    this.boltSpring = new Spring(0, 90, 0.9);
    this.chSpring = new Spring(0, 55, 0.85);
    this.magDrop = new Spring3(24, 0.8);
    this.adsBlend = 0;
    this.lowerBlend = 0;
    this.sprintBlend = 0;
    this.grenadeBlend = 0;
    this.bobPhase = 0;
    this.time = 0;

    this.action = null;        // { name, t, duration, steps }
    this.actionTime = 0;
    this.muzzleWorld = new THREE.Vector3();
    this.ejectWorld = new THREE.Vector3();
    this.ejectDirWorld = new THREE.Vector3();
    this.sightAxis = new THREE.Vector3();
    this._prevLook = new THREE.Vector2();

    this.posSpring.set(POSE.hip.p[0], POSE.hip.p[1], POSE.hip.p[2]);
    this.rotSpring.set(POSE.hip.r[0], POSE.hip.r[1], POSE.hip.r[2]);
  }

  _buildOptic() {
    // The reticle plane sits inside the optic housing. It is not a sprite: the
    // shader solves for the angle between the eye ray and the sight axis, so
    // the dot stays parked on target however the head moves. A real collimator.
    const win = WEAPON_ANCHORS.sightWindow;
    // Sized to clear the inside of the housing tube; any larger and the lens
    // pokes through the side walls.
    const geo = new THREE.PlaneGeometry(0.0265, 0.0265);

    this.reticleMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: RETICLE_VERT,
      fragmentShader: RETICLE_FRAG,
      uniforms: {
        uSightOrigin: { value: new THREE.Vector3() },
        uSightAxis: { value: new THREE.Vector3(0, 0, -1) },
        uSightRight: { value: new THREE.Vector3(1, 0, 0) },
        uSightUp: { value: new THREE.Vector3(0, 1, 0) },
        uCameraPos: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Vector3(1.0, 0.16, 0.10) },
        uBrightness: { value: 1.0 },
        uDotAngle: { value: 0.00087 },      // 3 MOA at unity magnification
        uWindowRadius: { value: 0.0132 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    this.glassMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: RETICLE_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uSightAxis: { value: new THREE.Vector3(0, 0, -1) },
        uTint: { value: new THREE.Vector3(0.24, 0.34, 0.46) },
        uWindowRadius: { value: 0.0142 },
        uSightOrigin: { value: new THREE.Vector3() }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide
    });

    this.glass = new THREE.Mesh(geo, this.glassMaterial);
    this.glass.position.set(win.x, win.y, win.z - 0.028);
    this.glass.frustumCulled = false;

    this.reticle = new THREE.Mesh(geo, this.reticleMaterial);
    this.reticle.position.set(win.x, win.y, win.z - 0.0265);
    this.reticle.frustumCulled = false;

    // The glass and the dot are blended, so they belong in the forward pass
    // after lighting — not in the MRT prepass, which they cannot write. They
    // ride the weapon transform by copying its world matrix each frame.
    this.opticGroup = new THREE.Group();
    this.opticGroup.matrixAutoUpdate = false;
    this.opticGroup.add(this.glass, this.reticle);
    this.transparent.add(this.opticGroup);
  }

  /** Kick the whole rig; called by the weapon on each shot. */
  applyRecoil({ back = 0.030, rise = 0.11, yaw = 0.02, roll = 0.03, lateral = 0.004 } = {}) {
    const adsScale = 1 - this.adsBlend * 0.42;
    this.recoilPos.nudge(lateral * adsScale, back * 0.30 * adsScale, back * 18.0 * adsScale);
    this.recoilRot.nudge(-rise * 16.0 * adsScale, yaw * 10.0 * adsScale, roll * 12.0 * adsScale);
    this.boltSpring.value = 1;
    this.boltSpring.velocity = 0;
  }

  startAction(name, duration, steps) {
    this.action = { name, duration, steps };
    this.actionTime = 0;
  }

  cancelAction() { this.action = null; }

  get busy() { return this.action !== null; }

  /**
   * Place the grenade arm for this frame.
   *
   * Three blends stacked in order: how far it has come up, how far the throw is
   * charged, and how far through the throw it is. The throw curve is eased so
   * the wind-up is unhurried and the release is not — a linear swing looks like
   * the arm is being dragged rather than swung.
   */
  _poseGrenadeArm(grenade, bobX, bobY, leanX) {
    const raise = grenade ? grenade.raiseBlend : 0;
    this.grenadeMesh.visible = raise > 0.001;
    if (!this.grenadeMesh.visible) return;

    const set = (v, key, which) => v.set(
      GRENADE_POSE[key][which][0], GRENADE_POSE[key][which][1], GRENADE_POSE[key][which][2]
    );

    set(_p, 'down', 'p'); set(_r, 'down', 'r');
    set(_p2, 'ready', 'p'); set(_r2, 'ready', 'r');
    _p.lerp(_p2, raise);
    _r.lerp(_r2, raise);

    const charge = grenade.charge;
    if (charge > 0) {
      set(_p2, 'wound', 'p'); set(_r2, 'wound', 'r');
      _p.lerp(_p2, charge);
      _r.lerp(_r2, charge);
    }

    const t = grenade.throwBlend;
    if (t > 0) {
      // Fast out of the wind-up, then settling back — the arm overshoots and
      // returns rather than stopping dead at full extension.
      const swing = Math.sin(Math.min(1, t * 1.9) * Math.PI * 0.5) * (1 - Math.max(0, t - 0.55) / 0.45);
      set(_p2, 'release', 'p'); set(_r2, 'release', 'r');
      _p.lerp(_p2, swing);
      _r.lerp(_r2, swing);
    }

    this.grenadeArm.position.copy(_p);
    this.grenadeArm.position.x += this.swaySpring.value.x * 0.7 + bobX * 1.3 + leanX;
    this.grenadeArm.position.y += this.swaySpring.value.y * 0.7 + bobY * 1.3;
    _euler.set(_r.x, _r.y, _r.z, 'YXZ');
    this.grenadeArm.quaternion.setFromEuler(_euler);
  }

  update(dt, ctx) {
    this.time += dt;
    const {
      camera, player, weapon, lookDelta, wallProximity, grenade
    } = ctx;

    // ---------------------------------------------------------- pose blend
    this.adsBlend = player.adsBlend;
    // Speed-derived, like the gait: the sprint flag drops for single frames
    // over rough ground and the weapon would jerk back up each time. Aiming
    // still wins outright, since the sprint pose is applied after the ADS one.
    const sprintPose = player.sprintNorm * (1 - player.adsBlend);
    this.sprintBlend = damp(this.sprintBlend, sprintPose, 12, dt);
    this.lowerBlend = damp(this.lowerBlend, wallProximity, 16, dt);

    const base = player.crouched ? POSE.crouch : POSE.hip;
    _p.set(base.p[0], base.p[1], base.p[2]);
    _r.set(base.r[0], base.r[1], base.r[2]);

    _p2.set(POSE.ads.p[0], POSE.ads.p[1], POSE.ads.p[2]);
    _r2.set(POSE.ads.r[0], POSE.ads.r[1], POSE.ads.r[2]);
    _p.lerp(_p2, this.adsBlend);
    _r.lerp(_r2, this.adsBlend);

    _p2.set(POSE.sprint.p[0], POSE.sprint.p[1], POSE.sprint.p[2]);
    _r2.set(POSE.sprint.r[0], POSE.sprint.r[1], POSE.sprint.r[2]);
    _p.lerp(_p2, this.sprintBlend);
    _r.lerp(_r2, this.sprintBlend);

    _p2.set(POSE.low.p[0], POSE.low.p[1], POSE.low.p[2]);
    _r2.set(POSE.low.r[0], POSE.low.r[1], POSE.low.r[2]);
    _p.lerp(_p2, this.lowerBlend);
    _r.lerp(_r2, this.lowerBlend);

    // A grenade in the other hand drops the rifle to the hip; it is applied
    // last so it wins over every other pose.
    this.grenadeBlend = grenade ? grenade.raiseBlend : 0;
    _p2.set(POSE.stow.p[0], POSE.stow.p[1], POSE.stow.p[2]);
    _r2.set(POSE.stow.r[0], POSE.stow.r[1], POSE.stow.r[2]);
    _p.lerp(_p2, this.grenadeBlend);
    _r.lerp(_r2, this.grenadeBlend);

    // scripted actions displace the target pose rather than replacing it
    if (this.action) {
      this.actionTime += dt;
      const t = Math.min(1, this.actionTime / this.action.duration);
      this.action.steps(t, _p, _r, this);
      if (this.actionTime >= this.action.duration) {
        this.action.onComplete?.();
        this.action = null;
      }
    }

    this.posSpring.target.copy(_p);
    this.rotSpring.target.copy(_r);
    this.posSpring.update(dt);
    this.rotSpring.update(dt);

    // ------------------------------------------------------------- inertia
    // The gun lags the aim. Fast flicks throw it wide, then it settles.
    const swayScale = (1 - this.adsBlend * 0.72) * Settings.data.cameraShake;
    const lagX = THREE.MathUtils.clamp(-lookDelta.x * 2.6, -0.09, 0.09);
    const lagY = THREE.MathUtils.clamp(lookDelta.y * 2.2, -0.075, 0.075);
    this.swaySpring.target.set(lagX * swayScale, lagY * swayScale, 0);
    this.swaySpring.update(dt);

    // ------------------------------------------------------------ movement
    // Same gait the eye rig uses, blended rather than stepped, so the weapon
    // and the head never disagree about where in the stride they are.
    const speed = player.speedNorm;
    const settled = 1 - THREE.MathUtils.clamp(player.airborneFor / 0.15, 0, 1);
    const bobRate = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(8.4, 6.2, player.stanceBlend), 10.4, player.sprintNorm
    );
    if (settled > 0) this.bobPhase = (this.bobPhase + dt * bobRate * Math.min(speed, 1.4)) % TAU;
    const bobAmt = player.bobStrength * settled
      * (1 - this.adsBlend * 0.82) * Settings.data.cameraShake;

    const bobX = Math.sin(this.bobPhase) * 0.0155 * bobAmt;
    // Matches the eye rig: a plain cosine at twice stride rate, no corners.
    const bobY = Math.cos(this.bobPhase * 2) * -0.0068 * bobAmt;
    const bobRoll = Math.sin(this.bobPhase + 0.6) * 0.030 * bobAmt;
    const bobPitch = Math.sin(this.bobPhase * 2) * 0.018 * bobAmt;

    // idle breathing keeps the weapon alive when standing still
    const idle = (1 - Math.min(speed, 1)) * (1 - this.adsBlend * 0.55);
    const breathX = Math.sin(this.time * 0.9) * 0.0022 * idle;
    const breathY = Math.sin(this.time * 1.35 + 0.7) * 0.0026 * idle;
    const breathRot = Math.sin(this.time * 0.72 + 1.9) * 0.008 * idle;

    // Vertical velocity throws the weapon on jumps and landings. Faded in with
    // the same airborne ramp the bob uses, so a kerb does not snap it.
    const airY = THREE.MathUtils.clamp(-player.velocity.y * 0.0045, -0.03, 0.03) * (1 - settled);

    // The weapon lives in camera space, so the camera's lean roll does not tip
    // it on screen — the world rotates around a weapon that stays put. A little
    // roll back the other way, plus a drift away from the lean, reads as the
    // shoulder trailing the head rather than the arms being welded to the view.
    const lean = player.leanBlend;
    const leanX = -lean * 0.014;
    const leanRoll = lean * 0.062;

    this.recoilPos.target.set(0, 0, 0);
    this.recoilRot.target.set(0, 0, 0);
    this.recoilPos.update(dt);
    this.recoilRot.update(dt);

    // --------------------------------------------------------- final compose
    const pos = this.weapon.position;
    pos.copy(this.posSpring.value);
    pos.x += this.swaySpring.value.x + bobX + breathX + leanX + this.recoilPos.value.x;
    pos.y += this.swaySpring.value.y + bobY + breathY + airY + this.recoilPos.value.y;
    pos.z += this.recoilPos.value.z * 0.02;

    _euler.set(
      this.rotSpring.value.x + bobPitch + this.recoilRot.value.x * 0.02 + breathRot * 0.5 - lookDelta.y * 0.9,
      this.rotSpring.value.y + this.recoilRot.value.y * 0.02 + breathRot - lookDelta.x * 1.1,
      this.rotSpring.value.z + bobRoll + leanRoll + this.recoilRot.value.z * 0.02,
      'YXZ'
    );
    this.weapon.quaternion.setFromEuler(_euler);

    this._poseGrenadeArm(grenade, bobX, bobY, leanX);

    // ------------------------------------------------------- moving parts
    this.boltSpring.target = weapon?.boltLocked ? 1 : 0;
    this.boltSpring.update(dt);
    this.chSpring.target = 0;
    this.chSpring.update(dt);
    this.bolt.position.z = WEAPON_ANCHORS.boltCarrier.z + this.boltSpring.value * 0.052;
    this.chargingHandle.position.z = WEAPON_ANCHORS.chargingHandle.z + this.chSpring.value * 0.070;

    this.magDrop.update(dt);
    if (this.magVisible) {
      this.spareMag.visible = true;
      this.spareMag.position.copy(this.magDrop.value);
    } else {
      this.spareMag.visible = false;
    }

    // ------------------------------------------------------------- anchors
    this.root.matrix.copy(camera.matrixWorld);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);

    this.opticGroup.matrix.copy(this.weapon.matrixWorld);
    this.transparent.updateMatrixWorld(true);

    // Velocity history, published after the pose is final. Without this the
    // gun reprojects against an identity matrix and smears over the screen.
    for (let i = 0; i < this._velocityMeshes.length; i++) {
      const mesh = this._velocityMeshes[i];
      const prev = this._prevWorld[i];
      if (!this._historyValid) prev.copy(mesh.matrixWorld);
      mesh.material.uniforms.uPrevModelMatrix.value.copy(prev);
      prev.copy(mesh.matrixWorld);
    }
    this._historyValid = true;

    this.muzzleWorld.copy(WEAPON_ANCHORS.muzzle).applyMatrix4(this.weapon.matrixWorld);
    this.ejectWorld.copy(WEAPON_ANCHORS.ejectionPort).applyMatrix4(this.weapon.matrixWorld);
    _v.set(1, 0.45, 0.12).normalize();
    this.ejectDirWorld.copy(_v).transformDirection(this.weapon.matrixWorld);

    // optic uniforms live in world space so the collimation is exact
    const rm = this.reticleMaterial.uniforms;
    const gm = this.glassMaterial.uniforms;
    _sightOrigin.copy(WEAPON_ANCHORS.sightWindow).applyMatrix4(this.weapon.matrixWorld);
    _sightAxis.set(0, 0, -1).transformDirection(this.weapon.matrixWorld);
    this.sightAxis.copy(_sightAxis);
    rm.uSightOrigin.value.copy(_sightOrigin);
    rm.uSightAxis.value.copy(_sightAxis);
    rm.uSightRight.value.set(1, 0, 0).transformDirection(this.weapon.matrixWorld);
    rm.uSightUp.value.set(0, 1, 0).transformDirection(this.weapon.matrixWorld);
    rm.uCameraPos.value.copy(camera.position);
    rm.uBrightness.value = 0.85 + this.adsBlend * 0.55;
    gm.uCameraPos.value.copy(camera.position);
    gm.uSightAxis.value.copy(_sightAxis);
    gm.uSightOrigin.value.copy(_sightOrigin);
  }

  dispose() {
    this.bodyMesh.geometry.dispose();
    this.chargingHandle.geometry.dispose();
    this.bolt.geometry.dispose();
    this.spareMag.geometry.dispose();
    this.glass.geometry.dispose();
    this.reticleMaterial.dispose();
    this.glassMaterial.dispose();
  }
}

const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _r2 = new THREE.Vector3();
const _v = new THREE.Vector3();
const _euler = new THREE.Euler();
const _sightOrigin = new THREE.Vector3();
const _sightAxis = new THREE.Vector3();
export { POSE };
