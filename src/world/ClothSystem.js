import * as THREE from 'three';
import { LAYER } from './MaterialLibrary.js';

/**
 * Wind-driven cloth and cables. Awnings, laundry and palm fronds are baked
 * into one dynamic mesh whose vertices are displaced each frame by a layered
 * low-frequency wind field; cables get a catenary plus an almost imperceptible
 * sway. Nothing in the world is frozen.
 */

const AWNING_SEGS = 5;

export class ClothSystem {
  constructor(clothDefs, material) {
    this.pieces = [];
    this.time = 0;
    this.windStrength = 1;
    this.gust = 0;

    const pos = [];
    const nrm = [];
    const uv = [];
    const layer = [];
    const tint = [];
    const wear = [];
    const index = [];

    // per-vertex animation parameters
    const phase = [];
    const weight = [];
    const axis = [];   // dominant sway direction per vertex

    let vCount = 0;

    const pushVert = (x, y, z, nx, ny, nz, u, v, l, t, w, ph, wt, ax, ay, az) => {
      pos.push(x, y, z);
      nrm.push(nx, ny, nz);
      uv.push(u, v);
      layer.push(l);
      tint.push(t[0], t[1], t[2]);
      wear.push(w);
      phase.push(ph);
      weight.push(wt);
      axis.push(ax, ay, az);
      return vCount++;
    };

    for (const def of clothDefs) {
      if (def.type === 'awning') {
        const start = vCount;
        const cos = Math.cos(def.rotY), sin = Math.sin(def.rotY);
        for (let j = 0; j <= AWNING_SEGS; j++) {
          for (let i = 0; i <= AWNING_SEGS; i++) {
            const u = i / AWNING_SEGS - 0.5;
            const v = j / AWNING_SEGS - 0.5;
            const lx = u * def.width;
            const lz = v * def.depth;
            // catenary-ish sag toward the middle
            const sag = -def.sag * (1 - u * u * 4) * (1 - v * v * 4) * 0.9;
            const x = def.center.x + lx * cos + lz * sin;
            const z = def.center.z - lx * sin + lz * cos;
            const y = def.center.y + sag;
            const edge = Math.min(1, Math.min(0.5 - Math.abs(u), 0.5 - Math.abs(v)) * 3.2);
            pushVert(x, y, z, 0, 1, 0, i / AWNING_SEGS * def.width * 0.6, j / AWNING_SEGS * def.depth * 0.6,
              LAYER.FABRIC, def.tint, 0.7, def.phase + i * 0.4 + j * 0.25,
              edge * def.amplitude * 8, 0, 1, 0);
          }
        }
        for (let j = 0; j < AWNING_SEGS; j++) {
          for (let i = 0; i < AWNING_SEGS; i++) {
            const a = start + j * (AWNING_SEGS + 1) + i;
            const b = a + AWNING_SEGS + 1;
            index.push(a, b, a + 1, a + 1, b, b + 1);
            index.push(a + 1, b, a, b + 1, b, a + 1); // back faces so it reads from underneath
          }
        }
        this.pieces.push({ type: 'awning', start, count: vCount - start });
      } else if (def.type === 'laundry') {
        const dir = new THREE.Vector3().subVectors(def.b, def.a);
        const len = dir.length();
        dir.normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        for (let k = 0; k < def.items; k++) {
          const t0 = (k + 0.5) / def.items;
          const w = 0.34 + (k % 3) * 0.12;
          const h = 0.5 + ((k * 7 + 3) % 5) * 0.16;
          const anchor = new THREE.Vector3().copy(def.a).addScaledVector(dir, len * t0);
          anchor.y -= Math.sin(t0 * Math.PI) * 0.22;   // line sag
          const start = vCount;
          const cols = 2, rows = 3;
          for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
              const cu = (c / cols - 0.5) * w;
              const cv = -(r / rows) * h;
              const x = anchor.x + dir.x * cu;
              const y = anchor.y + cv;
              const z = anchor.z + dir.z * cu;
              pushVert(x, y, z, side.x, 0, side.z, c / cols * 0.5, r / rows * 0.6,
                LAYER.FABRIC, def.tint, 0.75,
                def.phase + k * 1.7 + c * 0.3,
                (r / rows) * def.amplitude * 12, side.x, 0.15, side.z);
            }
          }
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const a = start + r * (cols + 1) + c;
              const b = a + cols + 1;
              index.push(a, b, a + 1, a + 1, b, b + 1);
              index.push(a + 1, b, a, b + 1, b, a + 1);
            }
          }
        }
        // the line itself
        const start = vCount;
        const segs = 8;
        for (let i = 0; i <= segs; i++) {
          const t0 = i / segs;
          const p = new THREE.Vector3().copy(def.a).addScaledVector(dir, len * t0);
          p.y -= Math.sin(t0 * Math.PI) * 0.22;
          pushVert(p.x, p.y + 0.012, p.z, 0, 1, 0, t0 * 3, 0, LAYER.METAL_RUST, [0.5, 0.5, 0.5], 0.9, def.phase, 0, 0, 1, 0);
          pushVert(p.x + side.x * 0.014, p.y - 0.012, p.z + side.z * 0.014, 0, 1, 0, t0 * 3, 0.05, LAYER.METAL_RUST, [0.5, 0.5, 0.5], 0.9, def.phase, 0, 0, 1, 0);
        }
        for (let i = 0; i < segs; i++) {
          const a = start + i * 2;
          index.push(a, a + 2, a + 3, a, a + 3, a + 1);
          index.push(a + 3, a + 2, a, a + 1, a + 3, a);
        }
      } else if (def.type === 'palm') {
        for (let f = 0; f < def.fronds; f++) {
          const a = (f / def.fronds) * Math.PI * 2 + def.seed * 6.28;
          const droop = 0.35 + ((f * 13) % 7) / 7 * 0.5;
          const L = def.length * (0.75 + ((f * 5) % 4) / 4 * 0.5);
          const segs = 4;
          const start = vCount;
          const dirX = Math.cos(a), dirZ = Math.sin(a);
          for (let s = 0; s <= segs; s++) {
            const t0 = s / segs;
            const r = t0 * L;
            const y = def.center.y + 0.15 - droop * t0 * t0 * L * 0.55;
            const halfW = (0.16 + 0.10 * Math.sin(t0 * Math.PI)) * (1 - t0 * 0.55);
            const px = def.center.x + dirX * r;
            const pz = def.center.z + dirZ * r;
            const sx = -dirZ, sz = dirX;
            pushVert(px - sx * halfW, y, pz - sz * halfW, 0, 1, 0, t0 * 2, 0, LAYER.FABRIC, def.tint, 0.8,
              def.phase + f * 0.9, t0 * t0 * def.amplitude * 14, sx * 0.4, 1, sz * 0.4);
            pushVert(px + sx * halfW, y, pz + sz * halfW, 0, 1, 0, t0 * 2, 1, LAYER.FABRIC, def.tint, 0.8,
              def.phase + f * 0.9 + 0.2, t0 * t0 * def.amplitude * 14, sx * 0.4, 1, sz * 0.4);
          }
          for (let s = 0; s < segs; s++) {
            const v0 = start + s * 2;
            index.push(v0, v0 + 2, v0 + 3, v0, v0 + 3, v0 + 1);
            index.push(v0 + 3, v0 + 2, v0, v0 + 1, v0 + 3, v0);
          }
        }
      }
    }

    this.count = vCount;
    this.basePos = new Float32Array(pos);
    this.phase = new Float32Array(phase);
    this.weight = new Float32Array(weight);
    this.axis = new Float32Array(axis);

    const geo = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(pos), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.normalAttr = new THREE.BufferAttribute(new Float32Array(nrm), 3);
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positionAttr);
    geo.setAttribute('normal', this.normalAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(layer), 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(tint), 3));
    geo.setAttribute('aWear', new THREE.BufferAttribute(new Float32Array(wear), 1));
    geo.setIndex(new THREE.BufferAttribute(vCount > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
    geo.computeBoundingSphere();
    geo.boundingSphere.radius *= 1.2;

    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'cloth';
    this._localImpulses = [];
  }

  /** Muzzle blasts and nearby explosions push the cloth around. */
  addImpulse(position, strength, radius = 3.5) {
    this._localImpulses.push({ p: position.clone(), s: strength, r: radius, life: 0.55 });
    if (this._localImpulses.length > 8) this._localImpulses.shift();
  }

  update(dt, time) {
    this.time = time;
    const base = this.basePos;
    const out = this.positionAttr.array;
    const ph = this.phase;
    const wt = this.weight;
    const ax = this.axis;

    // layered wind: slow swell + faster ripple + occasional gust
    this.gust = Math.max(0, this.gust - dt * 0.6);
    if (Math.sin(time * 0.19) > 0.985) this.gust = 1.2;
    const swell = 0.55 + 0.45 * Math.sin(time * 0.31);
    const strength = this.windStrength * (swell + this.gust * 0.7);

    for (let i = this._localImpulses.length - 1; i >= 0; i--) {
      this._localImpulses[i].life -= dt;
      if (this._localImpulses[i].life <= 0) this._localImpulses.splice(i, 1);
    }

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const bx = base[i3], by = base[i3 + 1], bz = base[i3 + 2];
      const w = wt[i];
      if (w <= 0.0001) {
        out[i3] = bx; out[i3 + 1] = by; out[i3 + 2] = bz;
        continue;
      }
      const p = ph[i];
      const wave =
        Math.sin(time * 1.35 + p + bx * 0.22 + bz * 0.17) * 0.6 +
        Math.sin(time * 2.7 + p * 1.7 - bz * 0.35) * 0.28 +
        Math.sin(time * 5.1 + p * 0.6 + bx * 0.9) * 0.12;
      const amount = wave * w * strength * 0.035;

      let dx = ax[i3] * amount;
      let dy = ax[i3 + 1] * amount * 0.55;
      let dz = ax[i3 + 2] * amount;

      for (const imp of this._localImpulses) {
        const ddx = bx - imp.p.x, ddy = by - imp.p.y, ddz = bz - imp.p.z;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > imp.r * imp.r) continue;
        const f = (1 - Math.sqrt(d2) / imp.r) * imp.s * imp.life * w * 0.09;
        const inv = 1 / Math.max(Math.sqrt(d2), 0.001);
        dx += ddx * inv * f;
        dy += ddy * inv * f * 0.4;
        dz += ddz * inv * f;
      }

      out[i3] = bx + dx;
      out[i3 + 1] = by + dy;
      out[i3 + 2] = bz + dz;
    }

    this.positionAttr.needsUpdate = true;
    this._refreshNormals();
  }

  /** Recompute normals only for the awning grids, which are the big lit surfaces. */
  _refreshNormals() {
    const pos = this.positionAttr.array;
    const nrm = this.normalAttr.array;
    const stride = AWNING_SEGS + 1;
    for (const piece of this.pieces) {
      if (piece.type !== 'awning') continue;
      for (let j = 0; j <= AWNING_SEGS; j++) {
        for (let i = 0; i <= AWNING_SEGS; i++) {
          const idx = piece.start + j * stride + i;
          const iRight = piece.start + j * stride + Math.min(i + 1, AWNING_SEGS);
          const iLeft = piece.start + j * stride + Math.max(i - 1, 0);
          const iUp = piece.start + Math.min(j + 1, AWNING_SEGS) * stride + i;
          const iDown = piece.start + Math.max(j - 1, 0) * stride + i;
          const ex = pos[iRight * 3] - pos[iLeft * 3];
          const ey = pos[iRight * 3 + 1] - pos[iLeft * 3 + 1];
          const ez = pos[iRight * 3 + 2] - pos[iLeft * 3 + 2];
          const fx = pos[iUp * 3] - pos[iDown * 3];
          const fy = pos[iUp * 3 + 1] - pos[iDown * 3 + 1];
          const fz = pos[iUp * 3 + 2] - pos[iDown * 3 + 2];
          let nx = ey * fz - ez * fy;
          let ny = ez * fx - ex * fz;
          let nz = ex * fy - ey * fx;
          const len = Math.hypot(nx, ny, nz) || 1;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          nrm[idx * 3] = nx / len;
          nrm[idx * 3 + 1] = ny / len;
          nrm[idx * 3 + 2] = nz / len;
        }
      }
    }
    this.normalAttr.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); }
}

