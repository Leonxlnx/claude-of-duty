import * as THREE from 'three';
import { closestPointOnTriangleSoup, closestPointOnSegment, RayHit } from './BVH.js';

/**
 * Swept-capsule character controller against the static BVH.
 *
 * Movement is integrated with conservative substeps (never longer than a
 * fraction of the capsule radius) followed by an iterative depenetration and
 * slide solve. That combination removes tunnelling, wall climbing and stair
 * jitter without needing continuous capsule-vs-triangle sweep math.
 */

const MAX_DEPEN_ITERS = 6;
const SKIN = 0.008;

export class CharacterController {
  constructor(bvh, { radius = 0.34, height = 1.78, crouchHeight = 1.18, stepOffset = 0.42, slopeLimit = 48 } = {}) {
    this.bvh = bvh;
    this.radius = radius;
    this.standHeight = height;
    this.crouchHeight = crouchHeight;
    this.height = height;
    this.stepOffset = stepOffset;
    this.slopeLimitCos = Math.cos(slopeLimit * Math.PI / 180);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundSurface = 0;
    this.lastGroundedTime = 0;
    this.hitCeiling = false;
    this.wallContact = 0;      // 0..1 how much the capsule is pressed into geometry
    this.wallNormal = new THREE.Vector3();
    this.landingImpact = 0;
    this.slideDirection = new THREE.Vector3();
    this._contactTris = [];
    this._contactCount = 0;
  }

  setHeight(h) { this.height = h; }

  /** Segment endpoints of the capsule core (feet-anchored). */
  _segment(px, py, pz, out) {
    const r = this.radius;
    out.a.set(px, py + r, pz);
    out.b.set(px, py + this.height - r, pz);
    return out;
  }

  /** Collect triangles whose AABB touches the swept capsule region. */
  _gather(px, py, pz, expand) {
    const r = this.radius + expand;
    const minx = px - r, maxx = px + r;
    const miny = py - expand, maxy = py + this.height + expand;
    const minz = pz - r, maxz = pz + r;
    this._contactCount = 0;
    const list = this._contactTris;
    this.bvh.overlapBox(minx, miny, minz, maxx, maxy, maxz, (tri) => {
      list[this._contactCount++] = tri;
    });
  }

  /**
   * Push the capsule out of every overlapping triangle. Returns the number of
   * corrections applied; also records the steepest supporting normal.
   */
  _depenetrate(pos, collectGround) {
    const soup = this.bvh.soup;
    let corrections = 0;
    let bestGroundY = -1;
    let maxPush = 0;
    this.hitCeiling = false;
    this.wallNormal.set(0, 0, 0);

    for (let iter = 0; iter < MAX_DEPEN_ITERS; iter++) {
      let moved = false;
      this._segment(pos.x, pos.y, pos.z, _seg);
      for (let i = 0; i < this._contactCount; i++) {
        const tri = this._contactTris[i];
        closestPointOnTriangleSoup(soup, tri, pos.x, pos.y + this.height * 0.5, pos.z, _tp);
        // closest point on capsule axis to that triangle point
        closestPointOnSegment(_seg.a.x, _seg.a.y, _seg.a.z, _seg.b.x, _seg.b.y, _seg.b.z, _tp.x, _tp.y, _tp.z, _cp);
        // refine: closest point on triangle to the axis point
        closestPointOnTriangleSoup(soup, tri, _cp.x, _cp.y, _cp.z, _tp);
        closestPointOnSegment(_seg.a.x, _seg.a.y, _seg.a.z, _seg.b.x, _seg.b.y, _seg.b.z, _tp.x, _tp.y, _tp.z, _cp);

        _push.subVectors(_cp, _tp);
        const dist = _push.length();
        const pen = this.radius + SKIN - dist;
        if (pen <= 0) continue;

        if (dist < 1e-5) {
          this.bvh.triangleNormal(tri, _push);
          if (_push.y < 0) _push.multiplyScalar(-1);
        } else {
          _push.multiplyScalar(1 / dist);
        }

        pos.addScaledVector(_push, pen);
        _seg.a.addScaledVector(_push, pen);
        _seg.b.addScaledVector(_push, pen);
        moved = true;
        corrections++;
        if (pen > maxPush) maxPush = pen;

        if (_push.y > bestGroundY && _push.y > 0.1) {
          bestGroundY = _push.y;
          if (collectGround && _push.y >= this.slopeLimitCos) {
            this.groundNormal.copy(_push);
            this.groundSurface = soup.surfaces[tri];
          }
        }
        if (_push.y < -0.5) this.hitCeiling = true;
        if (Math.abs(_push.y) < 0.6) this.wallNormal.add(_push);

        // remove velocity into the surface
        const vn = this.velocity.dot(_push);
        if (vn < 0) this.velocity.addScaledVector(_push, -vn);
      }
      if (!moved) break;
    }

    if (this.wallNormal.lengthSq() > 1e-6) this.wallNormal.normalize();
    this.wallContact = Math.min(1, maxPush / (this.radius * 0.5));
    return corrections;
  }

