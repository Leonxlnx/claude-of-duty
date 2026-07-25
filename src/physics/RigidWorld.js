import * as THREE from 'three';
import { closestPointOnTriangleSoup, SURFACE } from './BVH.js';

/**
 * Sequential-impulse rigid body world with spatial-hash broadphase.
 * Shapes: sphere and box (box uses its 8 corners + face contacts against the
 * static BVH, which is enough for casings, cans, crates and debris while
 * staying cheap). Bodies sleep aggressively and come from a fixed pool.
 */

const GRAVITY = -19.6;
const SLEEP_LINEAR = 0.055;
const SLEEP_ANGULAR = 0.35;
const SLEEP_TIME = 0.55;
const CELL = 0.9;

export const SHAPE = { SPHERE: 0, BOX: 1, CAPSULE: 2 };

let _bodyIds = 0;

export class RigidBody {
  constructor() {
    this.id = _bodyIds++;
    this.shape = SHAPE.SPHERE;
    this.half = new THREE.Vector3(0.05, 0.05, 0.05);
    this.radius = 0.05;
    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.prevQuaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angular = new THREE.Vector3();
    this.invMass = 1;
    this.invInertia = new THREE.Vector3(1, 1, 1);
    this.restitution = 0.28;
    this.friction = 0.55;
    this.linearDamping = 0.02;
    this.angularDamping = 0.06;
    this.active = false;
    this.sleeping = false;
    this.sleepTimer = 0;
    this.lifetime = 0;
    this.maxLifetime = 12;
    this.surface = SURFACE.METAL;
    this.userData = null;
    this.onContact = null;
    this.ccd = false;
    this.contactImpulse = 0;
    this.group = 0;
  }

  setBox(hx, hy, hz, mass) {
    this.shape = SHAPE.BOX;
    this.half.set(hx, hy, hz);
    this.radius = Math.sqrt(hx * hx + hy * hy + hz * hz);
    this.invMass = mass > 0 ? 1 / mass : 0;
    const k = mass / 3;
    this.invInertia.set(
      1 / (k * (hy * hy + hz * hz)),
      1 / (k * (hx * hx + hz * hz)),
      1 / (k * (hx * hx + hy * hy))
    );
    return this;
  }

  setSphere(r, mass) {
    this.shape = SHAPE.SPHERE;
    this.radius = r;
    this.half.set(r, r, r);
    this.invMass = mass > 0 ? 1 / mass : 0;
    const i = 1 / (0.4 * mass * r * r);
    this.invInertia.set(i, i, i);
    return this;
  }

  wake() {
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  applyImpulse(ix, iy, iz, px, py, pz) {
    this.velocity.x += ix * this.invMass;
    this.velocity.y += iy * this.invMass;
    this.velocity.z += iz * this.invMass;
    if (px !== undefined) {
      _r.set(px - this.position.x, py - this.position.y, pz - this.position.z);
      _tmp.set(ix, iy, iz).cross(_r).multiplyScalar(-1);
      _tmp.applyQuaternion(_invQ.copy(this.quaternion).invert());
      _tmp.multiply(this.invInertia);
      _tmp.applyQuaternion(this.quaternion);
      this.angular.add(_tmp);
    }
    this.wake();
  }
}

export class RigidWorld {
  constructor(bvh, maxBodies = 256) {
    this.bvh = bvh;
    this.pool = [];
    this.bodies = [];
    this.maxBodies = maxBodies;
    for (let i = 0; i < maxBodies; i++) this.pool.push(new RigidBody());
    this.grid = new Map();
    this._tris = [];
    this._contacts = [];
    this._contactCount = 0;
    for (let i = 0; i < 512; i++) {
      this._contacts.push({
        a: null, b: null, nx: 0, ny: 0, nz: 0, depth: 0,
        px: 0, py: 0, pz: 0, normalImpulse: 0, tangentImpulse: 0,
        friction: 0.5, restitution: 0.2, surface: 0
      });
    }
    this.stats = { active: 0, sleeping: 0, contacts: 0 };
    this.onImpact = null;
  }

  spawn() {
    const b = this.pool.pop();
    if (!b) return null;
    b.active = true;
    b.sleeping = false;
    b.sleepTimer = 0;
    b.lifetime = 0;
    b.contactImpulse = 0;
    b.velocity.set(0, 0, 0);
    b.angular.set(0, 0, 0);
    b.quaternion.identity();
    b.onContact = null;
    b.userData = null;
    b.ccd = false;
    this.bodies.push(b);
    return b;
  }

