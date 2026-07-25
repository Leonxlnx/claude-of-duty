import * as THREE from 'three';

/**
 * Binned surface-area-heuristic BVH over a static triangle soup.
 * Flat typed-array layout, zero per-query allocation. This is the single
 * spatial structure used by player movement, bullets, AI line of sight,
 * audio occlusion probing and environment queries.
 */

const BINS = 12;
const LEAF_TRIS = 4;

export const SURFACE = {
  CONCRETE: 0, PLASTER: 1, BRICK: 2, METAL: 3, WOOD: 4,
  GLASS: 5, FABRIC: 6, SAND: 7, DIRT: 8, TILE: 9, RUBBER: 10, SANDBAG: 11
};

export const SURFACE_NAMES = Object.keys(SURFACE);

/** Penetration resistance and thickness class per surface, used by ballistics. */
export const SURFACE_INFO = [
  { name: 'concrete', hardness: 1.0, penetrable: false, ricochet: 0.55, dust: 0xb9b2a4 },
  { name: 'plaster', hardness: 0.45, penetrable: true, ricochet: 0.15, dust: 0xd6cfc0 },
  { name: 'brick', hardness: 0.85, penetrable: false, ricochet: 0.35, dust: 0x9c5f47 },
  { name: 'metal', hardness: 0.95, penetrable: true, ricochet: 0.8, dust: 0xc8ccd2 },
  { name: 'wood', hardness: 0.3, penetrable: true, ricochet: 0.1, dust: 0x9c7c4f },
  { name: 'glass', hardness: 0.2, penetrable: true, ricochet: 0.05, dust: 0xcfe3ea },
  { name: 'fabric', hardness: 0.1, penetrable: true, ricochet: 0.0, dust: 0xa89880 },
  { name: 'sand', hardness: 0.35, penetrable: false, ricochet: 0.05, dust: 0xd8c49a },
  { name: 'dirt', hardness: 0.4, penetrable: false, ricochet: 0.08, dust: 0x8f7756 },
  { name: 'tile', hardness: 0.7, penetrable: false, ricochet: 0.4, dust: 0xcdc9c0 },
  { name: 'rubber', hardness: 0.25, penetrable: true, ricochet: 0.0, dust: 0x3a3a3c },
  { name: 'sandbag', hardness: 0.5, penetrable: false, ricochet: 0.0, dust: 0xb9a882 }
];

export class TriangleSoup {
  constructor(estimatedTris = 4096) {
    this.positions = new Float32Array(estimatedTris * 9);
    this.surfaces = new Uint8Array(estimatedTris);
    this.count = 0;
  }

  _grow(needed) {
    if (needed * 9 <= this.positions.length) return;
    let cap = Math.max(1024, this.positions.length / 9);
    while (cap < needed) cap *= 2;
    const p = new Float32Array(cap * 9);
    p.set(this.positions);
    this.positions = p;
    const s = new Uint8Array(cap);
    s.set(this.surfaces);
    this.surfaces = s;
  }

  addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, surface) {
    this._grow(this.count + 1);
    const o = this.count * 9;
    const p = this.positions;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    this.surfaces[this.count] = surface;
    this.count++;
  }

  /** Append an indexed BufferGeometry transformed by a matrix. */
  addGeometry(geometry, matrix, surface) {
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const n = index ? index.count : pos.count;
    this._grow(this.count + n / 3);
    const v = _v0;
    const e = matrix.elements;
    const arr = pos.array;
    const idx = index ? index.array : null;
    for (let i = 0; i < n; i += 3) {
      const o = this.count * 9;
      const p = this.positions;
      for (let k = 0; k < 3; k++) {
        const vi = (idx ? idx[i + k] : i + k) * 3;
        const x = arr[vi], y = arr[vi + 1], z = arr[vi + 2];
        p[o + k * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        p[o + k * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        p[o + k * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      this.surfaces[this.count] = surface;
      this.count++;
    }
    void v;
  }

  addBox(center, size, quaternion, surface) {
    _m0.compose(center, quaternion || _qIdent, _v1.set(1, 1, 1));
    const hx = size.x * 0.5, hy = size.y * 0.5, hz = size.z * 0.5;
    const c = BOX_CORNERS;
    for (let i = 0; i < 8; i++) {
      _corners[i].set(c[i * 3] * hx, c[i * 3 + 1] * hy, c[i * 3 + 2] * hz).applyMatrix4(_m0);
    }
    for (let f = 0; f < 12; f++) {
      const a = _corners[BOX_TRIS[f * 3]], b = _corners[BOX_TRIS[f * 3 + 1]], cc = _corners[BOX_TRIS[f * 3 + 2]];
      this.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z, surface);
    }
  }
}

const BOX_CORNERS = [
  -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
  -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1
];
const BOX_TRIS = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
  0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
  1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3
];
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _qIdent = new THREE.Quaternion();

export class RayHit {
  constructor() {
    this.hit = false;
    this.t = Infinity;
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.triIndex = -1;
    this.surface = 0;
    this.backface = false;
  }
  reset() { this.hit = false; this.t = Infinity; this.triIndex = -1; this.backface = false; return this; }
}

export class BVH {
  constructor(soup) {
    this.soup = soup;
    const n = soup.count;
    this.triIndices = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.triIndices[i] = i;

    this.centroids = new Float32Array(n * 3);
    this.triBounds = new Float32Array(n * 6);
    const p = soup.positions;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const minx = Math.min(p[o], p[o + 3], p[o + 6]);
      const miny = Math.min(p[o + 1], p[o + 4], p[o + 7]);
      const minz = Math.min(p[o + 2], p[o + 5], p[o + 8]);
      const maxx = Math.max(p[o], p[o + 3], p[o + 6]);
      const maxy = Math.max(p[o + 1], p[o + 4], p[o + 7]);
      const maxz = Math.max(p[o + 2], p[o + 5], p[o + 8]);
      this.triBounds[i * 6] = minx; this.triBounds[i * 6 + 1] = miny; this.triBounds[i * 6 + 2] = minz;
      this.triBounds[i * 6 + 3] = maxx; this.triBounds[i * 6 + 4] = maxy; this.triBounds[i * 6 + 5] = maxz;
      this.centroids[i * 3] = (minx + maxx) * 0.5;
      this.centroids[i * 3 + 1] = (miny + maxy) * 0.5;
      this.centroids[i * 3 + 2] = (minz + maxz) * 0.5;
    }

    const maxNodes = Math.max(4, n * 2);
    this.nodeBounds = new Float32Array(maxNodes * 6);
    this.nodeLeft = new Int32Array(maxNodes);
    this.nodeCount = new Int32Array(maxNodes);
    this.nodesUsed = 1;

    this._binBounds = new Float32Array(BINS * 6);
    this._binCount = new Int32Array(BINS);
    this._leftArea = new Float32Array(BINS);
    this._leftCount = new Int32Array(BINS);

    this.nodeLeft[0] = 0;
    this.nodeCount[0] = n;
    this._updateBounds(0);
    if (n > 0) this._subdivide(0, 0);

    this._stack = new Int32Array(128);
    this.buildStats = { triangles: n, nodes: this.nodesUsed };
  }

  _updateBounds(node) {
    const first = this.nodeLeft[node], count = this.nodeCount[node];
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < count; i++) {
      const t = this.triIndices[first + i] * 6;
      const b = this.triBounds;
      if (b[t] < minx) minx = b[t];
      if (b[t + 1] < miny) miny = b[t + 1];
      if (b[t + 2] < minz) minz = b[t + 2];
      if (b[t + 3] > maxx) maxx = b[t + 3];
      if (b[t + 4] > maxy) maxy = b[t + 4];
      if (b[t + 5] > maxz) maxz = b[t + 5];
    }
    const o = node * 6;
    this.nodeBounds[o] = minx; this.nodeBounds[o + 1] = miny; this.nodeBounds[o + 2] = minz;
    this.nodeBounds[o + 3] = maxx; this.nodeBounds[o + 4] = maxy; this.nodeBounds[o + 5] = maxz;
  }

  _subdivide(node, depth) {
    const count = this.nodeCount[node];
    if (count <= LEAF_TRIS || depth > 48) return;

    const first = this.nodeLeft[node];
    const o = node * 6;
    let bestAxis = -1, bestPos = 0, bestCost = Infinity;

    for (let axis = 0; axis < 3; axis++) {
      let cmin = Infinity, cmax = -Infinity;
      for (let i = 0; i < count; i++) {
        const c = this.centroids[this.triIndices[first + i] * 3 + axis];
        if (c < cmin) cmin = c;
        if (c > cmax) cmax = c;
      }
      if (cmax - cmin < 1e-6) continue;

      this._binCount.fill(0);
      for (let b = 0; b < BINS; b++) {
        const bo = b * 6;
        this._binBounds[bo] = this._binBounds[bo + 1] = this._binBounds[bo + 2] = Infinity;
        this._binBounds[bo + 3] = this._binBounds[bo + 4] = this._binBounds[bo + 5] = -Infinity;
      }
      const scale = BINS / (cmax - cmin);
      for (let i = 0; i < count; i++) {
        const ti = this.triIndices[first + i];
        let b = Math.floor((this.centroids[ti * 3 + axis] - cmin) * scale);
        if (b >= BINS) b = BINS - 1; if (b < 0) b = 0;
        this._binCount[b]++;
        const bo = b * 6, to = ti * 6, tb = this.triBounds, bb = this._binBounds;
        if (tb[to] < bb[bo]) bb[bo] = tb[to];
        if (tb[to + 1] < bb[bo + 1]) bb[bo + 1] = tb[to + 1];
        if (tb[to + 2] < bb[bo + 2]) bb[bo + 2] = tb[to + 2];
        if (tb[to + 3] > bb[bo + 3]) bb[bo + 3] = tb[to + 3];
        if (tb[to + 4] > bb[bo + 4]) bb[bo + 4] = tb[to + 4];
        if (tb[to + 5] > bb[bo + 5]) bb[bo + 5] = tb[to + 5];
      }

      // sweep left
      let lminx = Infinity, lminy = Infinity, lminz = Infinity;
      let lmaxx = -Infinity, lmaxy = -Infinity, lmaxz = -Infinity, lsum = 0;
      for (let b = 0; b < BINS - 1; b++) {
        const bo = b * 6, bb = this._binBounds;
        if (this._binCount[b] > 0) {
          if (bb[bo] < lminx) lminx = bb[bo];
          if (bb[bo + 1] < lminy) lminy = bb[bo + 1];
          if (bb[bo + 2] < lminz) lminz = bb[bo + 2];
          if (bb[bo + 3] > lmaxx) lmaxx = bb[bo + 3];
          if (bb[bo + 4] > lmaxy) lmaxy = bb[bo + 4];
          if (bb[bo + 5] > lmaxz) lmaxz = bb[bo + 5];
        }
        lsum += this._binCount[b];
        this._leftCount[b] = lsum;
        this._leftArea[b] = lsum > 0 ? surfaceArea(lminx, lminy, lminz, lmaxx, lmaxy, lmaxz) : 0;
      }

      let rminx = Infinity, rminy = Infinity, rminz = Infinity;
      let rmaxx = -Infinity, rmaxy = -Infinity, rmaxz = -Infinity, rsum = 0;
      for (let b = BINS - 1; b >= 1; b--) {
        const bo = b * 6, bb = this._binBounds;
        if (this._binCount[b] > 0) {
          if (bb[bo] < rminx) rminx = bb[bo];
          if (bb[bo + 1] < rminy) rminy = bb[bo + 1];
          if (bb[bo + 2] < rminz) rminz = bb[bo + 2];
          if (bb[bo + 3] > rmaxx) rmaxx = bb[bo + 3];
          if (bb[bo + 4] > rmaxy) rmaxy = bb[bo + 4];
          if (bb[bo + 5] > rmaxz) rmaxz = bb[bo + 5];
        }
        rsum += this._binCount[b];
        const rArea = rsum > 0 ? surfaceArea(rminx, rminy, rminz, rmaxx, rmaxy, rmaxz) : 0;
        const cost = this._leftCount[b - 1] * this._leftArea[b - 1] + rsum * rArea;
        if (cost > 0 && cost < bestCost && this._leftCount[b - 1] > 0) {
          bestCost = cost;
          bestAxis = axis;
          bestPos = cmin + (cmax - cmin) * (b / BINS);
        }
      }
    }

    if (bestAxis < 0) return;
    const parentArea = surfaceArea(
      this.nodeBounds[o], this.nodeBounds[o + 1], this.nodeBounds[o + 2],
      this.nodeBounds[o + 3], this.nodeBounds[o + 4], this.nodeBounds[o + 5]
    );
    if (bestCost >= parentArea * count) return;

    // in-place partition
    let i = first, j = first + count - 1;
    while (i <= j) {
      if (this.centroids[this.triIndices[i] * 3 + bestAxis] < bestPos) i++;
      else {
        const tmp = this.triIndices[i];
        this.triIndices[i] = this.triIndices[j];
        this.triIndices[j] = tmp;
        j--;
      }
    }
    const leftCount = i - first;
    if (leftCount === 0 || leftCount === count) return;

    const leftChild = this.nodesUsed++;
    const rightChild = this.nodesUsed++;
    this.nodeLeft[leftChild] = first;
    this.nodeCount[leftChild] = leftCount;
    this.nodeLeft[rightChild] = i;
    this.nodeCount[rightChild] = count - leftCount;
    this.nodeLeft[node] = leftChild;
    this.nodeCount[node] = 0;

    this._updateBounds(leftChild);
    this._updateBounds(rightChild);
    this._subdivide(leftChild, depth + 1);
    this._subdivide(rightChild, depth + 1);
  }

  /**
   * Closest-hit ray query. `out` is a reusable RayHit.
   * @returns {RayHit}
   */
  raycast(origin, dir, maxDist, out = _sharedHit, skipBackface = false) {
    out.reset();
    out.t = maxDist;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    const idx = 1 / (dx || 1e-20), idy = 1 / (dy || 1e-20), idz = 1 / (dz || 1e-20);

    const stack = this._stack;
    let sp = 0;
    stack[sp++] = 0;
    const nb = this.nodeBounds, p = this.soup.positions;
    let found = false;

    while (sp > 0) {
      const node = stack[--sp];
      const o = node * 6;
      // slab test
      let t0 = (nb[o] - ox) * idx, t1 = (nb[o + 3] - ox) * idx;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (nb[o + 1] - oy) * idy; t1 = (nb[o + 4] - oy) * idy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (nb[o + 2] - oz) * idz; t1 = (nb[o + 5] - oz) * idz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax < Math.max(tmin, 0) || tmin > out.t) continue;

      const count = this.nodeCount[node];
      if (count === 0) {
        const l = this.nodeLeft[node];
        stack[sp++] = l;
        stack[sp++] = l + 1;
        continue;
      }
      const first = this.nodeLeft[node];
      for (let i = 0; i < count; i++) {
        const tri = this.triIndices[first + i];
        const b = tri * 9;
        const ax = p[b], ay = p[b + 1], az = p[b + 2];
        const e1x = p[b + 3] - ax, e1y = p[b + 4] - ay, e1z = p[b + 5] - az;
        const e2x = p[b + 6] - ax, e2y = p[b + 7] - ay, e2z = p[b + 8] - az;
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-9 && det < 1e-9) continue;
        if (skipBackface && det < 0) continue;
        const invDet = 1 / det;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * invDet;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (t > 1e-5 && t < out.t) {
          out.t = t;
          out.triIndex = tri;
          out.backface = det < 0;
          found = true;
        }
      }
    }

    if (found) {
      out.hit = true;
      out.point.set(ox + dx * out.t, oy + dy * out.t, oz + dz * out.t);
      this.triangleNormal(out.triIndex, out.normal);
      if (out.normal.x * dx + out.normal.y * dy + out.normal.z * dz > 0) out.normal.multiplyScalar(-1);
      out.surface = this.soup.surfaces[out.triIndex];
    }
    return out;
  }

  /** Fast boolean occlusion test between two points. */
  occluded(a, b, margin = 0.02) {
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 1e-5) return false;
    _dir.multiplyScalar(1 / len);
    const h = this.raycast(a, _dir, len - margin, _occHit);
    return h.hit;
  }

  triangleNormal(tri, out) {
    const p = this.soup.positions, b = tri * 9;
    const e1x = p[b + 3] - p[b], e1y = p[b + 4] - p[b + 1], e1z = p[b + 5] - p[b + 2];
    const e2x = p[b + 6] - p[b], e2y = p[b + 7] - p[b + 1], e2z = p[b + 8] - p[b + 2];
    out.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
    return out;
  }

  /** Visit every triangle whose AABB overlaps the query box. */
  overlapBox(minx, miny, minz, maxx, maxy, maxz, visit) {
    const stack = this._stack;
    let sp = 0;
    stack[sp++] = 0;
    const nb = this.nodeBounds;
    while (sp > 0) {
      const node = stack[--sp];
      const o = node * 6;
      if (nb[o] > maxx || nb[o + 3] < minx || nb[o + 1] > maxy || nb[o + 4] < miny || nb[o + 2] > maxz || nb[o + 5] < minz) continue;
      const count = this.nodeCount[node];
      if (count === 0) {
        const l = this.nodeLeft[node];
        stack[sp++] = l; stack[sp++] = l + 1;
        continue;
      }
      const first = this.nodeLeft[node];
      for (let i = 0; i < count; i++) visit(this.triIndices[first + i]);
    }
  }

  get bounds() {
    return {
      min: new THREE.Vector3(this.nodeBounds[0], this.nodeBounds[1], this.nodeBounds[2]),
      max: new THREE.Vector3(this.nodeBounds[3], this.nodeBounds[4], this.nodeBounds[5])
    };
  }
}

