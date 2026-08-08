import * as THREE from 'three';
import { SeededRandom, WORLD_SEED } from '../core/SeededRandom.js';
import { TriangleSoup, SURFACE } from '../physics/BVH.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { LAYER } from './MaterialLibrary.js';
import { generateBuilding, WALL_STYLES } from './Buildings.js';
import * as Props from './Props.js';
import { fbm2, smoothstep } from './Noise.js';

/**
 * "Dust Corridor" — one hand-shaped market district, assembled deterministically
 * from a fixed world seed.
 *
 *      +Z (north)  spawn B / plaza with the monumental arch
 *   ---------------------------------------------------------
 *   |  outer row |alley|  inner row |  MARKET STREET  | ...  |
 *   ---------------------------------------------------------
 *      -Z (south)  spawn A
 *
 * The long central street gives the reference's forward sightline, the two
 * alleys give flanks, the covered market lane breaks the middle into short
 * fights, and the plaza anchors the north end.
 */

export const MAP = {
  streetHalf: 7.0,
  sidewalkOuter: 10.2,
  innerRow: { x0: 10.0, x1: 24.0 },
  alley: { x0: 24.0, x1: 28.6 },
  outerRow: { x0: 28.6, x1: 43.0 },
  boundary: 48.0,
  zMin: -76,
  zMax: 76,
  crossAlleys: [[-35, -29.5], [13.5, 19]],
  plaza: { z0: 35, z1: 62, x0: -20, x1: 20 },
  archZ: 47,
  marketLane: [-19, 12],
  spawnA: { z: -66 },
  spawnB: { z: 66 }
};

export function groundHeightAt(x, z) {
  const ax = Math.abs(x);
  let y = 0;

  // road crown and gutters along the main street
  const onRoad = 1 - smoothstep(6.2, 7.4, ax);
  y += 0.055 * onRoad * (1 - Math.pow(Math.min(ax, 7) / 7, 2));
  y -= 0.06 * smoothstep(5.9, 7.0, ax) * (1 - smoothstep(7.0, 7.7, ax));

  // raised sidewalks
  y += 0.155 * smoothstep(7.35, 7.95, ax) * (1 - smoothstep(9.8, 10.4, ax));

  // alley slabs sit slightly high
  y += 0.09 * smoothstep(23.4, 24.4, ax) * (1 - smoothstep(28.2, 29.2, ax));

  // plaza is a shallow dished court
  const inPlaza = smoothstep(33, 37, z) * (1 - smoothstep(60, 64, z)) * (1 - smoothstep(17, 21, ax));
  y += inPlaza * (0.1 - 0.14 * (1 - Math.pow(Math.min(ax, 18) / 18, 2)));

  // broken asphalt, sand drifts, settling
  y += (fbm2(x * 0.09, z * 0.09, 4, 0.5) - 0.5) * 0.09;
  y += (fbm2(x * 0.42 + 40, z * 0.42 - 12, 3, 0.5) - 0.5) * 0.035;
  const drift = smoothstep(9.5, 13.0, ax) * (1 - smoothstep(20, 24, ax));
  y += drift * fbm2(x * 0.2, z * 0.2, 3, 0.6) * 0.09;

  return y;
}

function groundLayerAt(x, z) {
  const ax = Math.abs(x);
  const sand = fbm2(x * 0.06 + 3, z * 0.06 - 7, 3, 0.6);
  if (ax < 7.2) return sand > 0.66 ? LAYER.SAND : LAYER.ASPHALT;
  if (ax < 10.3) return LAYER.CONCRETE;
  if (z > MAP.plaza.z0 && z < MAP.plaza.z1 && ax < 20) return sand > 0.58 ? LAYER.SAND : LAYER.CONCRETE;
  if (ax > 23.4 && ax < 29.2) return sand > 0.6 ? LAYER.SAND : LAYER.ASPHALT;
  return sand > 0.48 ? LAYER.SAND : LAYER.GRAVEL;
}

/**
 * Ground colour. Three scales, because one was not enough.
 *
 * A single low-frequency noise over the whole district gives a soft blotch
 * that reads as a cloud layer rather than as ground, and the road and the
 * plaza came out as one flat tan across half the frame. A metre-scale band
 * breaks the large shapes, a decimetre-scale band gives it grain at the
 * distance a player actually stands, and the wheel ruts either side of the
 * road crown darken and desaturate the way packed earth does against the
 * loose sand that drifts to the kerbs.
 */
