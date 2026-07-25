import * as THREE from 'three';
import { LAYER } from './MaterialLibrary.js';
import { SURFACE } from '../physics/BVH.js';

/**
 * Street furniture and clutter. Every generator takes the seeded RNG so
 * rotation, scale, wear, tint and sub-part composition vary per instance —
 * no visible repeated prop rows anywhere on the map.
 */

const WOOD_TINTS = [[0.85, 0.78, 0.66], [0.72, 0.62, 0.48], [0.95, 0.88, 0.74], [0.62, 0.55, 0.45]];
const FABRIC_TINTS = [
  [1.0, 0.95, 0.85], [0.85, 0.72, 0.58], [0.62, 0.78, 0.80],
  [0.92, 0.66, 0.52], [0.72, 0.80, 0.68], [0.88, 0.85, 0.78]
];
const BARREL_TINTS = [[0.35, 0.45, 0.52], [0.62, 0.35, 0.24], [0.55, 0.56, 0.52], [0.42, 0.52, 0.40]];

/** Concrete Jersey barrier with a tapered profile. */
export function jerseyBarrier(b, x, y, z, rotY, rng, len = 2.4) {
  const tint = [0.92 + rng.range(-0.06, 0.06), 0.90, 0.87];
  const wear = rng.range(0.5, 0.95);
  const o = { rotY, layer: LAYER.CONCRETE, tint, wear, uvScale: 0.55 };
  b.addBox(x, y + 0.16, z, len, 0.32, 0.62, { ...o, collide: true, surface: SURFACE.CONCRETE });
  b.addBox(x, y + 0.52, z, len, 0.42, 0.40, { ...o, collide: true, surface: SURFACE.CONCRETE });
  b.addBox(x, y + 0.86, z, len, 0.28, 0.28, { ...o, collide: true, surface: SURFACE.CONCRETE });
  // chipped corner + lift hook
  if (rng.bool(0.5)) {
    b.addBox(x + Math.cos(rotY) * len * 0.42, y + 1.0, z - Math.sin(rotY) * len * 0.42, 0.1, 0.1, 0.1, {
      rotY: rng.range(0, 3.14), layer: LAYER.METAL_RUST, tint: [0.7, 0.68, 0.64], wear: 0.9, uvScale: 3
    });
  }
  return { x, z, height: 1.0, cover: 'low' };
}

/** Stacked sandbag position. */
export function sandbagWall(b, x, y, z, rotY, rng, length = 2.2, rows = 3) {
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const bagW = 0.46, bagH = 0.24, bagD = 0.32;
  const perRow = Math.max(2, Math.round(length / bagW));
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * bagW * 0.5;
    const count = perRow - (r % 2);
    for (let i = 0; i < count; i++) {
      const t = (i - (count - 1) * 0.5) * bagW + offset;
      const px = x + cos * t;
      const pz = z - sin * t;
      const jitter = rng.range(-0.03, 0.03);
      b.addBlob(px + jitter, y + bagH * 0.5 + r * (bagH * 0.86), pz + jitter,
        bagW * 0.52, bagH * 0.6, bagD * 0.55, 7, 4, {
        layer: LAYER.SANDBAG,
        tint: [0.92 + rng.range(-0.12, 0.08), 0.88 + rng.range(-0.1, 0.06), 0.78 + rng.range(-0.1, 0.1)],
        wear: rng.range(0.5, 0.95), uvScale: 1.1
      });
    }
  }
  b.addCollisionBox(x, y + rows * bagH * 0.43, z, length, rows * bagH * 0.86, bagD, SURFACE.SANDBAG, rotY);
  return { x, z, height: rows * bagH * 0.86, cover: 'low' };
}

