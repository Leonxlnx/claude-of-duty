import * as THREE from 'three';
import { LAYER } from './MaterialLibrary.js';
import { SURFACE } from '../physics/BVH.js';

/**
 * Procedural facade grammar. Buildings are assembled from a deterministic
 * sequence of bays; every element (window, reveal, sill, shutter, balcony,
 * AC unit, conduit, drain pipe, roof clutter) is chosen from the seeded stream
 * so two buildings never come out identical, but the same seed always rebuilds
 * the same district.
 */

export const WALL_STYLES = [
  { layer: LAYER.PLASTER_BEIGE, tint: [1.0, 0.98, 0.94] },
  { layer: LAYER.PLASTER_BEIGE, tint: [0.92, 0.88, 0.80] },
  { layer: LAYER.PLASTER_WHITE, tint: [1.0, 0.99, 0.96] },
  { layer: LAYER.PLASTER_WHITE, tint: [0.90, 0.90, 0.88] },
  { layer: LAYER.PLASTER_PEACH, tint: [1.0, 0.96, 0.92] },
  { layer: LAYER.STUCCO_BLUE, tint: [0.95, 0.98, 1.0] },
  { layer: LAYER.STUCCO_TERRACOTTA, tint: [0.98, 0.94, 0.90] },
  { layer: LAYER.CONCRETE, tint: [1.0, 0.99, 0.96] },
  { layer: LAYER.CONCRETE, tint: [0.88, 0.86, 0.82] },
  { layer: LAYER.BRICK, tint: [0.96, 0.94, 0.92] }
];

const DARK = [0.09, 0.085, 0.08];
const SHUTTER_TINTS = [
  [0.42, 0.46, 0.48], [0.55, 0.42, 0.30], [0.35, 0.40, 0.42],
  [0.60, 0.58, 0.52], [0.30, 0.38, 0.36]
];

/** Local frame on one facade plane: origin at the bottom-left corner seen from outside. */
class Facade {
  constructor(origin, right, up, normal, width, height) {
    this.origin = origin;
    this.right = right;
    this.up = up;
    this.normal = normal;
    this.width = width;
    this.height = height;
  }

  point(u, v, d, out) {
    out.copy(this.origin)
      .addScaledVector(this.right, u)
      .addScaledVector(this.up, v)
      .addScaledVector(this.normal, d);
    return out;
  }
}

const _p = Array.from({ length: 8 }, () => new THREE.Vector3());

/** Flat panel parallel to the facade. */
function panel(b, f, u, v, w, h, d, opts) {
  f.point(u, v, d, _p[0]);
  f.point(u + w, v, d, _p[1]);
  f.point(u + w, v + h, d, _p[2]);
  f.point(u, v + h, d, _p[3]);
  b.addQuad(_p[0], _p[1], _p[2], _p[3], opts);
}

/** A rectangular hole pushed `depth` into the wall: four reveals plus a back plate. */
function recess(b, f, u, v, w, h, depth, opts) {
  const { backLayer = LAYER.TILE, backTint = DARK, revealLayer = opts.layer, revealTint = opts.tint, uvScale = 0.6, wear = 0.5 } = opts;
  // back plate
  panel(b, f, u, v, w, h, -depth, { layer: backLayer, tint: backTint, wear: 0.7, uvScale: 0.9 });
  // reveals
  const ro = { layer: revealLayer, tint: revealTint, wear, uvScale };
  // bottom
  f.point(u, v, 0, _p[0]); f.point(u + w, v, 0, _p[1]);
  f.point(u + w, v, -depth, _p[2]); f.point(u, v, -depth, _p[3]);
  b.addQuad(_p[3], _p[2], _p[1], _p[0], ro);
  // top
  f.point(u, v + h, 0, _p[0]); f.point(u + w, v + h, 0, _p[1]);
  f.point(u + w, v + h, -depth, _p[2]); f.point(u, v + h, -depth, _p[3]);
  b.addQuad(_p[0], _p[1], _p[2], _p[3], ro);
  // left
  f.point(u, v, 0, _p[0]); f.point(u, v + h, 0, _p[1]);
  f.point(u, v + h, -depth, _p[2]); f.point(u, v, -depth, _p[3]);
  b.addQuad(_p[0], _p[1], _p[2], _p[3], ro);
  // right
  f.point(u + w, v, 0, _p[0]); f.point(u + w, v + h, 0, _p[1]);
  f.point(u + w, v + h, -depth, _p[2]); f.point(u + w, v, -depth, _p[3]);
  b.addQuad(_p[3], _p[2], _p[1], _p[0], ro);
}