function groundTintAt(x, z) {
  const broad = fbm2(x * 0.13 - 11, z * 0.13 + 5, 3, 0.55);
  const fine = fbm2(x * 0.85 + 23, z * 0.85 - 17, 2, 0.5);
  let k = 0.84 + broad * 0.30 + (fine - 0.5) * 0.11;

  // Two ruts where traffic runs, packed darker than the drifted edges.
  const ax = Math.abs(x);
  const rut = Math.exp(-Math.pow((ax - 3.4) / 1.5, 2));
  const wander = (fbm2(z * 0.05, 0, 2, 0.5) - 0.5) * 0.5;
  const packed = rut * (0.75 + wander) * (1 - smoothstep(6.6, 8.0, ax));
  k *= 1 - packed * 0.17;

  // Packed ground is cooler as well as darker; loose sand keeps its warmth.
  return [k, k * (0.995 - packed * 0.012), k * (0.97 + packed * 0.03)];
}

/** Subdivide a band of Z into building lots, skipping the supplied gaps. */
function subdivideLots(z0, z1, gaps, rng, minLot = 8.5, maxLot = 16) {
  const lots = [];
  let z = z0;
  while (z < z1 - 3) {
    let len = rng.range(minLot, maxLot);
    let end = Math.min(z + len, z1);
    // clip against gaps
    let clipped = false;
    for (const [g0, g1] of gaps) {
      if (z < g1 && end > g0) {
        if (z >= g0 - 0.01) { z = g1; clipped = true; break; }
        end = g0;
      }
    }
    if (clipped) continue;
    if (end - z >= 5.5) lots.push([z, end - rng.range(0.15, 0.5)]);
    z = end + rng.range(0.1, 0.4);
  }
  return lots;
}

function mulTint(t, k) { return [t[0] * k, t[1] * k, t[2] * k]; }

function lotOpenSides(z0, z1, gaps, bandZ0, bandZ1) {
  const nearGap = (z) => gaps.some(([g0, g1]) => Math.abs(z - g0) < 1.2 || Math.abs(z - g1) < 1.2);
  return [
    nearGap(z0) || z0 <= bandZ0 + 1.5,
    true,
    nearGap(z1) || z1 >= bandZ1 - 1.5,
    true
  ];
}

export class MapGenerator {
  constructor(seed = WORLD_SEED) {
    this.seed = seed;
    this.rng = new SeededRandom(seed);
  }

