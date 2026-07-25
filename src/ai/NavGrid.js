import * as THREE from 'three';
import { RayHit, closestPointOnTriangleSoup } from '../physics/BVH.js';

/**
 * Walkability grid baked from the collision world, plus A* and a cover map.
 *
 * A grid beats a hand-authored navmesh here because the map is procedural: the
 * same code that generated the street generated the obstacles, and sampling the
 * BVH afterwards is the only way to be certain the two agree.
 */

const CELL = 0.75;
const AGENT_HEIGHT = 1.75;
const AGENT_RADIUS = 0.34;
const MAX_STEP = 0.42;
const MAX_SLOPE_COS = Math.cos(50 * Math.PI / 180);
const PROBE_HEIGHT = 2.45;     // just under a ground-floor ceiling
const MAX_GROUND_Y = 2.20;     // anything higher is a roof, balcony or awning
const MAX_LEG = 8;             // longest straight run between path waypoints

export class NavGrid {
  constructor(bvh, bounds) {
    this.bvh = bvh;
    this.min = new THREE.Vector2(bounds.min.x, bounds.min.z);
    this.max = new THREE.Vector2(bounds.max.x, bounds.max.z);
    this.cell = CELL;
    this.w = Math.ceil((this.max.x - this.min.x) / CELL);
    this.h = Math.ceil((this.max.y - this.min.y) / CELL);
    const n = this.w * this.h;

    this.walkable = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.clearance = new Float32Array(n);   // distance to the nearest blocked cell
    this.cover = new Uint8Array(n);         // 8-direction bitmask of blocked sight
    this.coverQuality = new Float32Array(n);
    this.indoor = new Uint8Array(n);

    // A* scratch, reused between queries so pathing allocates nothing.
    this._g = new Float32Array(n);
    this._f = new Float32Array(n);
    this._from = new Int32Array(n);
    this._state = new Uint8Array(n);
    this._stamp = new Uint16Array(n);
    this._generation = 0;
    this._open = new BinaryHeap(n);
  }

  index(ix, iz) { return iz * this.w + ix; }
  inBounds(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h; }
  cellX(x) { return Math.floor((x - this.min.x) / this.cell); }
  cellZ(z) { return Math.floor((z - this.min.y) / this.cell); }
  worldX(ix) { return this.min.x + (ix + 0.5) * this.cell; }
  worldZ(iz) { return this.min.y + (iz + 0.5) * this.cell; }

  bake() {
    const hit = new RayHit();
    const origin = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);

    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const i = this.index(ix, iz);
        const x = this.worldX(ix), z = this.worldZ(iz);

        // Probe from just above head height, not from above the skyline: a ray
        // dropped from the clouds lands on every roof and parapet in the city
        // and bakes a nav layer nobody can reach.
        origin.set(x, PROBE_HEIGHT, z);
        const h = this.bvh.raycast(origin, down, PROBE_HEIGHT + 40, hit);
        if (!h.hit) continue;
        if (hit.normal.y < MAX_SLOPE_COS) continue;      // wall, not floor
        if (hit.point.y > MAX_GROUND_Y) continue;        // a roof or a balcony

        const groundY = hit.point.y;
        this.height[i] = groundY;

        // headroom check: an agent needs a clear column to stand in
        origin.set(x, groundY + 0.12, z);
        const up = this.bvh.raycast(origin, UP, AGENT_HEIGHT, hit);
        if (up.hit) {
          if (hit.t < 1.1) continue;
          this.indoor[i] = 1;
        }

        // A downward ray passes straight through a wall it never touches, so
        // rooms full of standing geometry read as open floor. Test the volume
        // the agent would actually occupy.
        if (this._blocked(x, groundY, z)) continue;