/** Small extruded block sitting on the facade (sill, lintel, AC unit, conduit box). */
function block(b, f, u, v, w, h, d0, d1, opts) {
  const corners = [];
  for (const [uu, vv, dd] of [
    [u, v, d0], [u + w, v, d0], [u + w, v + h, d0], [u, v + h, d0],
    [u, v, d1], [u + w, v, d1], [u + w, v + h, d1], [u, v + h, d1]
  ]) {
    corners.push(f.point(uu, vv, dd, new THREE.Vector3()));
  }
  const [a0, a1, a2, a3, b0, b1, b2, b3] = corners;
  b.addQuad(b0, b1, b2, b3, opts);            // front
  b.addQuad(a3, a2, a1, a0, opts);            // back
  b.addQuad(a0, a1, b1, b0, opts);            // bottom
  b.addQuad(b3, b2, a2, a3, opts);            // top
  b.addQuad(a3, a0, b0, b3, opts);            // left
  b.addQuad(a1, a2, b2, b1, opts);            // right
}

function louvers(b, f, u, v, w, h, d, count, opts) {
  for (let i = 0; i < count; i++) {
    const vv = v + (h / count) * i + 0.012;
    block(b, f, u, vv, w, (h / count) - 0.024, d, d + 0.018, opts);
  }
}

/** Vertical or horizontal bar grille over a window. */
function bars(b, f, u, v, w, h, d, rng, opts) {
  const n = Math.max(2, Math.round(w / 0.19));
  for (let i = 1; i < n; i++) {
    const uu = u + (w / n) * i - 0.011;
    block(b, f, uu, v + 0.02, 0.022, h - 0.04, d, d + 0.03, opts);
  }
  if (rng.bool(0.5)) {
    block(b, f, u + 0.02, v + h * 0.5 - 0.011, w - 0.04, 0.022, d, d + 0.03, opts);
  }
}

/**
 * Build one facade side.
 * @param {object} ctx { builder, detail, rng, style, floors, floorHeight, groundHeight }
 */