  generate() {
    const rng = this.rng;
    const soup = new TriangleSoup(60000);

    const ground = new GeometryBuilder(soup, 'ground');
    const structure = new GeometryBuilder(soup, 'structure');
    const detail = new GeometryBuilder(null, 'detail');
    const props = new GeometryBuilder(soup, 'props');
    const clutter = new GeometryBuilder(null, 'clutter');

    const cloth = [];
    const cables = [];
    const coverPoints = [];
    const buildings = [];
    const interiors = [];
    const ambientEmitters = [];

    // ---------------------------------------------------------------- ground
    ground.addGroundGrid(-MAP.boundary - 4, MAP.zMin - 4, MAP.boundary + 4, MAP.zMax + 4, 168, groundHeightAt, {
      uvScale: 0.5, wear: 0.7, collide: true, surface: SURFACE.CONCRETE,
      layerFn: groundLayerAt, tintFn: groundTintAt
    });

    // ------------------------------------------------------------- buildings
    const rowRng = rng.fork(11);
    const bandGaps = MAP.crossAlleys;

    const bands = [];
    for (const sign of [1, -1]) {
      // inner rows are interrupted by the plaza
      const innerX0 = sign > 0 ? MAP.innerRow.x0 : -MAP.innerRow.x1;
      const innerX1 = sign > 0 ? MAP.innerRow.x1 : -MAP.innerRow.x0;
      bands.push({ x0: innerX0, x1: innerX1, z0: MAP.zMin, z1: MAP.plaza.z0, gaps: bandGaps, inner: true, sign });
      bands.push({ x0: innerX0, x1: innerX1, z0: MAP.plaza.z1, z1: MAP.zMax, gaps: [], inner: true, sign });
      const outerX0 = sign > 0 ? MAP.outerRow.x0 : -MAP.outerRow.x1;
      const outerX1 = sign > 0 ? MAP.outerRow.x1 : -MAP.outerRow.x0;
      bands.push({ x0: outerX0, x1: outerX1, z0: MAP.zMin, z1: MAP.zMax, gaps: bandGaps, inner: false, sign });
    }

    let hollowBudget = 6;
    for (const band of bands) {
      const lots = subdivideLots(band.z0, band.z1, band.gaps, rowRng);
      for (const [lz0, lz1] of lots) {
        const depth = band.x1 - band.x0;
        const shrinkFront = band.inner ? 0 : rowRng.range(0, 2.2);
        const lot = band.sign > 0
          ? { x0: band.x0 + shrinkFront, x1: band.x1, z0: lz0, z1: lz1 }
          : { x0: band.x0, x1: band.x1 - shrinkFront, z0: lz0, z1: lz1 };

        const openSides = lotOpenSides(lz0, lz1, band.gaps, band.z0, band.z1);
        // the side facing the street / alley is always detailed
        if (band.sign > 0) { openSides[3] = true; openSides[1] = true; }
        else { openSides[1] = true; openSides[3] = true; }

        const wantHollow = band.inner && hollowBudget > 0 && rowRng.bool(0.34) && (lz1 - lz0) > 9;
        if (wantHollow) hollowBudget--;

        const b = generateBuilding({
          builder: structure,
          detail,
          rng: rowRng,
          lot,
          openSides,
          floors: rowRng.next() < 0.42 ? 2 : 3,
          hollow: wantHollow,
          style: WALL_STYLES[rowRng.int(0, WALL_STYLES.length - 1)]
        });
        buildings.push(b);
        if (b.interior) interiors.push(b.interior);
        void depth;

        // cover at the building corners facing open space
        coverPoints.push(
          { x: band.sign > 0 ? lot.x0 - 0.9 : lot.x1 + 0.9, z: lz0 + 0.8, type: 'corner', height: 1.9 },
          { x: band.sign > 0 ? lot.x0 - 0.9 : lot.x1 + 0.9, z: lz1 - 0.8, type: 'corner', height: 1.9 }
        );
      }
    }

    // ---------------------------------------------------- perimeter enclosure
    this._buildBoundary(structure, detail, rng.fork(21));

    // ------------------------------------------------------------ plaza arch
    Props.monumentalArch(structure, 0, groundHeightAt(0, MAP.archZ), MAP.archZ, 0, rng.fork(33), 11.5, 8.8);
    coverPoints.push(
      { x: -6.2, z: MAP.archZ, type: 'pier', height: 2.2 },
      { x: 6.2, z: MAP.archZ, type: 'pier', height: 2.2 }
    );

    // ------------------------------------------------------- street dressing
    this._dressStreet(props, clutter, cloth, cables, coverPoints, ambientEmitters, rng.fork(41), buildings);
    this._dressAlleys(props, clutter, cloth, coverPoints, rng.fork(53));
    this._dressPlaza(props, clutter, cloth, coverPoints, rng.fork(67));
    this._scatterGround(clutter, rng.fork(79));
    this._stringCables(cables, cloth, rng.fork(83), buildings);

    // ------------------------------------------------------------- spawns
    const spawnRng = rng.fork(97);
    const spawnsA = [];
    const spawnsB = [];
    for (let i = 0; i < 8; i++) {
      const sx = spawnRng.range(-14, 14);
      spawnsA.push(new THREE.Vector3(sx, groundHeightAt(sx, MAP.spawnA.z + spawnRng.range(-5, 5)) + 0.05, MAP.spawnA.z + spawnRng.range(-5, 5)));
      const bx = spawnRng.range(-14, 14);
      spawnsB.push(new THREE.Vector3(bx, groundHeightAt(bx, MAP.spawnB.z + spawnRng.range(-5, 5)) + 0.05, MAP.spawnB.z + spawnRng.range(-5, 5)));
    }
    // extra flank spawns in the alleys
    for (const sx of [-26.3, 26.3]) {
      spawnsA.push(new THREE.Vector3(sx, groundHeightAt(sx, -58) + 0.05, -58));
      spawnsB.push(new THREE.Vector3(sx, groundHeightAt(sx, 58) + 0.05, 58));
    }

    return {
      soup,
      batches: [ground, structure, detail, props, clutter].filter((b) => !b.isEmpty()),
      cloth, cables, coverPoints, buildings, interiors, ambientEmitters,
      spawns: { A: spawnsA, B: spawnsB },
      bounds: new THREE.Box3(
        new THREE.Vector3(-MAP.boundary, -2, MAP.zMin),
        new THREE.Vector3(MAP.boundary, 30, MAP.zMax)
      ),
      // The match happens between the outer building rows. The strip behind
      // them, up to the boundary wall, is walkable but not somewhere to start.
      playBounds: {
        x0: -MAP.outerRow.x1, x1: MAP.outerRow.x1,
        z0: MAP.zMin + 2, z1: MAP.zMax - 2
      },
      triangleCount: soup.count
    };
  }