const CABLE_SEGS = 10;
const CABLE_SIDES = 3;

export class CableSystem {
  constructor(cableDefs, material) {
    this.defs = cableDefs;
    const pos = [];
    const nrm = [];
    const uv = [];
    const layer = [];
    const tint = [];
    const wear = [];
    const index = [];
    let v = 0;

    for (const def of cableDefs) {
      const start = v;
      for (let i = 0; i <= CABLE_SEGS; i++) {
        for (let s = 0; s < CABLE_SIDES; s++) {
          pos.push(0, 0, 0);
          nrm.push(0, 1, 0);
          uv.push(i * 0.5, s / CABLE_SIDES);
          layer.push(LAYER.POLYMER);
          tint.push(0.35, 0.34, 0.33);
          wear.push(0.9);
          v++;
        }
      }
      for (let i = 0; i < CABLE_SEGS; i++) {
        for (let s = 0; s < CABLE_SIDES; s++) {
          const a = start + i * CABLE_SIDES + s;
          const b = start + i * CABLE_SIDES + ((s + 1) % CABLE_SIDES);
          const c = a + CABLE_SIDES;
          const d = b + CABLE_SIDES;
          index.push(a, c, d, a, d, b);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(new Float32Array(pos), 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.normalAttr = new THREE.BufferAttribute(new Float32Array(nrm), 3);
    this.normalAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positionAttr);
    geo.setAttribute('normal', this.normalAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(layer), 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(tint), 3));
    geo.setAttribute('aWear', new THREE.BufferAttribute(new Float32Array(wear), 1));
    geo.setIndex(new THREE.BufferAttribute(v > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'cables';
    this.update(0, 0);
    geo.computeBoundingSphere();
    geo.boundingSphere.radius *= 1.4;
  }

  update(dt, time) {
    const out = this.positionAttr.array;
    const nrm = this.normalAttr.array;
    let v = 0;
    for (const def of this.defs) {
      const sway = Math.sin(time * 0.62 + def.phase) * def.amplitude
        + Math.sin(time * 1.31 + def.phase * 1.7) * def.amplitude * 0.35;
      for (let i = 0; i <= CABLE_SEGS; i++) {
        const t = i / CABLE_SEGS;
        const catenary = Math.sin(t * Math.PI) * def.sag;
        const flap = Math.sin(t * Math.PI) * sway;
        const px = def.a.x + (def.b.x - def.a.x) * t;
        const py = def.a.y + (def.b.y - def.a.y) * t - catenary + flap * 0.4;
        const pz = def.a.z + (def.b.z - def.a.z) * t + flap;
        for (let s = 0; s < CABLE_SIDES; s++) {
          const a = (s / CABLE_SIDES) * Math.PI * 2;
          const nx = Math.cos(a), ny = Math.sin(a);
          out[v * 3] = px + nx * def.radius;
          out[v * 3 + 1] = py + ny * def.radius;
          out[v * 3 + 2] = pz;
          nrm[v * 3] = nx;
          nrm[v * 3 + 1] = ny;
          nrm[v * 3 + 2] = 0;
          v++;
        }
      }
    }
    this.positionAttr.needsUpdate = true;
    this.normalAttr.needsUpdate = true;
    void dt;
  }

  dispose() { this.geometry.dispose(); }
}