/** Market stall: timber frame, fabric roof, table, produce trays and crates. */
export function marketStall(b, cloth, x, y, z, rotY, rng, w = 2.6, d = 1.8) {
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const postH = rng.range(2.1, 2.45);
  const metal = rng.bool(0.4);
  const postLayer = metal ? LAYER.METAL_PAINTED : LAYER.WOOD;
  const postTint = metal ? [0.55, 0.56, 0.54] : rng.pick(WOOD_TINTS);
  const wear = rng.range(0.5, 0.9);

  const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (const [lx, lz] of corners) {
    const px = x + lx * cos + lz * sin;
    const pz = z - lx * sin + lz * cos;
    b.addBox(px, y + postH * 0.5, pz, 0.09, postH, 0.09, {
      rotY, layer: postLayer, tint: postTint, wear, uvScale: 2.0, collide: true, surface: metal ? SURFACE.METAL : SURFACE.WOOD
    });
  }
  // top rails
  b.addBox(x, y + postH, z, w + 0.1, 0.08, 0.08, { rotY, layer: postLayer, tint: postTint, wear, uvScale: 2.0 });
  b.addBox(x, y + postH, z, 0.08, 0.08, d + 0.1, { rotY, layer: postLayer, tint: postTint, wear, uvScale: 2.0 });

  // fabric roof registered as an animated cloth patch
  const fabricTint = rng.pick(FABRIC_TINTS);
  cloth.push({
    type: 'awning',
    center: new THREE.Vector3(x, y + postH + 0.06, z),
    width: w + rng.range(0.3, 0.7),
    depth: d + rng.range(0.2, 0.5),
    rotY,
    sag: rng.range(0.06, 0.18),
    tint: fabricTint,
    amplitude: rng.range(0.02, 0.06),
    phase: rng.range(0, 6.28)
  });

  // table
  const tableH = rng.range(0.78, 0.92);
  b.addBox(x, y + tableH, z, w * 0.92, 0.07, d * 0.7, {
    rotY, layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: 0.8, uvScale: 1.2,
    collide: true, surface: SURFACE.WOOD
  });
  b.addBox(x, y + tableH * 0.5, z, w * 0.9, 0.05, 0.05, { rotY, layer: LAYER.WOOD, tint: postTint, wear: 0.8, uvScale: 2 });

  // trays / baskets / sacks on the table
  const items = rng.int(2, 5);
  for (let i = 0; i < items; i++) {
    const lx = rng.range(-w * 0.38, w * 0.38);
    const lz = rng.range(-d * 0.26, d * 0.26);
    const px = x + lx * cos + lz * sin;
    const pz = z - lx * sin + lz * cos;
    const kind = rng.next();
    if (kind < 0.4) {
      b.addBox(px, y + tableH + 0.09, pz, rng.range(0.34, 0.5), 0.12, rng.range(0.24, 0.36), {
        rotY: rotY + rng.range(-0.3, 0.3), layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: 0.85, uvScale: 1.6
      });
      // produce-like mound
      b.addBlob(px, y + tableH + 0.17, pz, 0.16, 0.06, 0.12, 8, 4, {
        layer: LAYER.SAND, tint: rng.pick([[1.0, 0.82, 0.42], [0.85, 0.35, 0.28], [0.6, 0.72, 0.35], [0.9, 0.68, 0.3]]),
        wear: 0.4, uvScale: 2
      });
    } else if (kind < 0.7) {
      b.addCylinder(px, y + tableH + 0.04, pz, 0.16, 0.20, 0.22, 9, {
        layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: 0.85, uvScale: 1.8
      });
    } else {
      b.addBlob(px, y + tableH + 0.16, pz, 0.19, 0.16, 0.15, 8, 5, {
        layer: LAYER.SANDBAG, tint: [0.9, 0.85, 0.72], wear: 0.8, uvScale: 1.4
      });
    }
  }

  // crates stacked at one leg
  if (rng.bool(0.6)) {
    const lx = (rng.bool() ? 1 : -1) * w * 0.5;
    const lz = d * 0.5 + 0.25;
    const px = x + lx * cos + lz * sin;
    const pz = z - lx * sin + lz * cos;
    crateStack(b, px, y, pz, rotY + rng.range(-0.4, 0.4), rng, rng.int(1, 3));
  }
  return { x, z, height: postH, cover: 'low' };
}