  /** Solid perimeter so the player can never see or walk off the district. */
  _buildBoundary(structure, detail, rng) {
    const B = MAP.boundary;
    const zMin = MAP.zMin, zMax = MAP.zMax;
    for (const sign of [1, -1]) {
      let z = zMin;
      while (z < zMax) {
        const len = rng.range(11, 20);
        const end = Math.min(z + len, zMax);
        const h = rng.range(7.5, 13.5);
        const style = WALL_STYLES[rng.int(0, WALL_STYLES.length - 1)];
        structure.addBox(sign * (B + 3), h * 0.5, (z + end) * 0.5, 8, h, end - z - 0.3, {
          layer: style.layer, tint: style.tint, wear: rng.range(0.5, 0.9), uvScale: 0.4,
          collide: true, surface: SURFACE.PLASTER
        });
        detail.addBox(sign * (B - 0.9), h * 0.5 + 0.5, (z + end) * 0.5, 0.5, 1.0, end - z - 0.3, {
          layer: LAYER.CONCRETE, tint: [0.86, 0.84, 0.8], wear: 0.85, uvScale: 0.5
        });
        z = end;
      }
    }
    for (const sign of [1, -1]) {
      const zc = sign > 0 ? zMax + 4 : zMin - 4;
      structure.addBox(0, 7, zc, (B + 8) * 2, 14, 10, {
        layer: LAYER.PLASTER_BEIGE, tint: [0.88, 0.85, 0.79], wear: 0.8, uvScale: 0.4,
        collide: true, surface: SURFACE.PLASTER
      });
    }

    // The town continues past the walls. Without a skyline every sightline
    // ends in a bare plaster slab and the district reads as an arena floating
    // in nothing; a couple of rings of rough blocks with rooftop bumps, hazed
    // out by aerial perspective, sell twenty streets that do not exist. No
    // collision — nothing playable happens out there.
    this._buildSkyline(detail, rng.fork(7));

    // invisible ceiling so nothing can escape over the rooftops
    structure.addCollisionBox(0, 34, 0, (B + 10) * 2, 1, (zMax - zMin) + 20, SURFACE.CONCRETE);
  }

  _buildSkyline(detail, rng) {
    const B = MAP.boundary;
    const zMin = MAP.zMin, zMax = MAP.zMax;

    // Two depth rings: nearer blocks peek over the boundary wall, a farther
    // taller ring layers behind them so the edge has parallax.
    for (const ring of [
      { off: 14, hMin: 9, hMax: 17, step: [10, 18] },
      { off: 34, hMin: 14, hMax: 26, step: [14, 26] }
    ]) {
      const lo = zMin - ring.off - 20, hi = zMax + ring.off + 20;
      // rows running parallel to the map's long axis, one each side
      for (const sign of [1, -1]) {
        let z = lo;
        while (z < hi) {
          const len = rng.range(ring.step[0], ring.step[1]);
          this._skylineBlock(detail, rng, sign * (B + ring.off), (z + len * 0.5), len, ring);
          z += len + rng.range(1, 6);
        }
      }
      // and rows closing off both ends of the street
      for (const zc of [zMax + ring.off, zMin - ring.off]) {
        let x = -B - ring.off;
        while (x < B + ring.off) {
          const len = rng.range(ring.step[0], ring.step[1]);
          this._skylineBlock(detail, rng, x + len * 0.5, zc, len, ring, true);
          x += len + rng.range(1, 6);
        }
      }
    }
  }

