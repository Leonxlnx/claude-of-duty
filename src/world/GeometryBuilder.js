import * as THREE from 'three';
import { LAYER_SURFACE } from './MaterialLibrary.js';

/**
 * Accumulates world geometry into a single interleaved buffer with the
 * per-vertex layer / tint / wear attributes the world shader expects, and
 * optionally mirrors each primitive into the physics triangle soup.
 *
 * UVs are world-space planar projections chosen from the dominant face normal,
 * so nothing stretches and texture scale stays consistent across the map.
 */
export class GeometryBuilder {
  constructor(soup = null, name = 'batch') {
    this.soup = soup;
    this.name = name;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.layer = [];
    this.tint = [];
    this.wear = [];
    this.index = [];
    this.vertexCount = 0;
    this.triangleCount = 0;
    this._xf = null;
    this._nxf = new THREE.Matrix3();
    this._xfStack = [];
    this.bone = [];
    this.currentBone = -1;
  }

  /** Tag every following vertex with a skeleton bone index. */
  setBone(index) { this.currentBone = index; return this; }

  /**
   * Everything pushed while a transform is active is baked into world space by
   * it. Used by the weapon and character builders, which are authored in
   * convenient local frames (a grip angle, a limb axis) rather than world axes.
   */
  pushTransform(matrix) {
    this._xfStack.push(this._xf ? this._xf.clone() : null);
    const next = this._xf ? this._xf.clone().multiply(matrix) : matrix.clone();
    this._xf = next;
    this._nxf.setFromMatrix4(next).invert().transpose();
    return this;
  }

  popTransform() {
    this._xf = this._xfStack.pop() ?? null;
    if (this._xf) this._nxf.setFromMatrix4(this._xf).invert().transpose();
    return this;
  }

  _pushVertex(x, y, z, nx, ny, nz, u, v, layer, tint, wear) {
    if (this._xf) {
      _tv.set(x, y, z).applyMatrix4(this._xf);
      x = _tv.x; y = _tv.y; z = _tv.z;
      _tn.set(nx, ny, nz).applyMatrix3(this._nxf).normalize();
      nx = _tn.x; ny = _tn.y; nz = _tn.z;
    }
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    this.layer.push(layer);
    this.tint.push(tint[0], tint[1], tint[2]);
    this.wear.push(wear);
    if (this.currentBone >= 0) this.bone.push(this.currentBone);
    return this.vertexCount++;
  }

  /**
   * Quad from four world-space corners (counter-clockwise seen from outside).
   * uvScale is in tiles per metre.
   */
  addQuad(a, b, c, d, opts) {
    const {
      layer = 0, tint = WHITE, wear = 0.4, uvScale = 0.5,
      collide = false, surface = null, uvOffset = null, flip = false
    } = opts;

    _e1.subVectors(b, a);
    _e2.subVectors(d, a);
    _n.crossVectors(_e1, _e2).normalize();
    if (flip) _n.multiplyScalar(-1);

    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    let axisU, axisV;
    if (ay >= ax && ay >= az) { axisU = 'x'; axisV = 'z'; }
    else if (ax >= az) { axisU = 'z'; axisV = 'y'; }
    else { axisU = 'x'; axisV = 'y'; }
    const ou = uvOffset ? uvOffset[0] : 0;
    const ov = uvOffset ? uvOffset[1] : 0;

    const verts = flip ? [a, d, c, b] : [a, b, c, d];
    const start = this.vertexCount;
    for (const p of verts) {
      this._pushVertex(
        p.x, p.y, p.z, _n.x, _n.y, _n.z,
        (p[axisU] + ou) * uvScale, (p[axisV] + ov) * uvScale,
        layer, tint, wear
      );
    }
    this.index.push(start, start + 1, start + 2, start, start + 2, start + 3);
    this.triangleCount += 2;

    if (collide && this.soup) {
      const s = surface ?? LAYER_SURFACE[layer] ?? 0;
      const [p0, p1, p2, p3] = verts;
      if (this._xf) {
        _t0.copy(p0).applyMatrix4(this._xf);
        _t1.copy(p1).applyMatrix4(this._xf);
        _t2.copy(p2).applyMatrix4(this._xf);
        _t3.copy(p3).applyMatrix4(this._xf);
        this.soup.addTriangle(_t0.x, _t0.y, _t0.z, _t1.x, _t1.y, _t1.z, _t2.x, _t2.y, _t2.z, s);
        this.soup.addTriangle(_t0.x, _t0.y, _t0.z, _t2.x, _t2.y, _t2.z, _t3.x, _t3.y, _t3.z, s);
      } else {
        this.soup.addTriangle(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, s);
        this.soup.addTriangle(p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, s);
      }
    }
    return this;
  }