export function crateStack(b, x, y, z, rotY, rng, count = 2) {
  let cy = y;
  for (let i = 0; i < count; i++) {
    const s = rng.range(0.42, 0.62);
    const h = s * rng.range(0.7, 1.0);
    const jx = rng.range(-0.08, 0.08) * i;
    const jz = rng.range(-0.08, 0.08) * i;
    b.addBox(x + jx, cy + h * 0.5, z + jz, s, h, s * rng.range(0.85, 1.15), {
      rotY: rotY + rng.range(-0.25, 0.25) * i,
      layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: rng.range(0.6, 0.95), uvScale: 1.5,
      collide: true, surface: SURFACE.WOOD
    });
    // slat detail
    b.addBox(x + jx, cy + h * 0.5, z + jz, s + 0.02, 0.04, s * 1.16 + 0.02, {
      rotY, layer: LAYER.WOOD, tint: [0.6, 0.5, 0.38], wear: 0.9, uvScale: 2.2
    });
    cy += h;
  }
  return { x, z, height: cy - y, cover: 'low' };
}

export function metalDrum(b, x, y, z, rng, rotY = 0) {
  const r = 0.29, h = 0.88;
  const tint = rng.pick(BARREL_TINTS);
  const rust = rng.bool(0.45);
  b.addCylinder(x, y, z, r, r, h, 14, {
    layer: rust ? LAYER.METAL_RUST : LAYER.METAL_PAINTED, tint, wear: rng.range(0.6, 0.95), uvScale: 1.0,
    collide: true, surface: SURFACE.METAL, rotY
  });
  for (const rib of [0.22, 0.5, 0.78]) {
    b.addCylinder(x, y + h * rib, z, r + 0.02, r + 0.02, 0.05, 14, {
      layer: LAYER.METAL_RUST, tint: [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8], wear: 0.9, uvScale: 2, caps: false, rotY
    });
  }
  return { x, z, height: h, cover: 'low' };
}

export function propaneCylinder(b, x, y, z, rng) {
  const r = 0.17, h = 0.62;
  b.addCylinder(x, y, z, r, r, h, 12, {
    layer: LAYER.METAL_PAINTED, tint: rng.pick([[0.85, 0.72, 0.3], [0.75, 0.3, 0.25], [0.6, 0.62, 0.6]]),
    wear: rng.range(0.5, 0.9), uvScale: 1.4, collide: true, surface: SURFACE.METAL
  });
  b.addCylinder(x, y + h, z, 0.06, 0.05, 0.1, 8, { layer: LAYER.METAL_RUST, tint: [0.6, 0.6, 0.6], wear: 0.9, uvScale: 3 });
  return { x, z, height: h };
}

export function tireStack(b, x, y, z, rng, count = 3) {
  for (let i = 0; i < count; i++) {
    b.addCylinder(x + rng.range(-0.05, 0.05), y + i * 0.2, z + rng.range(-0.05, 0.05), 0.34, 0.34, 0.19, 12, {
      layer: LAYER.POLYMER, tint: [0.55, 0.55, 0.57], wear: 0.8, uvScale: 1.6, caps: false, rotY: rng.range(0, 3.14)
    });
    b.addCylinder(x, y + i * 0.2 + 0.01, z, 0.19, 0.19, 0.17, 10, {
      layer: LAYER.POLYMER, tint: [0.4, 0.4, 0.42], wear: 0.7, uvScale: 2, caps: true
    });
  }
  b.addCollisionBox(x, y + count * 0.1, z, 0.68, count * 0.2, 0.68, SURFACE.RUBBER);
  return { x, z, height: count * 0.2 };
}

export function palletStack(b, x, y, z, rotY, rng) {
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i++) {
    const py = y + i * 0.15;
    b.addBox(x, py + 0.03, z, 1.15, 0.055, 0.9, { rotY, layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: 0.9, uvScale: 1.6 });
    for (let k = 0; k < 3; k++) {
      b.addBox(x + (k - 1) * 0.42 * Math.cos(rotY), py + 0.09, z - (k - 1) * 0.42 * Math.sin(rotY), 0.12, 0.075, 0.9, {
        rotY, layer: LAYER.WOOD, tint: [0.62, 0.52, 0.4], wear: 0.9, uvScale: 2
      });
    }
    b.addBox(x, py + 0.14, z, 1.15, 0.05, 0.9, { rotY, layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: 0.9, uvScale: 1.6 });
  }
  b.addCollisionBox(x, y + n * 0.075, z, 1.15, n * 0.15, 0.9, SURFACE.WOOD, rotY);
  return { x, z, height: n * 0.15 };
}