  /** Recycle the oldest sleeping body when the pool is exhausted. */
  spawnOrRecycle() {
    let b = this.spawn();
    if (b) return b;
    let oldest = -1, oldestAge = -1;
    for (let i = 0; i < this.bodies.length; i++) {
      const c = this.bodies[i];
      if (c.group === 1) continue; // pinned/gameplay bodies
      const age = c.lifetime + (c.sleeping ? 100 : 0);
      if (age > oldestAge) { oldestAge = age; oldest = i; }
    }
    if (oldest < 0) return null;
    const recycled = this.bodies[oldest];
    this.bodies.splice(oldest, 1);
    this.pool.push(recycled);
    recycled.active = false;
    return this.spawn();
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) {
      this.bodies.splice(i, 1);
      body.active = false;
      body.userData = null;
      this.pool.push(body);
    }
  }

  clear() {
    while (this.bodies.length) this.remove(this.bodies[this.bodies.length - 1]);
  }

  step(dt) {
    const bodies = this.bodies;
    let active = 0, sleeping = 0;

    // integrate
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      b.lifetime += dt;
      if (b.maxLifetime > 0 && b.lifetime > b.maxLifetime) {
        this.remove(b);
        continue;
      }
      b.prevPosition.copy(b.position);
      b.prevQuaternion.copy(b.quaternion);
      if (b.sleeping) { sleeping++; continue; }
      active++;
      b.velocity.y += GRAVITY * dt;
      b.velocity.multiplyScalar(Math.max(0, 1 - b.linearDamping * dt * 60 * 0.016));
      b.angular.multiplyScalar(Math.max(0, 1 - b.angularDamping * dt * 60 * 0.016));

      if (b.ccd) {
        const speed = b.velocity.length() * dt;
        const limit = b.radius * 0.8;
        if (speed > limit) {
          const sub = Math.min(6, Math.ceil(speed / limit));
          const sdt = dt / sub;
          for (let s = 0; s < sub; s++) {
            b.position.addScaledVector(b.velocity, sdt);
            this._resolveStatic(b, sdt);
          }
        } else {
          b.position.addScaledVector(b.velocity, dt);
        }
      } else {
        b.position.addScaledVector(b.velocity, dt);
      }

      const av = b.angular;
      const aLen = av.length();
      if (aLen > 1e-5) {
        _tmp.copy(av).multiplyScalar(1 / aLen);
        _q.setFromAxisAngle(_tmp, aLen * dt);
        b.quaternion.premultiply(_q).normalize();
      }
    }

    this._contactCount = 0;
    for (const b of bodies) if (!b.sleeping) this._resolveStatic(b, dt);
    this._broadphase();