  _skylineBlock(detail, rng, x, z, len, ring, rotated = false) {
    const h = rng.range(ring.hMin, ring.hMax);
    const depth = rng.range(7, 12);
    const style = WALL_STYLES[rng.int(0, WALL_STYLES.length - 1)];
    const w = rotated ? len : depth;
    const d = rotated ? depth : len;
    detail.addBox(x, h * 0.5, z, w, h, d, {
      layer: style.layer, tint: mulTint(style.tint, rng.range(0.82, 1.0)),
      wear: rng.range(0.5, 0.95), uvScale: 0.35
    });
    // rooftop bumps: stair boxes and tanks as plain silhouette breakers
    const bumps = rng.int(0, 2);
    for (let i = 0; i < bumps; i++) {
      const bw = rng.range(1.5, 3.2), bh = rng.range(1.4, 2.8);
      detail.addBox(
        x + rng.range(-w * 0.3, w * 0.3), h + bh * 0.5, z + rng.range(-d * 0.3, d * 0.3),
        bw, bh, bw * rng.range(0.7, 1.2),
        { layer: style.layer, tint: mulTint(style.tint, 0.92), wear: 0.8, uvScale: 0.5 }
      );
    }
  }

  /** Market street: stalls, awnings, barriers, vehicles, lamps, cover rhythm. */
  _dressStreet(props, clutter, cloth, cables, cover, emitters, rng, buildings) {
    const [laneZ0, laneZ1] = MAP.marketLane;

    // covered market lane: stalls under a run of awnings on both sides
    for (const sign of [1, -1]) {
      let z = laneZ0;
      while (z < laneZ1) {
        const gap = rng.range(3.0, 4.6);
        const x = sign * rng.range(4.4, 6.3);
        const y = groundHeightAt(x, z);
        const stall = Props.marketStall(props, cloth, x, y, z, sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, rng,
          rng.range(2.3, 3.2), rng.range(1.5, 2.1));
        cover.push({ x: stall.x, z: stall.z, type: 'stall', height: 1.0 });
        z += gap;
      }
      // Overhead canopy spanning between the stall line and the facade.
      //
      // These used to be a row of identical quads at exactly 3.25m on
      // identical posts — a stamped pattern rather than cloth, and high enough
      // above the counters that the band between the two read as a hollow
      // void on stilts. Height, span, sag and post material all vary per bay
      // now, and the canopies hang lower, so the shade actually belongs to the
      // stall underneath it.
      for (let cz = laneZ0; cz < laneZ1; cz += rng.range(4.0, 6.2)) {
        const h = rng.range(2.45, 2.95);
        const cx = sign * rng.range(7.8, 8.6);
        cloth.push({
          type: 'awning',
          center: new THREE.Vector3(cx, groundHeightAt(cx, cz) + h, cz),
          width: rng.range(3.0, 4.2), depth: rng.range(2.6, 5.2),
          rotY: rng.range(-0.09, 0.09),
          sag: rng.range(0.22, 0.46),
          tint: rng.pick(Props.PROP_TINTS.FABRIC_TINTS),
          amplitude: rng.range(0.03, 0.09), phase: rng.range(0, 6.28)
        });
        // Support posts: mixed timber and bent conduit, leaning a little.
        for (const s of [-1, 1]) {
          const timber = rng.bool(0.45);
          const px = sign * rng.range(9.3, 9.9);
          const pz = cz + s * rng.range(1.3, 1.9);
          const ph = h + rng.range(-0.12, 0.1);
          props.addBox(px, groundHeightAt(px, pz) + ph * 0.5, pz,
            timber ? 0.11 : 0.075, ph, timber ? 0.11 : 0.075, {
              rotY: rng.range(-0.05, 0.05),
              layer: timber ? LAYER.WOOD : LAYER.METAL_PAINTED,
              tint: timber ? [0.62, 0.5, 0.36] : [0.5, 0.5, 0.48],
              wear: rng.range(0.7, 0.95), uvScale: 2,
              collide: true, surface: timber ? SURFACE.WOOD : SURFACE.METAL
            });
        }
        // A guy line back to the facade, so the canopy is tied to something.
        if (rng.bool(0.6)) {
          cables.push({
            a: new THREE.Vector3(sign * 9.6, groundHeightAt(sign * 9.6, cz) + h, cz),
            b: new THREE.Vector3(sign * 10.2, groundHeightAt(sign * 10.2, cz) + h + rng.range(0.8, 1.6), cz + rng.range(-0.5, 0.5)),
            sag: rng.range(0.02, 0.08),
            amplitude: rng.range(0.004, 0.012), phase: rng.range(0, 6.28),
            radius: rng.range(0.008, 0.014)
          });
        }
      }
    }

    // cover rhythm down the street
    const barrierZones = [
      [-62, -46], [-40, -24], [-14, 4], [20, 33], [40, 58]
    ];
    for (const [z0, z1] of barrierZones) {
      const count = rng.int(3, 6);
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        const z = z0 + (z1 - z0) * t + rng.range(-1.5, 1.5);
        const x = rng.range(-5.6, 5.6);
        const y = groundHeightAt(x, z);
        const kind = rng.next();
        if (kind < 0.42) {
          const rot = rng.bool(0.7) ? rng.range(-0.25, 0.25) : Math.PI * 0.5 + rng.range(-0.3, 0.3);
          const c = Props.jerseyBarrier(props, x, y, z, rot, rng, rng.range(2.0, 2.8));
          cover.push({ ...c, type: 'barrier' });
        } else if (kind < 0.6) {
          const c = Props.sandbagWall(props, x, y, z, rng.range(0, Math.PI), rng, rng.range(1.8, 3.0), rng.int(2, 4));
          cover.push({ ...c, type: 'sandbags' });
        } else if (kind < 0.74) {
          const c = Props.crateStack(props, x, y, z, rng.range(0, Math.PI), rng, rng.int(2, 4));
          cover.push({ ...c, type: 'crates' });
        } else if (kind < 0.86) {
          Props.metalDrum(props, x, y, z, rng);
          if (rng.bool(0.6)) Props.metalDrum(props, x + rng.range(0.55, 0.8), y, z + rng.range(-0.4, 0.4), rng);
          cover.push({ x, z, type: 'drums', height: 0.9 });
        } else {
          const c = Props.barricade(props, x, y, z, rng.range(0, Math.PI), rng);
          cover.push({ ...c, type: 'barricade' });
        }
      }
    }