function buildFacade(ctx, f, side) {
  const { builder: b, rng, style, floors, floorHeight, groundHeight } = ctx;
  // One texture repeat per ~1.2 m. Coarser than this and the plaster grain
  // reads as camouflage blotches instead of a rendered surface.
  const wallOpts = { layer: style.layer, tint: style.tint, wear: ctx.wear, uvScale: 0.82, collide: false };

  const width = f.width;
  const bayTarget = rng.range(2.5, 3.4);
  const bayCount = Math.max(1, Math.round(width / bayTarget));
  const bayW = width / bayCount;

  // ---- main wall plane
  panel(b, f, 0, 0, width, f.height, 0, wallOpts);

  // ---- horizontal string course between ground and first floor
  if (rng.bool(0.62)) {
    block(b, f, 0, groundHeight - 0.14, width, 0.16, 0, rng.range(0.05, 0.11), {
      layer: style.layer, tint: mul(style.tint, 0.94), wear: ctx.wear + 0.1, uvScale: 0.5
    });
  }

  // ---- ground floor bays
  for (let i = 0; i < bayCount; i++) {
    const u0 = i * bayW;
    const roll = rng.next();
    if (roll < 0.26 && ctx.allowDoors) {
      // recessed doorway
      const dw = Math.min(1.25, bayW * 0.45);
      const dh = 2.25;
      const du = u0 + (bayW - dw) * 0.5;
      recess(b, f, du, 0.02, dw, dh, 0.42, { layer: style.layer, tint: style.tint, backTint: [0.05, 0.05, 0.05], backLayer: LAYER.TILE });
      // door leaf pushed back, sometimes open
      const open = rng.bool(0.35);
      if (!open) {
        panel(b, f, du + 0.05, 0.03, dw - 0.1, dh - 0.06, -0.28, {
          layer: LAYER.WOOD, tint: rng.pick([[0.55, 0.42, 0.28], [0.35, 0.38, 0.40], [0.42, 0.30, 0.24]]), wear: 0.7, uvScale: 0.9
        });
      }
      // lintel
      block(b, f, du - 0.1, dh + 0.02, dw + 0.2, 0.16, 0, 0.07, { layer: LAYER.CONCRETE, tint: [0.9, 0.89, 0.86], wear: 0.5, uvScale: 0.7 });
      ctx.doorways.push({ u: du + dw * 0.5, side });
    } else if (roll < 0.52 && ctx.allowShops) {
      // shop front with a roller shutter
      const sw = bayW * rng.range(0.62, 0.86);
      const sh = rng.range(2.1, 2.5);
      const su = u0 + (bayW - sw) * 0.5;
      recess(b, f, su, 0.05, sw, sh, 0.3, { layer: style.layer, tint: style.tint, backTint: [0.04, 0.04, 0.045] });
      const closed = rng.range(0, 1);
      const shutterH = sh * (closed < 0.4 ? 1.0 : closed < 0.7 ? rng.range(0.35, 0.7) : 0.14);
      block(b, f, su, 0.05 + sh - shutterH, sw, shutterH, -0.16, -0.10, {
        layer: LAYER.CORRUGATED, tint: rng.pick(SHUTTER_TINTS), wear: 0.75, uvScale: 1.5
      });
      block(b, f, su - 0.06, 0.05 + sh, sw + 0.12, 0.18, 0, 0.14, {
        layer: LAYER.CONCRETE, tint: [0.88, 0.87, 0.84], wear: 0.55, uvScale: 0.7
      });
    } else if (roll < 0.72) {
      // barred ground-floor window
      const ww = bayW * rng.range(0.4, 0.6);
      const wh = rng.range(1.0, 1.35);
      const wu = u0 + (bayW - ww) * 0.5;
      const wv = rng.range(0.95, 1.25);
      windowUnit(ctx, f, wu, wv, ww, wh, side, true);
    } else if (roll < 0.8) {
      // blank patched wall
      panel(b, f, u0 + bayW * 0.15, rng.range(0.3, 1.4), bayW * 0.7, rng.range(0.8, 1.6), 0.012, {
        layer: LAYER.CONCRETE, tint: mul(style.tint, rng.range(0.82, 0.95)), wear: 0.85, uvScale: 0.55
      });
    }
  }

  // ---- upper floors
  for (let fl = 1; fl < floors; fl++) {
    const base = groundHeight + (fl - 1) * floorHeight;
    for (let i = 0; i < bayCount; i++) {
      const u0 = i * bayW;
      if (rng.next() > 0.82) continue;   // occasional blank bay
      const ww = bayW * rng.range(0.36, 0.55);
      const wh = rng.range(1.15, 1.55);
      const wu = u0 + (bayW - ww) * 0.5;
      const wv = base + rng.range(0.85, 1.15);
      const hasBalcony = rng.bool(0.22) && ww > 0.8;
      windowUnit(ctx, f, wu, wv, ww, wh, side, rng.bool(0.34), hasBalcony);

      if (hasBalcony) {
        balcony(ctx, f, wu - 0.35, base + 0.72, ww + 0.7, side);
      }
      // wall air-conditioner
      if (rng.bool(0.22)) {
        const au = u0 + bayW * (rng.bool() ? 0.12 : 0.72);
        const av = base + rng.range(1.5, 2.2);
        block(b, f, au, av, 0.62, 0.42, 0, 0.34, { layer: LAYER.METAL_PAINTED, tint: [0.82, 0.82, 0.80], wear: 0.6, uvScale: 1.4 });
        louvers(b, f, au + 0.05, av + 0.04, 0.52, 0.34, 0.34, 5, { layer: LAYER.METAL_PAINTED, tint: [0.62, 0.62, 0.60], wear: 0.7, uvScale: 2.0 });
        // bracket + drip stain
        block(b, f, au + 0.06, av - 0.14, 0.06, 0.16, 0, 0.3, { layer: LAYER.METAL_RUST, tint: [0.8, 0.8, 0.8], wear: 0.9, uvScale: 2 });
        block(b, f, au + 0.5, av - 0.14, 0.06, 0.16, 0, 0.3, { layer: LAYER.METAL_RUST, tint: [0.8, 0.8, 0.8], wear: 0.9, uvScale: 2 });
      }
    }
    // conduit runs
    if (rng.bool(0.45)) {
      const cu = rng.range(0.3, Math.max(0.4, width - 0.3));
      block(b, f, cu, base, 0.07, floorHeight, 0, 0.06, { layer: LAYER.METAL_RUST, tint: [0.7, 0.7, 0.7], wear: 0.8, uvScale: 2.2 });
    }
  }

  // ---- drain pipe at one corner
  if (rng.bool(0.55)) {
    const du = rng.bool() ? 0.22 : width - 0.22;
    block(b, f, du - 0.055, 0.0, 0.11, f.height - 0.2, 0.02, 0.13, {
      layer: LAYER.METAL_RUST, tint: [0.75, 0.74, 0.72], wear: 0.85, uvScale: 1.6
    });
    for (let k = 0; k < 3; k++) {
      block(b, f, du - 0.09, 0.9 + k * 1.6, 0.18, 0.06, 0.02, 0.16, {
        layer: LAYER.METAL_RUST, tint: [0.6, 0.6, 0.6], wear: 0.9, uvScale: 2.4
      });
    }
  }

  // ---- exterior lamp above a doorway
  if (rng.bool(0.3)) {
    const lu = rng.range(0.6, Math.max(0.7, width - 0.6));
    block(b, f, lu, 2.55, 0.16, 0.1, 0, 0.22, { layer: LAYER.METAL_PAINTED, tint: [0.4, 0.4, 0.4], wear: 0.7, uvScale: 2 });
    block(b, f, lu - 0.04, 2.4, 0.24, 0.16, 0.16, 0.3, { layer: LAYER.METAL_PAINTED, tint: [0.75, 0.72, 0.66], wear: 0.6, uvScale: 2 });
  }
}