  /** Ground probe: short downward ray fan under the capsule. */
  _probeGround(pos, snap) {
    const r = this.radius * 0.72;
    const probeLen = snap ? 0.36 : 0.06;
    let bestT = Infinity, hitAny = false;
    _down.set(0, -1, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const ox = i === 4 ? 0 : Math.cos(a) * r;
      const oz = i === 4 ? 0 : Math.sin(a) * r;
      _origin.set(pos.x + ox, pos.y + this.radius + 0.02, pos.z + oz);
      const h = this.bvh.raycast(_origin, _down, this.radius + probeLen, _hit);
      if (h.hit && h.normal.y >= this.slopeLimitCos) {
        const t = h.t - this.radius;
        if (t < bestT) {
          bestT = t;
          hitAny = true;
          this.groundNormal.copy(h.normal);
          this.groundSurface = h.surface;
        }
      }
    }
    if (hitAny && bestT < probeLen + 0.03) {
      if (snap && bestT > 0.001 && this.velocity.y <= 0.5) {
        pos.y -= Math.min(bestT, probeLen);
      }
      return true;
    }
    return false;
  }

  /** Can the capsule stand up at the current position? */
  canStand() {
    const saved = this.height;
    this.height = this.standHeight;
    this._gather(this.position.x, this.position.y, this.position.z, 0.05);
    _probe.copy(this.position);
    const c = this._depenetrateProbeOnly(_probe);
    this.height = saved;
    return c < 0.02;
  }

  _depenetrateProbeOnly(pos) {
    const soup = this.bvh.soup;
    let maxPen = 0;
    this._segment(pos.x, pos.y, pos.z, _seg);
    for (let i = 0; i < this._contactCount; i++) {
      const tri = this._contactTris[i];
      closestPointOnTriangleSoup(soup, tri, pos.x, pos.y + this.height * 0.5, pos.z, _tp);
      closestPointOnSegment(_seg.a.x, _seg.a.y, _seg.a.z, _seg.b.x, _seg.b.y, _seg.b.z, _tp.x, _tp.y, _tp.z, _cp);
      closestPointOnTriangleSoup(soup, tri, _cp.x, _cp.y, _cp.z, _tp);
      const d = _cp.distanceTo(_tp);
      const pen = this.radius - d;
      if (pen > maxPen) maxPen = pen;
    }
    return maxPen;
  }