    // parked vehicles pushed to the kerb
    const vehicleSpots = [-56, -38, -21, 8, 26, 41, 55];
    for (const z of vehicleSpots) {
      if (rng.bool(0.25)) continue;
      const sign = rng.bool() ? 1 : -1;
      const x = sign * rng.range(4.2, 5.6);
      const rot = (sign > 0 ? -Math.PI * 0.5 : Math.PI * 0.5) + rng.range(-0.18, 0.18);
      const v = Props.utilityVehicle(props, x, groundHeightAt(x, z), z + rng.range(-2, 2), rot, rng);
      cover.push({ ...v, type: 'vehicle' });
    }

    // lamp posts and handcarts along the sidewalks
    for (let z = MAP.zMin + 12; z < MAP.zMax - 12; z += rng.range(16, 26)) {
      const sign = rng.bool() ? 1 : -1;
      const x = sign * 8.6;
      Props.lampPost(props, x, groundHeightAt(x, z), z, rng, sign > 0 ? Math.PI : 0);
      emitters.push({ type: 'lamp', position: new THREE.Vector3(x, groundHeightAt(x, z) + 4.6, z) });
    }
    for (let i = 0; i < 8; i++) {
      const sign = rng.bool() ? 1 : -1;
      const x = sign * rng.range(6.2, 8.2);
      const z = rng.range(MAP.zMin + 14, MAP.zMax - 14);
      Props.handcart(props, x, groundHeightAt(x, z), z, rng.range(0, Math.PI * 2), rng);
      cover.push({ x, z, type: 'cart', height: 0.9 });
    }

    // palms and shrubs
    for (let i = 0; i < 11; i++) {
      const sign = rng.bool() ? 1 : -1;
      const x = sign * rng.range(8.0, 9.6);
      const z = rng.range(MAP.zMin + 10, MAP.zMax - 10);
      if (z > MAP.plaza.z0 && z < MAP.plaza.z1) continue;
      Props.palmTree(props, cloth, x, groundHeightAt(x, z), z, rng);
    }
    for (let i = 0; i < 46; i++) {
      const x = rng.range(-9.8, 9.8);
      const z = rng.range(MAP.zMin + 6, MAP.zMax - 6);
      if (Math.abs(x) < 7.2 && rng.bool(0.7)) continue;
      Props.shrub(clutter, x, groundHeightAt(x, z), z, rng, rng.range(0.6, 1.3));
    }