/** Window: recess, dark interior or glass, frame, sill, optional shutters and bars. */
function windowUnit(ctx, f, u, v, w, h, side, withBars, skipSill = false) {
  const { builder: b, rng, style } = ctx;
  const kind = rng.next();
  const depth = rng.range(0.16, 0.3);

  recess(b, f, u, v, w, h, depth, {
    layer: style.layer, tint: style.tint,
    backLayer: kind < 0.2 ? LAYER.WOOD : LAYER.TILE,
    backTint: kind < 0.2 ? [0.30, 0.22, 0.15] : [0.055, 0.055, 0.06]
  });

  if (kind < 0.34) {
    // glazed: dark reflective plate slightly inside the reveal
    panel(b, f, u + 0.03, v + 0.03, w - 0.06, h - 0.06, -depth + 0.05, {
      layer: LAYER.GUNMETAL, tint: [0.42, 0.48, 0.55], wear: 0.25, uvScale: 0.8
    });
  } else if (kind < 0.46) {
    // boarded up
    for (let i = 0; i < 3; i++) {
      panel(b, f, u + 0.02, v + 0.06 + i * (h - 0.12) / 3, w - 0.04, (h - 0.12) / 3 - 0.05, -depth + 0.06, {
        layer: LAYER.WOOD, tint: [0.62, 0.52, 0.38], wear: 0.85, uvScale: 1.1
      });
    }
  } else if (kind < 0.58) {
    // interior curtain
    panel(b, f, u + 0.04, v + 0.04, w - 0.08, h - 0.08, -depth + 0.04, {
      layer: LAYER.FABRIC, tint: rng.pick([[0.55, 0.5, 0.42], [0.4, 0.42, 0.45], [0.6, 0.42, 0.35]]), wear: 0.7, uvScale: 1.2
    });
  }

  // frame
  const frameOpts = { layer: LAYER.WOOD, tint: rng.pick([[0.45, 0.38, 0.28], [0.55, 0.55, 0.52], [0.3, 0.34, 0.36]]), wear: 0.7, uvScale: 1.6 };
  block(b, f, u - 0.045, v - 0.045, w + 0.09, 0.06, -0.01, 0.045, frameOpts);
  block(b, f, u - 0.045, v + h - 0.015, w + 0.09, 0.06, -0.01, 0.045, frameOpts);
  block(b, f, u - 0.045, v, 0.05, h, -0.01, 0.045, frameOpts);
  block(b, f, u + w - 0.005, v, 0.05, h, -0.01, 0.045, frameOpts);

  if (!skipSill) {
    block(b, f, u - 0.1, v - 0.11, w + 0.2, 0.1, 0, 0.12, {
      layer: LAYER.CONCRETE, tint: [0.9, 0.88, 0.85], wear: 0.6, uvScale: 0.9
    });
  }

  if (withBars) {
    bars(b, f, u, v, w, h, 0.02, rng, { layer: LAYER.METAL_RUST, tint: [0.7, 0.68, 0.66], wear: 0.85, uvScale: 2.2 });
  } else if (rng.bool(0.3)) {
    // hinged shutters, one or both leaves swung open
    const tint = rng.pick(SHUTTER_TINTS);
    const halves = rng.next();
    if (halves < 0.5) {
      block(b, f, u - w * 0.5 - 0.03, v, w * 0.5, h, 0.02, 0.07, { layer: LAYER.WOOD, tint, wear: 0.75, uvScale: 1.8 });
      block(b, f, u + w + 0.03, v, w * 0.5, h, 0.02, 0.07, { layer: LAYER.WOOD, tint, wear: 0.75, uvScale: 1.8 });
    } else {
      block(b, f, u, v, w * 0.5, h, 0.02, 0.07, { layer: LAYER.WOOD, tint, wear: 0.75, uvScale: 1.8 });
      block(b, f, u + w * 0.5, v, w * 0.5, h, 0.02, 0.07, { layer: LAYER.WOOD, tint, wear: 0.75, uvScale: 1.8 });
    }
  }
}