  /**
   * Integrate one fixed step.
   * @param {number} dt fixed timestep
   * @param {THREE.Vector3} displacement desired motion for this step
   */
  move(dt, displacement) {
    const wasGrounded = this.grounded;
    const fallSpeed = -this.velocity.y;
    this.landingImpact = 0;

    const total = displacement.length();
    const maxStep = this.radius * 0.35;
    const substeps = Math.max(1, Math.min(8, Math.ceil(total / maxStep)));
    _stepVec.copy(displacement).multiplyScalar(1 / substeps);

    for (let s = 0; s < substeps; s++) {
      _prevPos.copy(this.position);
      this.position.add(_stepVec);
      this._gather(this.position.x, this.position.y, this.position.z, Math.max(0.12, _stepVec.length() + 0.05));
      const corrections = this._depenetrate(this.position, true);

      // Stair / small-ledge assist: if we were blocked horizontally while
      // grounded, try lifting over the obstruction.
      if (corrections > 0 && wasGrounded && Math.abs(_stepVec.y) < 0.2) {
        const blockedX = Math.abs(this.position.x - (_prevPos.x + _stepVec.x));
        const blockedZ = Math.abs(this.position.z - (_prevPos.z + _stepVec.z));
        if (blockedX + blockedZ > _stepVec.length() * 0.25) {
          _probe.copy(_prevPos);
          _probe.y += this.stepOffset;
          _probe.x += _stepVec.x;
          _probe.z += _stepVec.z;
          this._gather(_probe.x, _probe.y, _probe.z, 0.1);
          const savedVel = _velSave.copy(this.velocity);
          const c2 = this._depenetrate(_probe, false);
          this.velocity.copy(savedVel);
          if (c2 === 0 || _probe.distanceToSquared(_prevPos) > 1e-6) {
            // drop back onto the step surface
            _origin.set(_probe.x, _probe.y + this.radius, _probe.z);
            _down.set(0, -1, 0);
            const h = this.bvh.raycast(_origin, _down, this.stepOffset + this.radius + 0.05, _hit);
            if (h.hit && h.normal.y >= this.slopeLimitCos) {
              const landY = h.point.y;
              if (landY > _prevPos.y + 0.01 && landY < _prevPos.y + this.stepOffset + 0.01) {
                this.position.set(_probe.x, landY, _probe.z);
                this._gather(this.position.x, this.position.y, this.position.z, 0.08);
                this._depenetrate(this.position, true);
              }
            }
          }
        }
      }
    }

    // Ground state
    const snapping = this.velocity.y <= 0.6;
    this.grounded = this._probeGround(this.position, snapping && wasGrounded);
    if (this.grounded) {
      if (this.velocity.y < 0) this.velocity.y = 0;
      if (!wasGrounded && fallSpeed > 2.0) {
        this.landingImpact = Math.min(1, (fallSpeed - 2.0) / 9.0);
      }
    }

    // Steep-slope sliding
    if (this.grounded && this.groundNormal.y < this.slopeLimitCos) {
      this.slideDirection.set(this.groundNormal.x, 0, this.groundNormal.z).normalize();
      this.velocity.addScaledVector(this.slideDirection, 9.0 * dt);
      this.grounded = false;
    }
  }

  /** Upward mantle check: is there a ledge we can pull onto? */
  probeMantle(forward, maxHeight = 1.5) {
    const r = this.radius;
    _origin.set(this.position.x, this.position.y + maxHeight + 0.4, this.position.z)
      .addScaledVector(forward, r + 0.42);
    _down.set(0, -1, 0);
    const h = this.bvh.raycast(_origin, _down, maxHeight + 0.6, _hit);
    if (!h.hit || h.normal.y < 0.7) return null;
    const ledgeY = h.point.y;
    const rise = ledgeY - this.position.y;
    if (rise < this.stepOffset + 0.05 || rise > maxHeight) return null;

    // clearance for the standing capsule at the landing spot
    _probe.set(h.point.x, ledgeY + 0.03, h.point.z);
    const saved = this.height;
    this.height = this.standHeight;
    this._gather(_probe.x, _probe.y, _probe.z, 0.06);
    const pen = this._depenetrateProbeOnly(_probe);
    this.height = saved;
    if (pen > 0.06) return null;
    return _probe.clone();
  }
}

const _seg = { a: new THREE.Vector3(), b: new THREE.Vector3() };
const _tp = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _push = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _probe = new THREE.Vector3();
const _prevPos = new THREE.Vector3();
const _stepVec = new THREE.Vector3();
const _velSave = new THREE.Vector3();
const _hit = new RayHit();