    // sequential impulse solve with warm-started accumulation
    const iterations = 6;
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < this._contactCount; i++) this._solveContact(this._contacts[i], dt, it === 0);
    }

    // sleeping
    for (const b of bodies) {
      if (b.sleeping || b.invMass === 0) continue;
      if (b.velocity.lengthSq() < SLEEP_LINEAR * SLEEP_LINEAR && b.angular.lengthSq() < SLEEP_ANGULAR * SLEEP_ANGULAR) {
        b.sleepTimer += dt;
        if (b.sleepTimer > SLEEP_TIME) {
          b.sleeping = true;
          b.velocity.set(0, 0, 0);
          b.angular.set(0, 0, 0);
        }
      } else b.sleepTimer = 0;
    }

    this.stats.active = active;
    this.stats.sleeping = sleeping;
    this.stats.contacts = this._contactCount;
  }

  /** Body vs static triangle soup — positional correction plus impulse. */
  _resolveStatic(b, dt) {
    const soup = this.bvh.soup;
    const r = b.radius;
    let count = 0;
    const tris = this._tris;
    this.bvh.overlapBox(
      b.position.x - r, b.position.y - r, b.position.z - r,
      b.position.x + r, b.position.y + r, b.position.z + r,
      (t) => { if (count < 64) tris[count++] = t; }
    );
    if (count === 0) return;

    for (let i = 0; i < count; i++) {
      const tri = tris[i];
      let px, py, pz, localR;
      if (b.shape === SHAPE.SPHERE) {
        closestPointOnTriangleSoup(soup, tri, b.position.x, b.position.y, b.position.z, _tp);
        _n.subVectors(b.position, _tp);
        localR = b.radius;
        px = _tp.x; py = _tp.y; pz = _tp.z;
      } else {
        // box: use the support point toward the triangle plus a small inflation
        closestPointOnTriangleSoup(soup, tri, b.position.x, b.position.y, b.position.z, _tp);
        _local.copy(_tp).sub(b.position).applyQuaternion(_invQ.copy(b.quaternion).invert());
        _local.x = THREE.MathUtils.clamp(_local.x, -b.half.x, b.half.x);
        _local.y = THREE.MathUtils.clamp(_local.y, -b.half.y, b.half.y);
        _local.z = THREE.MathUtils.clamp(_local.z, -b.half.z, b.half.z);
        _support.copy(_local).applyQuaternion(b.quaternion).add(b.position);
        closestPointOnTriangleSoup(soup, tri, _support.x, _support.y, _support.z, _tp);
        _n.subVectors(_support, _tp);
        localR = 0.012;
        px = _tp.x; py = _tp.y; pz = _tp.z;
      }

      let dist = _n.length();
      if (dist > localR) continue;
      if (dist < 1e-6) {
        this.bvh.triangleNormal(tri, _n);
      } else _n.multiplyScalar(1 / dist);

      // ensure normal opposes penetration direction
      this.bvh.triangleNormal(tri, _triN);
      if (_n.dot(_triN) < 0) _triN.multiplyScalar(-1);
      if (dist < 1e-6) _n.copy(_triN);

      const depth = localR - dist;
      if (depth <= 0) continue;

      b.position.addScaledVector(_n, depth * 0.85);
      if (b.shape === SHAPE.BOX) { px += _n.x * 0; }

      // contact impulse
      _r.set(px - b.position.x, py - b.position.y, pz - b.position.z);
      _pointVel.copy(b.angular).cross(_r).add(b.velocity);
      const vn = _pointVel.dot(_n);
      if (vn < 0) {
        const rest = vn < -1.1 ? b.restitution : 0;
        const invEff = b.invMass + effectiveAngularMass(b, _r, _n);
        let j = -(1 + rest) * vn / invEff;
        if (j > 0) {
          const mag = Math.abs(vn);
          b.contactImpulse = Math.max(b.contactImpulse, mag);
          if (mag > 0.7 && this.onImpact) {
            this.onImpact(b, px, py, pz, mag, soup.surfaces[tri]);
          }
          b.applyImpulse(_n.x * j, _n.y * j, _n.z * j, px, py, pz);

          // friction
          _pointVel.copy(b.angular).cross(_r).add(b.velocity);
          _t.copy(_pointVel).addScaledVector(_n, -_pointVel.dot(_n));
          const tl = _t.length();
          if (tl > 1e-4) {
            _t.multiplyScalar(1 / tl);
            const invEffT = b.invMass + effectiveAngularMass(b, _r, _t);
            let jt = -tl / invEffT;
            const maxF = j * b.friction;
            jt = THREE.MathUtils.clamp(jt, -maxF, maxF);
            b.applyImpulse(_t.x * jt, _t.y * jt, _t.z * jt, px, py, pz);
          }
        }
        b.wake();
      }
      void dt;
    }
  }

  _broadphase() {
    this.grid.clear();
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const cx = Math.floor(b.position.x / CELL);
      const cy = Math.floor(b.position.y / CELL);
      const cz = Math.floor(b.position.z / CELL);
      const key = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
      let list = this.grid.get(key);
      if (!list) { list = []; this.grid.set(key, list); }
      list.push(i);
    }

    for (const list of this.grid.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = bodies[list[i]], b = bodies[list[j]];
          if (a.sleeping && b.sleeping) continue;
          this._narrowphase(a, b);
        }
      }
    }
  }

  _narrowphase(a, b) {
    if (this._contactCount >= this._contacts.length) return;
    // treat both as spheres of their bounding radius for pair contacts —
    // sufficient for debris interaction, stacks are handled against statics
    const ra = a.shape === SHAPE.BOX ? Math.min(a.half.x, a.half.y, a.half.z) * 1.15 : a.radius;
    const rb = b.shape === SHAPE.BOX ? Math.min(b.half.x, b.half.y, b.half.z) * 1.15 : b.radius;
    _n.subVectors(b.position, a.position);
    const d = _n.length();
    const sum = ra + rb;
    if (d >= sum || d < 1e-6) return;
    _n.multiplyScalar(1 / d);
    const c = this._contacts[this._contactCount++];
    c.a = a; c.b = b;
    c.nx = _n.x; c.ny = _n.y; c.nz = _n.z;
    c.depth = sum - d;
    c.px = a.position.x + _n.x * ra;
    c.py = a.position.y + _n.y * ra;
    c.pz = a.position.z + _n.z * ra;
    c.normalImpulse = 0;
    c.tangentImpulse = 0;
    c.friction = (a.friction + b.friction) * 0.5;
    c.restitution = Math.max(a.restitution, b.restitution) * 0.6;
    a.wake(); b.wake();
  }

  _solveContact(c, dt, first) {
    const a = c.a, b = c.b;
    _n.set(c.nx, c.ny, c.nz);
    _ra.set(c.px - a.position.x, c.py - a.position.y, c.pz - a.position.z);
    _rb.set(c.px - b.position.x, c.py - b.position.y, c.pz - b.position.z);

    _pointVel.copy(a.angular).cross(_ra).add(a.velocity);
    _pointVel2.copy(b.angular).cross(_rb).add(b.velocity);
    _rel.subVectors(_pointVel2, _pointVel);
    const vn = _rel.dot(_n);

    const invEff = a.invMass + b.invMass + effectiveAngularMass(a, _ra, _n) + effectiveAngularMass(b, _rb, _n);
    if (invEff < 1e-9) return;

    const bias = first ? Math.max(0, c.depth - 0.004) * 0.2 / dt : 0;
    const rest = vn < -1.0 ? c.restitution : 0;
    let j = (-(1 + rest) * vn + bias) / invEff;
    const old = c.normalImpulse;
    c.normalImpulse = Math.max(0, old + j);
    j = c.normalImpulse - old;

    a.applyImpulse(-_n.x * j, -_n.y * j, -_n.z * j, c.px, c.py, c.pz);
    b.applyImpulse(_n.x * j, _n.y * j, _n.z * j, c.px, c.py, c.pz);

    _pointVel.copy(a.angular).cross(_ra).add(a.velocity);
    _pointVel2.copy(b.angular).cross(_rb).add(b.velocity);
    _rel.subVectors(_pointVel2, _pointVel);
    _t.copy(_rel).addScaledVector(_n, -_rel.dot(_n));
    const tl = _t.length();
    if (tl > 1e-5) {
      _t.multiplyScalar(1 / tl);
      const invEffT = a.invMass + b.invMass + effectiveAngularMass(a, _ra, _t) + effectiveAngularMass(b, _rb, _t);
      let jt = -tl / invEffT;
      const maxF = c.normalImpulse * c.friction;
      const oldT = c.tangentImpulse;
      c.tangentImpulse = THREE.MathUtils.clamp(oldT + jt, -maxF, maxF);
      jt = c.tangentImpulse - oldT;
      a.applyImpulse(-_t.x * jt, -_t.y * jt, -_t.z * jt, c.px, c.py, c.pz);
      b.applyImpulse(_t.x * jt, _t.y * jt, _t.z * jt, c.px, c.py, c.pz);
    }
  }
}

function effectiveAngularMass(body, r, n) {
  if (body.invMass === 0) return 0;
  _cross.copy(r).cross(n);
  _cross.applyQuaternion(_invQ2.copy(body.quaternion).invert());
  _cross.multiply(body.invInertia);
  _cross.applyQuaternion(body.quaternion);
  _cross2.copy(r).cross(n);
  return _cross.dot(_cross2);
}

const _tp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _triN = new THREE.Vector3();
const _r = new THREE.Vector3();
const _ra = new THREE.Vector3();
const _rb = new THREE.Vector3();
const _t = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _invQ = new THREE.Quaternion();
const _invQ2 = new THREE.Quaternion();
const _local = new THREE.Vector3();
const _support = new THREE.Vector3();
const _pointVel = new THREE.Vector3();
const _pointVel2 = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _cross2 = new THREE.Vector3();