function balcony(ctx, f, u, v, w, side) {
  const { builder: b, rng } = ctx;
  const depth = rng.range(0.75, 1.05);
  // slab
  block(b, f, u, v, w, 0.14, 0, depth, { layer: LAYER.CONCRETE, tint: [0.88, 0.86, 0.83], wear: 0.6, uvScale: 0.7 });
  // railing
  const railH = rng.range(0.88, 1.02);
  const railOpts = { layer: LAYER.METAL_RUST, tint: rng.pick([[0.4, 0.42, 0.44], [0.55, 0.5, 0.42], [0.32, 0.36, 0.38]]), wear: 0.8, uvScale: 2.0 };
  block(b, f, u, v + 0.14, 0.05, railH, depth - 0.06, depth, railOpts);
  block(b, f, u + w - 0.05, v + 0.14, 0.05, railH, depth - 0.06, depth, railOpts);
  block(b, f, u, v + 0.14 + railH - 0.05, w, 0.05, depth - 0.06, depth, railOpts);
  const n = Math.max(3, Math.round(w / 0.16));
  for (let i = 1; i < n; i++) {
    block(b, f, u + (w / n) * i - 0.012, v + 0.14, 0.024, railH - 0.05, depth - 0.045, depth - 0.02, railOpts);
  }
  // occasional plant or bundle on the balcony
  if (rng.bool(0.4)) {
    const pu = u + rng.range(0.15, Math.max(0.2, w - 0.4));
    block(b, f, pu, v + 0.14, 0.26, 0.24, depth - 0.4, depth - 0.14, { layer: LAYER.STUCCO_TERRACOTTA, tint: [0.9, 0.6, 0.45], wear: 0.6, uvScale: 1.6 });
  }
  ctx.balconies.push({ side, u: u + w * 0.5, v: v + 0.14, depth });
}

function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

/**
 * Generate a complete building into the supplied builders.
 * @param {object} opts
 *   builder      - GeometryBuilder for solid geometry (collision on)
 *   detail       - GeometryBuilder for facade detail (no collision)
 *   rng          - SeededRandom
 *   lot          - { x0, z0, x1, z1 }
 *   openSides    - [southOpen, eastOpen, northOpen, westOpen]
 *   floors, style
 */