  /**
   * Axis-aligned-in-local-space box, optionally rotated about Y.
   * `faces` may override the layer per face: [+X,-X,+Y,-Y,+Z,-Z].
   */
  addBox(cx, cy, cz, sx, sy, sz, opts = {}) {
    const {
      rotY = 0, layer = 0, faces = null, tint = WHITE, wear = 0.4,
      uvScale = 0.5, collide = false, surface = null, skipFaces = null,
      inset = 0
    } = opts;

    const hx = sx * 0.5 - inset, hy = sy * 0.5 - inset, hz = sz * 0.5 - inset;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const local = (lx, ly, lz, out) => out.set(
      cx + lx * cos + lz * sin,
      cy + ly,
      cz + (-lx * sin + lz * cos)
    );

    // corners
    local(-hx, -hy, -hz, _c[0]); local(hx, -hy, -hz, _c[1]);
    local(hx, hy, -hz, _c[2]); local(-hx, hy, -hz, _c[3]);
    local(-hx, -hy, hz, _c[4]); local(hx, -hy, hz, _c[5]);
    local(hx, hy, hz, _c[6]); local(-hx, hy, hz, _c[7]);

    const faceDefs = [
      [1, 5, 6, 2, 0], // +X
      [4, 0, 3, 7, 1], // -X
      [3, 2, 6, 7, 2], // +Y
      [4, 5, 1, 0, 3], // -Y
      [5, 4, 7, 6, 4], // +Z
      [0, 1, 2, 3, 5]  // -Z
    ];

    for (const [i0, i1, i2, i3, faceIndex] of faceDefs) {
      if (skipFaces && skipFaces.includes(faceIndex)) continue;
      const l = faces ? faces[faceIndex] : layer;
      this.addQuad(_c[i0], _c[i1], _c[i2], _c[i3], {
        layer: l, tint, wear, uvScale, collide, surface
      });
    }
    return this;
  }