function surfaceArea(minx, miny, minz, maxx, maxy, maxz) {
  const ex = maxx - minx, ey = maxy - miny, ez = maxz - minz;
  if (ex < 0 || ey < 0 || ez < 0) return 0;
  return 2 * (ex * ey + ey * ez + ez * ex);
}

/** Closest point on triangle `tri` to point p. Writes into `out`. */
export function closestPointOnTriangleSoup(soup, tri, px, py, pz, out) {
  const p = soup.positions, b = tri * 9;
  const ax = p[b], ay = p[b + 1], az = p[b + 2];
  const bx = p[b + 3], by = p[b + 4], bz = p[b + 5];
  const cx = p[b + 6], cy = p[b + 7], cz = p[b + 8];

  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out.set(ax, ay, az); return out; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out.set(bx, by, bz); return out; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.set(ax + abx * v, ay + aby * v, az + abz * v);
    return out;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out.set(cx, cy, cz); return out; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.set(ax + acx * w, ay + acy * w, az + acz * w);
    return out;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.set(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w);
    return out;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out.set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
  return out;
}

/** Closest point on segment AB to point P. */
export function closestPointOnSegment(ax, ay, az, bx, by, bz, px, py, pz, out) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.set(ax + dx * t, ay + dy * t, az + dz * t);
  return t;
}

const _sharedHit = new RayHit();
const _occHit = new RayHit();
const _dir = new THREE.Vector3();