/** Rubble pile: irregular chunks plus dust skirt. */
export function rubblePile(b, x, y, z, rng, radius = 1.2) {
  const chunks = rng.int(7, 16);
  for (let i = 0; i < chunks; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * radius;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const s = rng.range(0.12, 0.42) * (1 - r / radius * 0.5);
    const layer = rng.bool(0.6) ? LAYER.CONCRETE : LAYER.BRICK;
    b.addBox(px, y + s * 0.35, pz, s, s * rng.range(0.5, 0.9), s * rng.range(0.7, 1.3), {
      rotY: rng.range(0, Math.PI * 2), layer, tint: [0.92, 0.90, 0.86], wear: 0.95, uvScale: 1.4
    });
  }
  b.addCollisionBox(x, y + 0.18, z, radius * 1.5, 0.36, radius * 1.5, SURFACE.CONCRETE);
  return { x, z, height: 0.4 };
}

/** Small utility pickup / van. Static but properly integrated. */
export function utilityVehicle(b, x, y, z, rotY, rng) {
  const bodyTint = rng.pick([[0.72, 0.70, 0.66], [0.45, 0.52, 0.58], [0.62, 0.56, 0.42], [0.35, 0.38, 0.40]]);
  const wear = rng.range(0.5, 0.9);
  const L = rng.range(4.3, 5.0), W = 1.85, wheelR = 0.35;
  const o = { rotY, layer: LAYER.METAL_PAINTED, tint: bodyTint, wear, uvScale: 0.9 };

  // chassis + bed
  b.addBox(x, y + wheelR + 0.28, z, L, 0.5, W, { ...o, collide: true, surface: SURFACE.METAL });
  // cabin
  const cabOff = L * 0.16;
  const cx2 = x + Math.cos(rotY) * cabOff, cz2 = z - Math.sin(rotY) * cabOff;
  b.addBox(cx2, y + wheelR + 0.86, cz2, L * 0.38, 0.68, W * 0.94, { ...o, collide: true, surface: SURFACE.METAL });
  // glass
  b.addBox(cx2, y + wheelR + 0.94, cz2, L * 0.36, 0.42, W * 0.96, {
    rotY, layer: LAYER.GUNMETAL, tint: [0.35, 0.42, 0.48], wear: 0.4, uvScale: 1.2
  });
  // bed walls
  const bedOff = -L * 0.24;
  const bx = x + Math.cos(rotY) * bedOff, bz = z - Math.sin(rotY) * bedOff;
  b.addBox(bx, y + wheelR + 0.72, bz, L * 0.44, 0.42, W, { ...o, collide: true, surface: SURFACE.METAL });
  b.addBox(bx, y + wheelR + 0.66, bz, L * 0.40, 0.36, W - 0.28, { rotY, layer: LAYER.METAL_RUST, tint: [0.5, 0.45, 0.4], wear: 0.95, uvScale: 1.2 });
  // wheels
  for (const [lx, lz] of [[L * 0.32, W * 0.5], [L * 0.32, -W * 0.5], [-L * 0.30, W * 0.5], [-L * 0.30, -W * 0.5]]) {
    const px = x + lx * Math.cos(rotY) + lz * Math.sin(rotY);
    const pz = z - lx * Math.sin(rotY) + lz * Math.cos(rotY);
    b.addCylinder(px, y + wheelR, pz, wheelR, wheelR, 0.24, 12, {
      layer: LAYER.POLYMER, tint: [0.5, 0.5, 0.52], wear: 0.8, uvScale: 1.6, caps: true,
      rotY: rotY + Math.PI * 0.5
    });
  }
  // bumper + light housings
  const fOff = L * 0.5;
  b.addBox(x + Math.cos(rotY) * fOff, y + wheelR + 0.18, z - Math.sin(rotY) * fOff, 0.12, 0.22, W * 0.92, {
    rotY, layer: LAYER.METAL_RUST, tint: [0.62, 0.62, 0.6], wear: 0.9, uvScale: 1.6
  });
  b.addCollisionBox(x, y + wheelR + 0.5, z, L, 1.4, W + 0.2, SURFACE.METAL, rotY);
  return { x, z, height: 1.7, cover: 'medium' };
}