    // laundry lines between facing balconies
    const balconyOwners = buildings.filter((b) => b.balconies.length > 0);
    for (let i = 0; i < Math.min(10, balconyOwners.length); i++) {
      const b = balconyOwners[rng.int(0, balconyOwners.length - 1)];
      const bal = b.balconies[rng.int(0, b.balconies.length - 1)];
      void bal;
      const z = rng.range(b.z0 + 1, b.z1 - 1);
      const y = rng.range(4.2, 7.5);
      const x0 = b.cx > 0 ? b.x0 - 0.2 : b.x1 + 0.2;
      const x1 = b.cx > 0 ? Math.max(7.6, b.x0 - rng.range(3, 6.5)) : Math.min(-7.6, b.x1 + rng.range(3, 6.5));
      cloth.push({
        type: 'laundry',
        a: new THREE.Vector3(x0, y, z),
        b: new THREE.Vector3(x1, y - rng.range(-0.4, 0.6), z),
        items: rng.int(3, 7),
        tint: rng.pick(Props.PROP_TINTS.FABRIC_TINTS),
        amplitude: rng.range(0.06, 0.16),
        phase: rng.range(0, 6.28),
        seed: rng.next()
      });
    }
    void cables;
  }

  _dressAlleys(props, clutter, cloth, cover, rng) {
    for (const sign of [1, -1]) {
      const cx = sign * (MAP.alley.x0 + MAP.alley.x1) * 0.5;
      for (let z = MAP.zMin + 8; z < MAP.zMax - 8; z += rng.range(5, 11)) {
        const x = cx + rng.range(-1.4, 1.4);
        const y = groundHeightAt(x, z);
        const kind = rng.next();
        if (kind < 0.22) {
          Props.metalDrum(props, x, y, z, rng);
          cover.push({ x, z, type: 'drum', height: 0.9 });
        } else if (kind < 0.4) {
          const c = Props.crateStack(props, x, y, z, rng.range(0, Math.PI), rng, rng.int(1, 3));
          cover.push({ ...c, type: 'crates' });
        } else if (kind < 0.54) {
          Props.palletStack(props, x, y, z, rng.range(0, Math.PI), rng);
        } else if (kind < 0.66) {
          Props.tireStack(props, x, y, z, rng, rng.int(2, 4));
        } else if (kind < 0.76) {
          const c = Props.sandbagWall(props, x, y, z, sign > 0 ? 0 : Math.PI, rng, rng.range(1.6, 2.4), rng.int(2, 3));
          cover.push({ ...c, type: 'sandbags' });
        } else if (kind < 0.86) {
          Props.rubblePile(props, x, y, z, rng, rng.range(0.8, 1.6));
          cover.push({ x, z, type: 'rubble', height: 0.5 });
        } else {
          Props.propaneCylinder(props, x, y, z, rng);
          Props.shrub(clutter, x + rng.range(-0.6, 0.6), y, z + rng.range(-0.6, 0.6), rng, 0.8);
        }
      }
      // narrow cloth strung across the alley
      for (let z = MAP.zMin + 16; z < MAP.zMax - 16; z += rng.range(14, 26)) {
        cloth.push({
          type: 'laundry',
          a: new THREE.Vector3(sign * (MAP.alley.x0 + 0.4), rng.range(3.6, 6.4), z),
          b: new THREE.Vector3(sign * (MAP.alley.x1 - 0.4), rng.range(3.6, 6.4), z + rng.range(-0.6, 0.6)),
          items: rng.int(2, 5),
          tint: rng.pick(Props.PROP_TINTS.FABRIC_TINTS),
          amplitude: rng.range(0.08, 0.2),
          phase: rng.range(0, 6.28),
          seed: rng.next()
        });
      }
    }
  }

  _dressPlaza(props, clutter, cloth, cover, rng) {
    const { z0, z1 } = MAP.plaza;
    // ring of low walls and planters framing the court
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rx = 14 + rng.range(-2.5, 2.5);
      const rz = 10 + rng.range(-2.5, 2.5);
      const x = Math.cos(a) * rx;
      const z = (z0 + z1) * 0.5 + Math.sin(a) * rz;
      if (Math.abs(z - MAP.archZ) < 4 && Math.abs(x) < 8) continue;
      const y = groundHeightAt(x, z);
      const kind = rng.next();
      if (kind < 0.35) {
        const c = Props.jerseyBarrier(props, x, y, z, a + Math.PI * 0.5, rng, rng.range(2.0, 2.6));
        cover.push({ ...c, type: 'barrier' });
      } else if (kind < 0.6) {
        props.addBox(x, y + 0.42, z, rng.range(1.2, 2.0), 0.84, rng.range(0.7, 1.1), {
          rotY: a, layer: LAYER.CONCRETE, tint: [0.92, 0.89, 0.84], wear: 0.85, uvScale: 0.7,
          collide: true, surface: SURFACE.CONCRETE
        });
        Props.shrub(clutter, x, y + 0.84, z, rng, 0.9);
        cover.push({ x, z, type: 'planter', height: 0.9 });
      } else if (kind < 0.8) {
        const c = Props.sandbagWall(props, x, y, z, a, rng, rng.range(2.0, 3.2), rng.int(2, 4));
        cover.push({ ...c, type: 'sandbags' });
      } else {
        Props.rubblePile(props, x, y, z, rng, rng.range(1.0, 2.0));
      }
    }
    // a couple of market stalls in the plaza corners
    for (let i = 0; i < 5; i++) {
      const x = rng.range(-16, 16);
      const z = rng.range(z0 + 4, z1 - 4);
      if (Math.abs(z - MAP.archZ) < 5) continue;
      Props.marketStall(props, cloth, x, groundHeightAt(x, z), z, rng.range(0, Math.PI * 2), rng);
      cover.push({ x, z, type: 'stall', height: 1.0 });
    }
    // palms
    for (let i = 0; i < 5; i++) {
      const x = rng.range(-17, 17);
      const z = rng.range(z0 + 3, z1 - 3);
      if (Math.abs(z - MAP.archZ) < 4) continue;
      Props.palmTree(props, cloth, x, groundHeightAt(x, z), z, rng);
    }
    // damaged vehicle wreck as a plaza landmark
    const wx = rng.range(-10, 10), wz = rng.range(z0 + 6, MAP.archZ - 5);
    Props.utilityVehicle(props, wx, groundHeightAt(wx, wz), wz, rng.range(0, Math.PI * 2), rng);
    Props.rubblePile(props, wx + 2.4, groundHeightAt(wx + 2.4, wz), wz + 1.1, rng, 1.6);
    cover.push({ x: wx, z: wz, type: 'vehicle', height: 1.7 });
  }

  _scatterGround(clutter, rng) {
    for (let i = 0; i < 620; i++) {
      const x = rng.range(-MAP.boundary + 6, MAP.boundary - 6);
      const z = rng.range(MAP.zMin + 6, MAP.zMax - 6);
      const ax = Math.abs(x);
      // keep scatter to walkable surfaces
      if (ax > 10.4 && ax < 23.6) continue;
      if (ax > 29.4 && ax < 43.2) continue;
      if (ax > 43.5) continue;
      Props.groundScatter(clutter, x, groundHeightAt(x, z), z, rng);
    }
  }

  /** Sagging power / communication cables crossing the street. */
  _stringCables(cables, cloth, rng, buildings) {
    void buildings;
    for (let z = MAP.zMin + 10; z < MAP.zMax - 10; z += rng.range(9, 17)) {
      if (z > MAP.plaza.z0 - 2 && z < MAP.plaza.z1 + 2) continue;
      const count = rng.int(2, 4);
      const yBase = rng.range(5.4, 8.4);
      for (let i = 0; i < count; i++) {
        cables.push({
          a: new THREE.Vector3(-10.0 + rng.range(-0.5, 0.5), yBase + i * rng.range(0.35, 0.7), z + rng.range(-0.6, 0.6)),
          b: new THREE.Vector3(10.0 + rng.range(-0.5, 0.5), yBase + i * rng.range(0.3, 0.65) + rng.range(-0.5, 0.5), z + rng.range(-0.6, 0.6)),
          sag: rng.range(0.7, 1.9),
          amplitude: rng.range(0.012, 0.045),
          phase: rng.range(0, 6.28),
          radius: rng.range(0.018, 0.035)
        });
      }
    }
    // alley service drops
    for (const sign of [1, -1]) {
      for (let z = MAP.zMin + 14; z < MAP.zMax - 14; z += rng.range(15, 30)) {
        cables.push({
          a: new THREE.Vector3(sign * (MAP.alley.x0 + 0.2), rng.range(4.5, 7.0), z),
          b: new THREE.Vector3(sign * (MAP.alley.x1 - 0.2), rng.range(4.5, 7.0), z + rng.range(-1.5, 1.5)),
          sag: rng.range(0.4, 1.0),
          amplitude: rng.range(0.02, 0.05),
          phase: rng.range(0, 6.28),
          radius: rng.range(0.016, 0.03)
        });
      }
    }
    void cloth;
  }
}