export function generateBuilding(opts) {
  const { builder, detail, rng, lot, openSides, hollow = false } = opts;
  const x0 = Math.min(lot.x0, lot.x1), x1 = Math.max(lot.x0, lot.x1);
  const z0 = Math.min(lot.z0, lot.z1), z1 = Math.max(lot.z0, lot.z1);
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;

  const floors = opts.floors ?? rng.int(2, 3);
  const groundHeight = rng.range(3.3, 3.9);
  const floorHeight = rng.range(2.95, 3.35);
  const height = groundHeight + (floors - 1) * floorHeight;
  const parapet = rng.range(0.55, 1.1);
  const style = opts.style ?? rng.pick(WALL_STYLES);
  const wear = rng.range(0.35, 0.85);

  const ctx = {
    builder: detail, rng, style, floors, floorHeight, groundHeight, wear,
    allowDoors: true, allowShops: true,
    doorways: [], balconies: []
  };

  const enterable = hollow && w > 6.0 && d > 6.0;

  if (enterable) {
    // Upper mass only; the ground floor becomes a real walkable shell.
    const upperH = height - groundHeight;
    builder.addBox(cx, groundHeight + upperH * 0.5, cz, w, upperH, d, {
      layer: style.layer, tint: style.tint, wear, uvScale: 0.42,
      collide: true, surface: SURFACE.PLASTER
    });
  } else {
    builder.addBox(cx, height * 0.5, cz, w, height, d, {
      layer: style.layer, tint: style.tint, wear, uvScale: 0.42,
      collide: true, surface: SURFACE.PLASTER
    });
  }

  // ---- roof deck slightly inset, then parapet ring
  const roofTint = [0.86, 0.84, 0.80];
  builder.addBox(cx, height + 0.06, cz, w - 0.12, 0.12, d - 0.12, {
    layer: LAYER.CONCRETE, tint: roofTint, wear: 0.8, uvScale: 0.4, collide: true, surface: SURFACE.CONCRETE
  });
  const pt = rng.range(0.16, 0.26);
  detail.addBox(cx, height + parapet * 0.5, z0 + pt * 0.5, w, parapet, pt, { layer: style.layer, tint: mul(style.tint, 0.97), wear, uvScale: 0.45 });
  detail.addBox(cx, height + parapet * 0.5, z1 - pt * 0.5, w, parapet, pt, { layer: style.layer, tint: mul(style.tint, 0.97), wear, uvScale: 0.45 });
  detail.addBox(x0 + pt * 0.5, height + parapet * 0.5, cz, pt, parapet, d - pt * 2, { layer: style.layer, tint: mul(style.tint, 0.97), wear, uvScale: 0.45 });
  detail.addBox(x1 - pt * 0.5, height + parapet * 0.5, cz, pt, parapet, d - pt * 2, { layer: style.layer, tint: mul(style.tint, 0.97), wear, uvScale: 0.45 });
  builder.addCollisionBox(cx, height + parapet * 0.5, z0 + pt * 0.5, w, parapet, pt, SURFACE.PLASTER);
  builder.addCollisionBox(cx, height + parapet * 0.5, z1 - pt * 0.5, w, parapet, pt, SURFACE.PLASTER);
  builder.addCollisionBox(x0 + pt * 0.5, height + parapet * 0.5, cz, pt, parapet, d, SURFACE.PLASTER);
  builder.addCollisionBox(x1 - pt * 0.5, height + parapet * 0.5, cz, pt, parapet, d, SURFACE.PLASTER);

  // ---- facades
  const sides = [
    { n: new THREE.Vector3(0, 0, -1), o: new THREE.Vector3(x1, 0, z0), r: new THREE.Vector3(-1, 0, 0), len: w },
    { n: new THREE.Vector3(1, 0, 0), o: new THREE.Vector3(x1, 0, z1), r: new THREE.Vector3(0, 0, -1), len: d },
    { n: new THREE.Vector3(0, 0, 1), o: new THREE.Vector3(x0, 0, z1), r: new THREE.Vector3(1, 0, 0), len: w },
    { n: new THREE.Vector3(-1, 0, 0), o: new THREE.Vector3(x0, 0, z0), r: new THREE.Vector3(0, 0, 1), len: d }
  ];
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s < 4; s++) {
    if (!openSides[s]) continue;
    const side = sides[s];
    const origin = side.o.clone().addScaledVector(side.n, 0.012);
    const f = new Facade(origin, side.r, up, side.n, side.len, height);
    buildFacade(ctx, f, s);
  }

  // ---- roof clutter
  //
  // Sized and placed to be seen from the street, which is the only place
  // anybody looks at it from. There was always clutter up here; almost none of
  // it cleared the parapet, so every roofline still cut the sky as a hard
  // horizontal and the whole district read as a row of boxes. Everything is
  // taller now, and the tall silhouette-breakers are the common cases rather
  // than the rare ones.
  const rooftop = [];
  const clutterCount = rng.int(4, 8);
  for (let i = 0; i < clutterCount; i++) {
    const px = rng.range(x0 + 1.2, x1 - 1.2);
    const pz = rng.range(z0 + 1.2, z1 - 1.2);
    const kind = rng.next();
    if (kind < 0.32) {
      // water tank on a stand — the stand is what lifts it over the parapet
      const r = rng.range(0.5, 0.72);
      const hh = rng.range(1.2, 1.8);
      const stand = rng.range(0.7, 1.1);
      for (const [ox, oz] of [[-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7]]) {
        detail.addBox(px + ox, height + stand * 0.5, pz + oz, 0.08, stand, 0.08, {
          layer: LAYER.METAL_RUST, tint: [0.52, 0.5, 0.47], wear: 0.9, uvScale: 2
        });
      }
      detail.addBox(px, height + stand, pz, r * 1.7, 0.12, r * 1.7, { layer: LAYER.METAL_RUST, tint: [0.6, 0.6, 0.6], wear: 0.9, uvScale: 1.2 });
      detail.addCylinder(px, height + stand + 0.12, pz, r, r, hh, 12, { layer: LAYER.METAL_PAINTED, tint: rng.pick([[0.30, 0.42, 0.55], [0.65, 0.62, 0.55], [0.35, 0.38, 0.36]]), wear: 0.7, uvScale: 0.8 });
      builder.addCollisionBox(px, height + stand + 0.12 + hh * 0.5, pz, r * 1.8, hh, r * 1.8, SURFACE.METAL);
    } else if (kind < 0.52) {
      // roof access stair box
      const bw = rng.range(1.8, 2.6), bd = rng.range(1.7, 2.3), bh = rng.range(2.4, 3.1);
      detail.addBox(px, height + bh * 0.5, pz, bw, bh, bd, { layer: style.layer, tint: mul(style.tint, 0.95), wear, uvScale: 0.5 });
      builder.addCollisionBox(px, height + bh * 0.5, pz, bw, bh, bd, SURFACE.PLASTER);
    } else if (kind < 0.66) {
      // satellite dish
      const mh = rng.range(1.1, 1.8);
      detail.addCylinder(px, height + 0.12, pz, 0.05, 0.05, mh, 6, { layer: LAYER.METAL_RUST, tint: [0.6, 0.6, 0.6], wear: 0.8, uvScale: 2 });
      detail.addBlob(px + 0.22, height + 0.12 + mh, pz, 0.42, 0.42, 0.12, 12, 6, { layer: LAYER.METAL_PAINTED, tint: [0.9, 0.89, 0.86], wear: 0.5, uvScale: 1 });
    } else if (kind < 0.88) {
      // antenna mast with guy struts — the cheapest thing that breaks a
      // roofline, so it is the one that got taller and more common
      const mh = rng.range(3.2, 5.6);
      detail.addCylinder(px, height + 0.12, pz, 0.045, 0.02, mh, 5, { layer: LAYER.METAL_RUST, tint: [0.55, 0.55, 0.55], wear: 0.85, uvScale: 3 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + rng.next();
        detail.addTube([
          new THREE.Vector3(px, height + 0.12 + mh * 0.8, pz),
          new THREE.Vector3(px + Math.cos(a) * 1.1, height + 0.14, pz + Math.sin(a) * 1.1)
        ], 0.012, 3, { layer: LAYER.METAL_RUST, tint: [0.5, 0.5, 0.5], wear: 0.9, uvScale: 4 });
      }
    } else {
      // stacked crates / debris pile
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) {
        const s = rng.range(0.4, 0.7);
        detail.addBox(px + rng.range(-0.3, 0.3), height + 0.12 + s * 0.5 + k * s * 0.9, pz + rng.range(-0.3, 0.3), s, s * 0.8, s, {
          rotY: rng.range(0, Math.PI), layer: LAYER.WOOD, tint: [0.85, 0.78, 0.66], wear: 0.85, uvScale: 1.4
        });
      }
    }
    rooftop.push({ x: px, y: height + 0.12, z: pz });
  }

  // ---- walkable ground floor for the buildings flagged as enterable
  let interior = null;
  if (enterable) {
    interior = buildInteriorShell({ builder, detail, rng, x0, z0, x1, z1, groundHeight, openSides, style, wear });
  }

  return {
    cx, cz, x0, z0, x1, z1, width: w, depth: d, height, floors,
    style, doorways: ctx.doorways, balconies: ctx.balconies, rooftop, interior
  };
}

