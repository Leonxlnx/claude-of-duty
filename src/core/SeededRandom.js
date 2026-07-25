// Deterministic RNG used by every gameplay- and world-critical system.
// Math.random() is never used outside of purely cosmetic, non-reproducible paths.

export class SeededRandom {
  constructor(seed = 1337) {
    this.reseed(seed);
  }

  reseed(seed) {
    this._s0 = (seed >>> 0) || 1;
    this._s1 = (seed * 1103515245 + 12345) >>> 0 || 2;
    this._s2 = (seed ^ 0x9e3779b9) >>> 0 || 3;
    this._s3 = (seed * 2654435761) >>> 0 || 4;
    for (let i = 0; i < 12; i++) this.next();
    return this;
  }

  // xoshiro128**
  next() {
    const r = Math.imul(this._s1 * 5, 1) >>> 0;
    const result = ((((r << 7) | (r >>> 25)) >>> 0) * 9) >>> 0;
    const t = (this._s1 << 9) >>> 0;
    this._s2 ^= this._s0;
    this._s3 ^= this._s1;
    this._s1 ^= this._s2;
    this._s0 ^= this._s3;
    this._s2 ^= t;
    this._s3 = ((this._s3 << 11) | (this._s3 >>> 21)) >>> 0;
    return result / 4294967296;
  }

  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1 - 1e-9)); }
  bool(p = 0.5) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  pick(arr) { return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]; }

  /** Gaussian via Box-Muller, cached second sample. */
  gauss(mean = 0, sd = 1) {
    if (this._spare !== undefined) {
      const v = this._spare; this._spare = undefined;
      return mean + sd * v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    this._spare = v * m;
    return mean + sd * u * m;
  }

  onUnitSphere(out) {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.set(r * Math.cos(a), r * Math.sin(a), z);
    return out;
  }

  /** Independent child stream, keeps subsystems from perturbing each other. */
  fork(salt) {
    return new SeededRandom((Math.floor(this.next() * 0xffffffff) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0);
  }
}

/** Cheap integer hash → [0,1), for stateless per-index variation. */
export function hash1(n) {
  let x = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2545f491);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export function hash2(x, y) {
  return hash1((Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0);
}

export const WORLD_SEED = 0x5eed1a7;