/** Two-wheel handcart. */
export function handcart(b, x, y, z, rotY, rng) {
  const o = { rotY, layer: LAYER.WOOD, tint: rng.pick(WOOD_TINTS), wear: 0.85, uvScale: 1.2 };
  b.addBox(x, y + 0.62, z, 1.7, 0.09, 1.05, { ...o, collide: true, surface: SURFACE.WOOD });
  b.addBox(x, y + 0.78, z, 1.7, 0.26, 0.06, o);
  for (const s of [-1, 1]) {
    const px = x + Math.sin(rotY) * 0.52 * s;
    const pz = z + Math.cos(rotY) * 0.52 * s;
    b.addCylinder(px, y + 0.3, pz, 0.3, 0.3, 0.08, 12, {
      layer: LAYER.METAL_RUST, tint: [0.55, 0.5, 0.45], wear: 0.9, uvScale: 1.6, rotY: rotY + Math.PI * 0.5
    });
  }
  const hOff = 0.95;
  b.addBox(x + Math.cos(rotY) * hOff, y + 0.68, z - Math.sin(rotY) * hOff, 0.6, 0.07, 0.07, o);
  b.addCollisionBox(x, y + 0.45, z, 1.8, 0.9, 1.1, SURFACE.WOOD, rotY);
  return { x, z, height: 0.9, cover: 'low' };
}

/** Palm tree with a segmented trunk and drooping fronds registered for wind. */
export function palmTree(b, cloth, x, y, z, rng) {
  const h = rng.range(4.5, 7.5);
  const lean = rng.range(-0.12, 0.12);
  const segments = 9;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    pts.push(new THREE.Vector3(x + lean * t * t * h * 0.3, y + t * h, z + lean * 0.4 * t * t * h * 0.2));
  }
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const r = 0.24 * (1 - t * 0.42);
    b.addCylinder(pts[i].x, pts[i].y, pts[i].z, r, r * 0.94, h / segments, 8, {
      layer: LAYER.WOOD, tint: [0.72, 0.64, 0.50], wear: 0.9, uvScale: 1.2, caps: false
    });
    if (i % 2 === 0) {
      b.addCylinder(pts[i].x, pts[i].y - 0.03, pts[i].z, r + 0.045, r + 0.02, 0.1, 8, {
        layer: LAYER.WOOD, tint: [0.60, 0.52, 0.40], wear: 0.95, uvScale: 2, caps: false
      });
    }
  }
  b.addCollisionBox(x, y + h * 0.5, z, 0.5, h, 0.5, SURFACE.WOOD);
  const crown = pts[segments];
  cloth.push({
    type: 'palm',
    center: crown.clone(),
    fronds: rng.int(8, 13),
    length: rng.range(1.6, 2.5),
    tint: [0.42, 0.52, 0.30],
    amplitude: rng.range(0.05, 0.12),
    phase: rng.range(0, 6.28),
    seed: rng.next()
  });
  return { x, z, height: h };
}

/** Dry shrub / weed clump built from crossed blade cards. */
export function shrub(b, x, y, z, rng, scale = 1) {
  const blades = rng.int(5, 10);
  const tint = rng.pick([[0.48, 0.50, 0.32], [0.58, 0.54, 0.34], [0.40, 0.46, 0.28]]);
  for (let i = 0; i < blades; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.02, 0.22) * scale;
    const h = rng.range(0.25, 0.62) * scale;
    b.addBox(x + Math.cos(a) * r, y + h * 0.5, z + Math.sin(a) * r, 0.04 * scale, h, rng.range(0.16, 0.34) * scale, {
      rotY: a, layer: LAYER.FABRIC, tint, wear: 0.9, uvScale: 2.2
    });
  }
  return { x, z, height: 0.5 * scale };
}