  /** Vertical cylinder / tapered post. */
  addCylinder(cx, cy, cz, rBottom, rTop, height, segments, opts = {}) {
    const { layer = 0, tint = WHITE, wear = 0.4, uvScale = 0.5, collide = false, surface = null, caps = true, rotY = 0 } = opts;
    const start = this.vertexCount;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = rotY + t * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const u = t * Math.PI * 2 * ((rBottom + rTop) * 0.5) * uvScale;
      this._pushVertex(cx + ca * rBottom, cy, cz + sa * rBottom, ca, 0, sa, u, cy * uvScale, layer, tint, wear);
      this._pushVertex(cx + ca * rTop, cy + height, cz + sa * rTop, ca, 0, sa, u, (cy + height) * uvScale, layer, tint, wear);
    }
    for (let i = 0; i < segments; i++) {
      const b = start + i * 2;
      this.index.push(b, b + 2, b + 3, b, b + 3, b + 1);
      this.triangleCount += 2;
    }
    if (caps) {
      const capTop = this.vertexCount;
      this._pushVertex(cx, cy + height, cz, 0, 1, 0, cx * uvScale, cz * uvScale, layer, tint, wear);
      for (let i = 0; i <= segments; i++) {
        const a = rotY + (i / segments) * Math.PI * 2;
        const px = cx + Math.cos(a) * rTop, pz = cz + Math.sin(a) * rTop;
        this._pushVertex(px, cy + height, pz, 0, 1, 0, px * uvScale, pz * uvScale, layer, tint, wear);
      }
      for (let i = 0; i < segments; i++) {
        this.index.push(capTop, capTop + 1 + i, capTop + 2 + i);
        this.triangleCount++;
      }
    }
    if (collide && this.soup) {
      // collide with an inscribed box; cylinders here are posts and barrels
      const r = Math.max(rBottom, rTop) * 0.92;
      _v1.set(cx, cy + height * 0.5, cz);
      _v2.set(r * 2, height, r * 2);
      this.soup.addBox(_v1, _v2, null, surface ?? LAYER_SURFACE[layer] ?? 0);
    }
    return this;
  }

  /**
   * Cylinder between two arbitrary points. `addCylinder` only builds along +Y;
   * this is the one to use for barrels, pipes, rails and limbs that lie on an
   * axis of their own.
   */
  addCylinderBetween(from, to, rStart, rEnd, segments, opts = {}) {
    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 1e-6) return this;
    _dir.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_yAxis, _dir);
    _m4.compose(from, _q, _one3);
    this.pushTransform(_m4);
    this.addCylinder(0, 0, 0, rStart, rEnd, len, segments, opts);
    this.popTransform();
    return this;
  }

  /** Sphere-ish blob used for sandbags, rubble lumps and vegetation masses. */
  addBlob(cx, cy, cz, rx, ry, rz, segments, rings, opts = {}) {
    const { layer = 0, tint = WHITE, wear = 0.5, uvScale = 1.0, noise = 0, seedFn = null } = opts;
    const start = this.vertexCount;
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let s = 0; s <= segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        const st = Math.sin(theta), ct = Math.cos(theta);
        let n = 1;
        if (noise > 0) n = 1 + (seedFn ? (seedFn() - 0.5) : 0) * noise;
        const nx = sp * ct, ny = cp, nz = sp * st;
        this._pushVertex(
          cx + nx * rx * n, cy + ny * ry * n, cz + nz * rz * n,
          nx, ny, nz,
          (s / segments) * uvScale * 2, (r / rings) * uvScale,
          layer, tint, wear
        );
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = start + r * (segments + 1) + s;
        const b = a + segments + 1;
        this.index.push(a, b, a + 1, a + 1, b, b + 1);
        this.triangleCount += 2;
      }
    }
    return this;
  }

  /** Arbitrary triangle strip along a path with a rectangular cross-section (cables, pipes, rails). */
  addTube(points, radius, sides, opts = {}) {
    const { layer = 0, tint = WHITE, wear = 0.4, uvScale = 1.0 } = opts;
    if (points.length < 2) return this;
    const start = this.vertexCount;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(i - 1, 0)];
      _dir.subVectors(next, prev).normalize();
      _right.set(0, 1, 0).cross(_dir);
      if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
      _right.normalize();
      _upv.crossVectors(_dir, _right).normalize();
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nx = _right.x * ca + _upv.x * sa;
        const ny = _right.y * ca + _upv.y * sa;
        const nz = _right.z * ca + _upv.z * sa;
        this._pushVertex(
          p.x + nx * radius, p.y + ny * radius, p.z + nz * radius,
          nx, ny, nz, (i / points.length) * uvScale * 8, (s / sides) * uvScale,
          layer, tint, wear
        );
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = start + i * (sides + 1) + s;
        const b = a + sides + 1;
        this.index.push(a, b, a + 1, a + 1, b, b + 1);
        this.triangleCount += 2;
      }
    }
    return this;
  }

  /** Grid mesh for the ground, with a height function for camber and potholes. */
  addGroundGrid(x0, z0, x1, z1, cells, heightFn, opts = {}) {
    const { layer = 0, tint = WHITE, wear = 0.5, uvScale = 0.5, collide = true, surface = null, layerFn = null, tintFn = null } = opts;
    const nx = cells, nz = Math.max(1, Math.round(cells * (z1 - z0) / (x1 - x0)));
    const start = this.vertexCount;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + (x1 - x0) * (i / nx);
        const z = z0 + (z1 - z0) * (j / nz);
        const y = heightFn ? heightFn(x, z) : 0;
        // finite-difference normal
        const e = 0.35;
        const hx = heightFn ? heightFn(x + e, z) - heightFn(x - e, z) : 0;
        const hz = heightFn ? heightFn(x, z + e) - heightFn(x, z - e) : 0;
        _n.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        const l = layerFn ? layerFn(x, z) : layer;
        const t = tintFn ? tintFn(x, z) : tint;
        this._pushVertex(x, y, z, _n.x, _n.y, _n.z, x * uvScale, z * uvScale, l, t, wear);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = start + j * (nx + 1) + i;
        const b = a + nx + 1;
        this.index.push(a, b, a + 1, a + 1, b, b + 1);
        this.triangleCount += 2;
        if (collide && this.soup) {
          const s = surface ?? LAYER_SURFACE[layer] ?? 0;
          const p = this.pos;
          const ai = a * 3, bi = b * 3, ci = (a + 1) * 3, di = (b + 1) * 3;
          this.soup.addTriangle(p[ai], p[ai + 1], p[ai + 2], p[bi], p[bi + 1], p[bi + 2], p[ci], p[ci + 1], p[ci + 2], s);
          this.soup.addTriangle(p[ci], p[ci + 1], p[ci + 2], p[bi], p[bi + 1], p[bi + 2], p[di], p[di + 1], p[di + 2], s);
        }
      }
    }
    return this;
  }

  /** Add a pure collision volume with no visual geometry (invisible walls, roofs). */
  addCollisionBox(cx, cy, cz, sx, sy, sz, surface = 0, rotY = 0) {
    if (!this.soup) return this;
    _v1.set(cx, cy, cz);
    _v2.set(sx, sy, sz);
    _q.setFromAxisAngle(_yAxis, rotY);
    this.soup.addBox(_v1, _v2, _q, surface);
    return this;
  }

  isEmpty() { return this.index.length === 0; }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(this.layer), 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(this.tint), 3));
    geo.setAttribute('aWear', new THREE.BufferAttribute(new Float32Array(this.wear), 1));
    if (this.bone.length === this.vertexCount) {
      geo.setAttribute('aBone', new THREE.BufferAttribute(new Float32Array(this.bone), 1));
    }
    geo.setIndex(new THREE.BufferAttribute(
      this.vertexCount > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index), 1
    ));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    geo.name = this.name;
    return geo;
  }
}

const WHITE = [1, 1, 1];
const _c = Array.from({ length: 8 }, () => new THREE.Vector3());
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _tn = new THREE.Vector3();
const _t0 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _one3 = new THREE.Vector3(1, 1, 1);