        this.walkable[i] = 1;
      }
    }

    this._computeClearance();
    this._keepLargestRegion();
    this._computeCover();
    return this;
  }

  /**
   * Does the agent's standing volume intersect the world at this spot?
   * Three spheres along the spine approximate the capsule closely enough at
   * this cell size, and cost a third of a swept test.
   */
  _blocked(x, groundY, z) {
    const r = AGENT_RADIUS;
    const lo = groundY + MAX_STEP + r;      // above anything they can step over
    const hi = groundY + AGENT_HEIGHT - r;
    if (hi <= lo) return false;
    const mid = (lo + hi) * 0.5;
    const r2 = r * r;
    const soup = this.bvh.soup;
    let blocked = false;

    this.bvh.overlapBox(x - r, lo - r, z - r, x + r, hi + r, z + r, (tri) => {
      if (blocked) return;
      for (let s = 0; s < 3; s++) {
        const y = s === 0 ? lo : s === 1 ? mid : hi;
        closestPointOnTriangleSoup(soup, tri, x, y, z, _cp);
        const dx = _cp.x - x, dy = _cp.y - y, dz = _cp.z - z;
        if (dx * dx + dy * dy + dz * dz < r2) { blocked = true; return; }
      }
    });
    return blocked;
  }

  /**
   * Drop every pocket that is not part of the main walkable region. Without
   * this an agent can spawn on an isolated island and spend the match failing
   * to path anywhere, and `findPath` burns its whole budget proving it.
   */
  _keepLargestRegion() {
    const n = this.walkable.length;
    const region = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    const sizes = [];

    for (let seed = 0; seed < n; seed++) {
      if (!this.walkable[seed] || region[seed] >= 0) continue;
      const id = sizes.length;
      let head = 0, tail = 0, size = 0;
      queue[tail++] = seed;
      region[seed] = id;
      while (head < tail) {
        const cur = queue[head++];
        size++;
        const cx = cur % this.w, cz = (cur / this.w) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + NX[d], nz = cz + NZ[d];
          if (!this.inBounds(nx, nz)) continue;
          const ni = this.index(nx, nz);
          if (!this.walkable[ni] || region[ni] >= 0) continue;
          if (Math.abs(this.height[ni] - this.height[cur]) > MAX_STEP) continue;
          region[ni] = id;
          queue[tail++] = ni;
        }
      }
      sizes.push(size);
    }

    let best = -1, bestSize = 0;
    for (let i = 0; i < sizes.length; i++) if (sizes[i] > bestSize) { bestSize = sizes[i]; best = i; }
    if (best < 0) return;
    for (let i = 0; i < n; i++) if (this.walkable[i] && region[i] !== best) this.walkable[i] = 0;
    this.regionSize = bestSize;
  }

  /**
   * Chebyshev-ish distance transform: two sweeps give a close enough estimate
   * of how far each cell is from an obstacle, which is what keeps agents from
   * hugging walls when they path.
   */
  _computeClearance() {
    const { w, h, clearance, walkable } = this;
    const BIG = 1e4;
    for (let i = 0; i < clearance.length; i++) clearance[i] = walkable[i] ? BIG : 0;

    for (let iz = 0; iz < h; iz++) {
      for (let ix = 0; ix < w; ix++) {
        const i = this.index(ix, iz);
        if (!walkable[i]) continue;
        let best = clearance[i];
        if (ix > 0) best = Math.min(best, clearance[i - 1] + 1);
        if (iz > 0) best = Math.min(best, clearance[i - w] + 1);
        if (ix > 0 && iz > 0) best = Math.min(best, clearance[i - w - 1] + 1.41);
        if (ix < w - 1 && iz > 0) best = Math.min(best, clearance[i - w + 1] + 1.41);
        clearance[i] = best;
      }
    }
    for (let iz = h - 1; iz >= 0; iz--) {
      for (let ix = w - 1; ix >= 0; ix--) {
        const i = this.index(ix, iz);
        if (!walkable[i]) continue;
        let best = clearance[i];
        if (ix < w - 1) best = Math.min(best, clearance[i + 1] + 1);
        if (iz < h - 1) best = Math.min(best, clearance[i + w] + 1);
        if (ix < w - 1 && iz < h - 1) best = Math.min(best, clearance[i + w + 1] + 1.41);
        if (ix > 0 && iz < h - 1) best = Math.min(best, clearance[i + w - 1] + 1.41);
        clearance[i] = best;
      }
    }
    for (let i = 0; i < clearance.length; i++) clearance[i] *= this.cell;
    // Cells too tight for the agent capsule are not usable at all.
    for (let i = 0; i < clearance.length; i++) {
      if (walkable[i] && clearance[i] < AGENT_RADIUS * 0.8) walkable[i] = 0;
    }
  }

  /**
   * For each walkable cell, probe eight directions at chest and crouch height.
   * A cell is good cover when it blocks a wide arc at chest height but still
   * lets the agent shoot from at least one side.
   */
  _computeCover() {
    const hit = new RayHit();
    const from = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const PROBE = 1.5;

    for (let iz = 0; iz < this.h; iz++) {
      for (let ix = 0; ix < this.w; ix++) {
        const i = this.index(ix, iz);
        if (!this.walkable[i]) continue;
        let mask = 0, blockedChest = 0, blockedCrouch = 0;
        for (let d = 0; d < 8; d++) {
          const a = (d / 8) * Math.PI * 2;
          dir.set(Math.cos(a), 0, Math.sin(a));
          from.set(this.worldX(ix), this.height[i] + 1.35, this.worldZ(iz));
          const chest = this.bvh.raycast(from, dir, PROBE, hit).hit;
          from.y = this.height[i] + 0.65;
          const crouch = this.bvh.raycast(from, dir, PROBE, hit).hit;
          if (chest) { mask |= (1 << d); blockedChest++; }
          if (crouch) blockedCrouch++;
        }
        this.cover[i] = mask;
        // The sweet spot is a low wall: blocked when crouched, open standing.
        // A cell walled in on every side is a dead end, not a firing position.
        const lowWall = Math.max(0, blockedCrouch - blockedChest) / 8;
        const hardCover = blockedChest / 8;
        this.coverQuality[i] = hardCover > 0.8 ? 0 : hardCover * 0.9 + lowWall * 1.3;
      }
    }
  }

  isWalkableAt(x, z) {
    const ix = this.cellX(x), iz = this.cellZ(z);
    return this.inBounds(ix, iz) && this.walkable[this.index(ix, iz)] === 1;
  }

  heightAt(x, z) {
    const ix = this.cellX(x), iz = this.cellZ(z);
    if (!this.inBounds(ix, iz)) return 0;
    return this.height[this.index(ix, iz)];
  }

  /** Nearest walkable cell index, searched in expanding rings. */
  nearestCell(x, z, maxRadius = 12) {
    const cx = this.cellX(x), cz = this.cellZ(z);
    if (this.inBounds(cx, cz) && this.walkable[this.index(cx, cz)]) return this.index(cx, cz);
    for (let r = 1; r <= maxRadius; r++) {
      for (let d = -r; d <= r; d++) {
        const candidates = [
          [cx + d, cz - r], [cx + d, cz + r], [cx - r, cz + d], [cx + r, cz + d]
        ];
        for (const [ix, iz] of candidates) {
          if (this.inBounds(ix, iz) && this.walkable[this.index(ix, iz)]) return this.index(ix, iz);
        }
      }
    }
    return -1;
  }

  /**
   * A* with a clearance penalty. Returns an array of world-space waypoints, or
   * null when there is no route. `out` is reused by the caller.
   */
  findPath(sx, sz, tx, tz, out = []) {
    const start = this.nearestCell(sx, sz);
    const goal = this.nearestCell(tx, tz);
    out.length = 0;
    if (start < 0 || goal < 0) return null;
    if (start === goal) {
      out.push(new THREE.Vector3(tx, this.height[goal], tz));
      return out;
    }

    const { w, _g, _f, _from, _state, _stamp } = this;
    // Stamps live in a Uint16Array, so the generation counter has to wrap with
    // them; 0 is skipped because that is the cleared state.
    this._generation = (this._generation + 1) & 0xffff;
    if (this._generation === 0) { _stamp.fill(0); this._generation = 1; }
    const gen = this._generation;
    const heap = this._open;
    heap.clear();

    const gx = goal % w, gz = (goal / w) | 0;
    const heuristic = (i) => {
      const ix = i % w, iz = (i / w) | 0;
      const dx = Math.abs(ix - gx), dz = Math.abs(iz - gz);
      // octile distance, admissible for 8-connected grids
      return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
    };

    _stamp[start] = gen; _g[start] = 0; _f[start] = heuristic(start); _from[start] = -1; _state[start] = 1;
    heap.push(start, _f[start]);

    let found = false;
    let expansions = 0;
    // Wide open streets make A* fan out, and a corner-to-corner route on this
    // map touches a large fraction of the grid before it commits.
    const budget = Math.min(this.walkable.length, 60000);

    while (heap.size > 0 && expansions++ < budget) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (_stamp[cur] !== gen || _state[cur] === 2) continue;
      _state[cur] = 2;

      const cx = cur % w, cz = (cur / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + NX[d], nz = cz + NZ[d];
        if (!this.inBounds(nx, nz)) continue;
        const ni = this.index(nx, nz);
        if (!this.walkable[ni]) continue;
        if (_stamp[ni] === gen && _state[ni] === 2) continue;

        // Diagonals may not cut a corner between two blocked cells.
        if (d >= 4) {
          if (!this.walkable[this.index(cx + NX[d], cz)] || !this.walkable[this.index(cx, cz + NZ[d])]) continue;
        }
        // Steps taller than a kerb are not traversable.
        const dh = this.height[ni] - this.height[cur];
        if (Math.abs(dh) > MAX_STEP) continue;

        const step = (d >= 4 ? 1.4142 : 1) * (1 + Math.abs(dh) * 1.2);
        const tight = Math.max(0, 1.2 - this.clearance[ni]) * 1.8;
        const tentative = _g[cur] + step + tight;

        if (_stamp[ni] !== gen) {
          _stamp[ni] = gen; _state[ni] = 0; _g[ni] = Infinity;
        }
        if (tentative < _g[ni]) {
          _g[ni] = tentative;
          _from[ni] = cur;
          _f[ni] = tentative + heuristic(ni) * 1.06;   // slight overestimate: faster, near-optimal
          _state[ni] = 1;
          heap.push(ni, _f[ni]);
        }
      }
    }

    if (!found) return null;

    // Walk the parents back, then smooth with a line-of-walk test.
    _raw.length = 0;
    for (let i = goal; i !== -1; i = _from[i]) _raw.push(i);
    _raw.reverse();

    const corners = _corners;
    corners.length = 0;
    let anchor = 0;
    corners.push(_raw[0]);
    for (let i = 2; i < _raw.length; i++) {
      if (!this._walkLine(_raw[anchor], _raw[i])) {
        anchor = i - 1;
        corners.push(_raw[anchor]);
      }
    }

    // String-pulling across an open street leaves a single 60 m leg. Agents
    // steer toward the next point, so a leg that long stops them reacting to
    // anything until they arrive — split it into strides they can re-plan on.
    const push = (x, y, z) => {
      const prev = out[out.length - 1];
      if (prev) {
        const dist = Math.hypot(x - prev.x, z - prev.z);
        const steps = Math.ceil(dist / MAX_LEG);
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          out.push(new THREE.Vector3(
            prev.x + (x - prev.x) * t,
            prev.y + (y - prev.y) * t,
            prev.z + (z - prev.z) * t
          ));
        }
      }
      out.push(new THREE.Vector3(x, y, z));
    };

    for (const ci of corners) push(this.worldX(ci % w), this.height[ci], this.worldZ((ci / w) | 0));
    push(tx, this.height[goal], tz);
    return out;
  }

  /** Bresenham-style walkability test between two cells, for path smoothing. */
  _walkLine(a, b) {
    const w = this.w;
    let x0 = a % w, z0 = (a / w) | 0;
    const x1 = b % w, z1 = (b / w) | 0;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let prevH = this.height[a];
    let guard = 0;
    while (guard++ < 512) {
      const i = this.index(x0, z0);
      if (!this.walkable[i] || this.clearance[i] < 0.5) return false;
      if (Math.abs(this.height[i] - prevH) > MAX_STEP) return false;
      prevH = this.height[i];
      if (x0 === x1 && z0 === z1) return true;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
    return false;
  }

  /**
   * Best cover cell near `origin` that breaks line of sight to `threat` while
   * staying within `radius`. Sampled rather than exhaustive: an agent that
   * takes 0.2 ms to pick decent cover beats one that takes 4 ms to pick perfect
   * cover.
   */
  findCover(origin, threat, radius, rng, out) {
    const cx = this.cellX(origin.x), cz = this.cellZ(origin.z);
    const r = Math.ceil(radius / this.cell);
    let best = -1, bestScore = -Infinity;
    const samples = Math.min(90, (2 * r + 1) * (2 * r + 1));
    const hit = new RayHit();

    for (let s = 0; s < samples; s++) {
      const ix = cx + Math.round((rng.next() * 2 - 1) * r);
      const iz = cz + Math.round((rng.next() * 2 - 1) * r);
      if (!this.inBounds(ix, iz)) continue;
      const i = this.index(ix, iz);
      if (!this.walkable[i] || this.coverQuality[i] < 0.15) continue;

      const wx = this.worldX(ix), wz = this.worldZ(iz);
      _a.set(wx, this.height[i] + 1.35, wz);
      _b.subVectors(threat, _a);
      const dist = _b.length();
      if (dist < 3) continue;
      _b.multiplyScalar(1 / dist);
      const exposed = !this.bvh.raycast(_a, _b, dist - 0.4, hit).hit;
      if (exposed) continue;

      // Prefer cover that is close, high quality, and not backwards from the fight.
      const travel = Math.hypot(wx - origin.x, wz - origin.z);
      const score = this.coverQuality[i] * 3
        - travel * 0.22
        - Math.max(0, 18 - dist) * 0.08
        + this.clearance[i] * 0.15;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return null;
    return out.set(this.worldX(best % this.w), this.height[best], this.worldZ((best / this.w) | 0));
  }

  /** Random walkable point at least `minDist` from `avoid`. */
  randomPoint(rng, out, avoid = null, minDist = 0) {
    for (let attempt = 0; attempt < 64; attempt++) {
      const ix = (rng.next() * this.w) | 0;
      const iz = (rng.next() * this.h) | 0;
      const i = this.index(ix, iz);
      if (!this.walkable[i] || this.clearance[i] < 0.8) continue;
      const x = this.worldX(ix), z = this.worldZ(iz);
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < minDist) continue;
      return out.set(x, this.height[i], z);
    }
    return null;
  }

  stats() {
    let walk = 0, cover = 0;
    for (let i = 0; i < this.walkable.length; i++) {
      if (this.walkable[i]) walk++;
      if (this.coverQuality[i] > 0.3) cover++;
    }
    return {
      cells: this.walkable.length, walkable: walk, cover,
      w: this.w, h: this.h, region: this.regionSize ?? 0
    };
  }
}

/** Binary min-heap keyed on f-score. */
class BinaryHeap {
  constructor(capacity) {
    this.items = new Int32Array(capacity + 1);
    this.keys = new Float32Array(capacity + 1);
    this.size = 0;
    this.capacity = capacity;
  }
  clear() { this.size = 0; }
  push(item, key) {
    if (this.size >= this.capacity) return;
    let i = this.size++;
    this.items[i] = item; this.keys[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this._swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.items[0];
    this.size--;
    if (this.size > 0) {
      this.items[0] = this.items[this.size];
      this.keys[0] = this.keys[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.keys[l] < this.keys[m]) m = l;
        if (r < this.size && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this._swap(i, m); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
  }
}

const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];
const UP = new THREE.Vector3(0, 1, 0);
const _cp = new THREE.Vector3();
const _raw = [];
const _corners = [];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