/** Wooden barricade / saw horse. */
export function barricade(b, x, y, z, rotY, rng) {
  const tint = rng.pick([[0.9, 0.85, 0.7], [0.8, 0.5, 0.3]]);
  const o = { rotY, layer: LAYER.WOOD, tint, wear: 0.85, uvScale: 1.4 };
  b.addBox(x, y + 0.82, z, 2.2, 0.2, 0.08, o);
  b.addBox(x, y + 0.52, z, 2.2, 0.2, 0.08, o);
  for (const s of [-1, 1]) {
    const px = x + Math.cos(rotY) * s * 0.95;
    const pz = z - Math.sin(rotY) * s * 0.95;
    b.addBox(px, y + 0.45, pz, 0.09, 0.9, 0.5, { rotY, layer: LAYER.WOOD, tint: [0.6, 0.52, 0.4], wear: 0.9, uvScale: 2 });
  }
  b.addCollisionBox(x, y + 0.45, z, 2.2, 0.9, 0.4, SURFACE.WOOD, rotY);
  return { x, z, height: 0.92, cover: 'low' };
}

/** Chain-link / corrugated fence run. */
export function fenceRun(b, x0, z0, x1, z1, y, rng) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const rotY = Math.atan2(-dz, dx);
  const panels = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i < panels; i++) {
    const t0 = i / panels, t1 = (i + 1) / panels;
    const mx = x0 + dx * (t0 + t1) * 0.5;
    const mz = z0 + dz * (t0 + t1) * 0.5;
    const h = rng.range(1.7, 2.2);
    b.addBox(mx, y + h * 0.5, mz, len / panels * 0.98, h, 0.06, {
      rotY, layer: LAYER.CORRUGATED, tint: [0.85, 0.83, 0.80], wear: rng.range(0.6, 0.95), uvScale: 1.1,
      collide: true, surface: SURFACE.METAL
    });
    b.addBox(x0 + dx * t0, y + h * 0.5 + 0.05, z0 + dz * t0, 0.09, h + 0.1, 0.09, {
      rotY, layer: LAYER.METAL_RUST, tint: [0.6, 0.58, 0.55], wear: 0.9, uvScale: 2
    });
  }
  return { x: (x0 + x1) * 0.5, z: (z0 + z1) * 0.5, height: 2 };
}

/** Monumental arch over the plaza. */
export function monumentalArch(b, cx, y, cz, rotY, rng, span = 11, height = 8.5) {
  const pierW = 2.3, pierD = 2.4;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const tint = [0.94, 0.90, 0.82];
  const o = { rotY, layer: LAYER.CONCRETE, tint, wear: 0.7, uvScale: 0.35 };

  for (const s of [-1, 1]) {
    const px = cx + cos * s * (span * 0.5);
    const pz = cz - sin * s * (span * 0.5);
    b.addBox(px, y + height * 0.42, pz, pierW, height * 0.84, pierD, { ...o, collide: true, surface: SURFACE.CONCRETE });
    // base plinth and cap moulding
    b.addBox(px, y + 0.3, pz, pierW + 0.45, 0.6, pierD + 0.45, { ...o, collide: true, surface: SURFACE.CONCRETE });
    b.addBox(px, y + height * 0.84 + 0.16, pz, pierW + 0.35, 0.32, pierD + 0.35, { ...o, collide: true, surface: SURFACE.CONCRETE });
    // recessed panel detail
    b.addBox(px, y + height * 0.45, pz - (pierD * 0.5 + 0.01) * cos, pierW * 0.6, height * 0.5, 0.06, {
      rotY, layer: LAYER.PLASTER_BEIGE, tint: [0.86, 0.82, 0.74], wear: 0.8, uvScale: 0.5
    });
  }

  // stepped voussoir arc
  const steps = 13;
  const radius = span * 0.5;
  const archBase = y + height * 0.62;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.PI * t;
    const lx = -Math.cos(a) * radius;
    const ly = Math.sin(a) * radius * 0.55;
    const px = cx + cos * lx;
    const pz = cz - sin * lx;
    b.addBox(px, archBase + ly, pz, span / steps * 1.25, 0.85, pierD * 0.92, {
      rotY, layer: LAYER.CONCRETE, tint: [tint[0] * (0.95 + (i % 2) * 0.06), tint[1], tint[2]],
      wear: 0.75, uvScale: 0.45, collide: true, surface: SURFACE.CONCRETE
    });
  }
  // entablature over the arch
  b.addBox(cx, y + height + 0.5, cz, span + pierW + 1.4, 1.0, pierD + 0.5, { ...o, collide: true, surface: SURFACE.CONCRETE });
  b.addBox(cx, y + height + 1.25, cz, span + pierW + 0.9, 0.5, pierD + 0.2, { ...o, collide: true, surface: SURFACE.CONCRETE });
  // battle damage: a bite out of one corner
  if (rng.bool(0.8)) {
    const s = rng.bool() ? 1 : -1;
    b.addBox(cx + cos * s * (span * 0.5 + pierW * 0.4), y + height * 0.9, cz - sin * s * (span * 0.5 + pierW * 0.4), 1.1, 1.3, 1.1, {
      rotY: rotY + 0.6, layer: LAYER.CONCRETE, tint: [0.70, 0.68, 0.64], wear: 1.0, uvScale: 0.7
    });
  }
  return { x: cx, z: cz, height };
}