/**
 * Ground-floor shell for enterable buildings: perimeter walls with one or two
 * doorways, a tiled floor, and a little dressing so the room reads as a real
 * space when you glance through the opening.
 */
function buildInteriorShell({ builder, detail, rng, x0, z0, x1, z1, groundHeight, openSides, style, wear }) {
  const T = 0.44;                    // wall thickness
  const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
  const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
  const iw = ix1 - ix0, id = iz1 - iz0;
  const ceil = groundHeight;

  detail.addBox(cx, 0.06, cz, iw, 0.12, id, {
    layer: LAYER.TILE, tint: [0.78, 0.76, 0.72], wear: 0.8, uvScale: 0.9,
    collide: true, surface: SURFACE.TILE
  });

  const outerOpts = { layer: style.layer, tint: style.tint, wear, uvScale: 0.42 };
  // wall segments: [centerX, centerZ, sizeX, sizeZ, sideIndex, spanAxis]
  const walls = [
    { px: cx, pz: z0 + T * 0.5, sx: x1 - x0, sz: T, side: 0, axis: 'x' },
    { px: x1 - T * 0.5, pz: cz, sx: T, sz: z1 - z0 - T * 2, side: 1, axis: 'z' },
    { px: cx, pz: z1 - T * 0.5, sx: x1 - x0, sz: T, side: 2, axis: 'x' },
    { px: x0 + T * 0.5, pz: cz, sx: T, sz: z1 - z0 - T * 2, side: 3, axis: 'z' }
  ];

  const entrances = [];
  const candidates = [];
  for (let i = 0; i < 4; i++) if (openSides[i]) candidates.push(i);
  const openingSides = new Set();
  if (candidates.length) {
    openingSides.add(rng.pick(candidates));
    if (candidates.length > 1 && rng.bool(0.55)) {
      const second = rng.pick(candidates);
      if (second !== undefined) openingSides.add(second);
    }
  }

  for (const wdef of walls) {
    const span = wdef.axis === 'x' ? wdef.sx : wdef.sz;
    if (!openingSides.has(wdef.side) || span < 4.0) {
      detail.addBox(wdef.px, ceil * 0.5, wdef.pz, wdef.sx, ceil, wdef.sz, outerOpts);
      builder.addCollisionBox(wdef.px, ceil * 0.5, wdef.pz, wdef.sx, ceil, wdef.sz, SURFACE.PLASTER);
      continue;
    }
    const gap = 1.75;
    const seg = (span - gap) * 0.5;
    for (const sign of [-1, 1]) {
      const off = sign * (gap * 0.5 + seg * 0.5);
      const px = wdef.axis === 'x' ? wdef.px + off : wdef.px;
      const pz = wdef.axis === 'x' ? wdef.pz : wdef.pz + off;
      const sx = wdef.axis === 'x' ? seg : wdef.sx;
      const sz = wdef.axis === 'x' ? wdef.sz : seg;
      detail.addBox(px, ceil * 0.5, pz, sx, ceil, sz, outerOpts);
      builder.addCollisionBox(px, ceil * 0.5, pz, sx, ceil, sz, SURFACE.PLASTER);
    }
    const headerH = ceil - 2.25;
    const hw = wdef.axis === 'x' ? gap : wdef.sx;
    const hd = wdef.axis === 'x' ? wdef.sz : gap;
    detail.addBox(wdef.px, ceil - headerH * 0.5, wdef.pz, hw, headerH, hd, outerOpts);
    builder.addCollisionBox(wdef.px, ceil - headerH * 0.5, wdef.pz, hw, headerH, hd, SURFACE.PLASTER);
    entrances.push({ x: wdef.px, z: wdef.pz, side: wdef.side });
  }

  // inner wall faces so the room does not show the outside texture inward
  const innerOpts = { layer: LAYER.PLASTER_WHITE, tint: [0.70, 0.68, 0.64], wear: 0.9, uvScale: 0.6 };
  detail.addBox(cx, ceil * 0.5, iz0 + 0.02, iw, ceil, 0.04, innerOpts);
  detail.addBox(cx, ceil * 0.5, iz1 - 0.02, iw, ceil, 0.04, innerOpts);
  detail.addBox(ix0 + 0.02, ceil * 0.5, cz, 0.04, ceil, id, innerOpts);
  detail.addBox(ix1 - 0.02, ceil * 0.5, cz, 0.04, ceil, id, innerOpts);
  detail.addBox(cx, ceil - 0.03, cz, iw, 0.06, id, {
    layer: LAYER.CONCRETE, tint: [0.5, 0.49, 0.47], wear: 0.85, uvScale: 0.6
  });

  // interior dressing: shelving, a counter, hanging cloth, a stair stub
  const props = rng.int(2, 4);
  for (let i = 0; i < props; i++) {
    const px = rng.range(ix0 + 0.7, ix1 - 0.7);
    const pz = rng.range(iz0 + 0.7, iz1 - 0.7);
    const kind = rng.next();
    if (kind < 0.4) {
      for (let sIdx = 0; sIdx < 3; sIdx++) {
        detail.addBox(px, 0.5 + sIdx * 0.62, pz, 1.5, 0.06, 0.42, { rotY: rng.range(0, 3.14), layer: LAYER.WOOD, tint: [0.6, 0.5, 0.38], wear: 0.8, uvScale: 1.2 });
      }
    } else if (kind < 0.7) {
      detail.addBox(px, 0.45, pz, 1.7, 0.9, 0.6, { rotY: rng.range(0, 3.14), layer: LAYER.WOOD, tint: [0.55, 0.45, 0.34], wear: 0.85, uvScale: 1.1 });
      builder.addCollisionBox(px, 0.45, pz, 1.7, 0.9, 0.7, SURFACE.WOOD);
    } else {
      detail.addBox(px, 0.55, pz, 0.7, 1.1, 0.7, { rotY: rng.range(0, 3.14), layer: LAYER.SANDBAG, tint: [0.9, 0.85, 0.75], wear: 0.9, uvScale: 1.0 });
      builder.addCollisionBox(px, 0.55, pz, 0.8, 1.1, 0.8, SURFACE.SANDBAG);
    }
  }

  return { x0: ix0, z0: iz0, x1: ix1, z1: iz1, ceil, entrances, center: { x: cx, z: cz }, walkable: true };
}