/** Street lamp post. */
export function lampPost(b, x, y, z, rng, rotY = 0) {
  const h = rng.range(4.2, 5.4);
  b.addCylinder(x, y, z, 0.13, 0.09, h, 8, {
    layer: LAYER.METAL_PAINTED, tint: [0.42, 0.44, 0.42], wear: 0.8, uvScale: 1.0,
    collide: true, surface: SURFACE.METAL
  });
  b.addBox(x, y + 0.16, z, 0.34, 0.32, 0.34, { layer: LAYER.CONCRETE, tint: [0.85, 0.83, 0.8], wear: 0.85, uvScale: 1.4 });
  const armLen = 0.9;
  b.addBox(x + Math.cos(rotY) * armLen * 0.5, y + h - 0.1, z - Math.sin(rotY) * armLen * 0.5, armLen, 0.08, 0.08, {
    rotY, layer: LAYER.METAL_PAINTED, tint: [0.42, 0.44, 0.42], wear: 0.8, uvScale: 2
  });
  b.addBox(x + Math.cos(rotY) * armLen, y + h - 0.18, z - Math.sin(rotY) * armLen, 0.5, 0.16, 0.26, {
    rotY, layer: LAYER.METAL_PAINTED, tint: [0.7, 0.68, 0.62], wear: 0.7, uvScale: 1.6
  });
  return { x, z, height: h };
}

/** Loose ground scatter: pebbles, bricks, boards, cans, paper. */
export function groundScatter(b, x, y, z, rng) {
  const kind = rng.next();
  if (kind < 0.3) {
    b.addBox(x, y + 0.035, z, rng.range(0.18, 0.26), 0.07, rng.range(0.09, 0.13), {
      rotY: rng.range(0, 3.14), layer: LAYER.BRICK, tint: [0.95, 0.9, 0.86], wear: 0.95, uvScale: 2.4
    });
  } else if (kind < 0.5) {
    b.addBox(x, y + 0.02, z, rng.range(0.5, 1.4), 0.035, rng.range(0.09, 0.16), {
      rotY: rng.range(0, 3.14), layer: LAYER.WOOD, tint: [0.68, 0.58, 0.44], wear: 0.95, uvScale: 1.6
    });
  } else if (kind < 0.66) {
    b.addCylinder(x, y, z, 0.035, 0.035, 0.11, 7, {
      layer: LAYER.METAL_PAINTED, tint: rng.pick([[0.7, 0.7, 0.72], [0.8, 0.5, 0.3], [0.4, 0.6, 0.7]]), wear: 0.9, uvScale: 3,
      rotY: rng.range(0, 3.14)
    });
  } else if (kind < 0.84) {
    const n = rng.int(3, 7);
    for (let i = 0; i < n; i++) {
      const s = rng.range(0.05, 0.13);
      b.addBox(x + rng.range(-0.4, 0.4), y + s * 0.4, z + rng.range(-0.4, 0.4), s, s * 0.7, s, {
        rotY: rng.range(0, 3.14), layer: LAYER.GRAVEL, tint: [0.95, 0.92, 0.88], wear: 0.95, uvScale: 3
      });
    }
  } else {
    b.addBox(x, y + 0.008, z, rng.range(0.14, 0.24), 0.012, rng.range(0.12, 0.2), {
      rotY: rng.range(0, 3.14), layer: LAYER.FABRIC, tint: [1.0, 0.98, 0.94], wear: 0.7, uvScale: 3
    });
  }
}

export const PROP_TINTS = { WOOD_TINTS, FABRIC_TINTS, BARREL_TINTS };
