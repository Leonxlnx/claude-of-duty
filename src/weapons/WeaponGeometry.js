import * as THREE from 'three';
import { LAYER } from '../world/MaterialLibrary.js';

/**
 * Procedural M4-pattern carbine, gloves and sleeves.
 *
 * Authored in weapon-local metres: the bore runs along -Z at y = 0, +X is the
 * ejection-port side, the origin sits at the front of the magazine well. Every
 * part is real-scale, which is what makes the optic height-over-bore, the
 * ejection arc and the hand placement land where the eye expects them.
 */

// Tints multiply the layer's base albedo, and the polymer layer is authored as
// black furniture, so flat dark earth needs to lift it a long way rather than
// just warm it. An all-black carbine against a shaded street is a silhouette.
const GUNMETAL = [1, 1, 1];
const FDE = [1.86, 1.58, 1.18];
const BLACK_POLY = [1, 1, 1];

// --- geometry landmarks other systems need
export const WEAPON_ANCHORS = {
  muzzle: new THREE.Vector3(0, 0, -0.452),
  ejectionPort: new THREE.Vector3(0.026, 0.020, 0.012),
  sightWindow: new THREE.Vector3(0, 0.0855, -0.055),
  sightAxisOffsetY: 0.0855,
  magazine: new THREE.Vector3(0, -0.075, -0.012),
  chargingHandle: new THREE.Vector3(0, 0.030, 0.128),
  boltCarrier: new THREE.Vector3(0, 0.020, 0.02),
  triggerPivot: new THREE.Vector3(0, -0.020, 0.052),
  gripTop: new THREE.Vector3(0, -0.030, 0.070),
  foregrip: new THREE.Vector3(0, -0.032, -0.255),
  selector: new THREE.Vector3(-0.021, -0.006, 0.062)
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
let _vFlip = 0;
/** Scratch vector pair, so the cylinder helpers read as plain coordinates. */
function V(x, y, z) {
  const out = (_vFlip++ & 1) ? _v2 : _v;
  return out.set(x, y, z);
}

function m(pos, rot, scale) {
  const mat = new THREE.Matrix4();
  mat.compose(
    pos || _zero,
    rot ? _q.setFromEuler(rot) : _qi,
    scale || _one
  );
  return mat;
}

/** Slightly bevelled box: the highlight roll-off is what sells machined metal. */
function bevelBox(b, cx, cy, cz, sx, sy, sz, opts) {
  const bev = Math.min(sx, sy, sz) * (opts.bevel ?? 0.18);
  b.addBox(cx, cy, cz, sx, sy - bev * 2, sz - bev * 2, opts);
  b.addBox(cx, cy, cz, sx - bev * 2, sy, sz - bev * 2, opts);
  b.addBox(cx, cy, cz, sx - bev * 2, sy - bev * 2, sz, opts);
}

/** Picatinny rail: 1913-spec slots, which read instantly as "gun". */
function picatinny(b, y, z0, z1, width, opts) {
  const len = z1 - z0;
  const pitch = 0.0102;
  const slot = 0.0053;
  const n = Math.max(1, Math.floor(len / pitch));
  b.addBox(0, y - 0.004, (z0 + z1) * 0.5, width * 0.78, 0.005, len, opts);
  for (let i = 0; i < n; i++) {
    const zc = z0 + (i + 0.5) * pitch;
    const w = pitch - slot;
    // trapezoidal cross-rib
    b.addBox(0, y, zc, width, 0.0042, w, opts);
    b.addBox(0, y - 0.0035, zc, width * 0.86, 0.004, w * 1.02, opts);
  }
}

/** M-LOK style slot row cut into a handguard face. */
function mlokFace(b, opts, axis, sign, z0, z1, radius) {
  const pitch = 0.0245;
  const n = Math.floor((z1 - z0) / pitch);
  for (let i = 0; i < n; i++) {
    const zc = z0 + (i + 0.5) * pitch;
    const x = axis === 'x' ? sign * radius : 0;
    const y = axis === 'y' ? sign * radius : 0;
    b.addBox(x, y, zc, axis === 'x' ? 0.004 : 0.0075, axis === 'y' ? 0.004 : 0.0075, 0.0175, {
      ...opts, tint: [0.35, 0.35, 0.36]
    });
  }
}

export function buildCarbine(b, opts = {}) {
  const metal = {
    layer: LAYER.GUNMETAL, tint: GUNMETAL, wear: opts.wear ?? 0.55, uvScale: 9.0
  };
  const poly = {
    layer: LAYER.POLYMER, tint: BLACK_POLY, wear: opts.wear ?? 0.5, uvScale: 11.0
  };
  const fde = {
    layer: LAYER.POLYMER, tint: FDE, wear: 0.6, uvScale: 11.0
  };

  // ------------------------------------------------------------------ barrel
  b.addCylinderBetween(V(0, 0, -0.100), V(0, 0, -0.400), 0.0105, 0.0082, 12, { ...metal, caps: false });
  // gas block + low-profile front sight base under the handguard line
  b.addBox(0, 0.0, -0.318, 0.024, 0.026, 0.036, metal);
  b.addCylinderBetween(V(0, 0.011, -0.318), V(0, 0.011, -0.400), 0.0055, 0.0055, 8, { ...metal, caps: false });

  // muzzle device: A2-style birdcage with the timing slots
  b.addCylinderBetween(V(0, 0, -0.400), V(0, 0, -0.428), 0.0112, 0.0125, 14, { ...metal, caps: false });
  b.addCylinderBetween(V(0, 0, -0.428), V(0, 0, -0.466), 0.0125, 0.0118, 14, { ...metal, caps: false });
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * 0.5 + (i - 2) * 0.52;
    b.addBox(Math.cos(a) * 0.0118, Math.sin(a) * 0.0118, -0.446, 0.005, 0.005, 0.018, {
      ...metal, tint: [0.5, 0.5, 0.5]
    });
  }
  // crown + bore
  b.addCylinderBetween(V(0, 0, -0.466), V(0, 0, -0.469), 0.0118, 0.0092, 14, metal);
  b.addCylinderBetween(V(0, 0, -0.464), V(0, 0, -0.474), 0.0042, 0.0042, 12, {
    layer: LAYER.GUNMETAL, tint: [0.04, 0.04, 0.04], wear: 0.2, uvScale: 20
  });

  // -------------------------------------------------------------- handguard
  const hgZ0 = -0.352, hgZ1 = -0.098;
  const hgR = 0.0245;
  {
    const sides = 8;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2 + Math.PI / sides;
      const cx = Math.cos(a0) * hgR;
      const cy = Math.sin(a0) * hgR;
      b.pushTransform(m(
        new THREE.Vector3(cx, cy, (hgZ0 + hgZ1) * 0.5),
        new THREE.Euler(0, 0, a0 + Math.PI / 2)
      ));
      b.addBox(0, 0, 0, 0.0195, 0.005, hgZ1 - hgZ0, fde);
      b.popTransform();
    }
    // end caps and the barrel-nut shoulder
    b.addCylinderBetween(V(0, 0, hgZ1), V(0, 0, hgZ1 - 0.016), hgR * 1.07, hgR * 1.07, 10, { ...metal, caps: false });
    b.addCylinderBetween(V(0, 0, hgZ0 + 0.010), V(0, 0, hgZ0), hgR * 0.96, hgR * 0.9, 10, { ...fde, caps: false });
    mlokFace(b, fde, 'x', 1, hgZ0 + 0.03, hgZ1 - 0.03, hgR - 0.001);
    mlokFace(b, fde, 'x', -1, hgZ0 + 0.03, hgZ1 - 0.03, hgR - 0.001);
    mlokFace(b, fde, 'y', -1, hgZ0 + 0.03, hgZ1 - 0.03, hgR - 0.001);
  }

  // --------------------------------------------------------- upper receiver
  bevelBox(b, 0, 0.014, -0.002, 0.0385, 0.055, 0.196, { ...metal, bevel: 0.12 });
  // charging-handle channel and rear of the upper
  b.addBox(0, 0.030, 0.104, 0.032, 0.030, 0.026, metal);
  // ejection port with a proper door and hinge pin
  b.addBox(0.0198, 0.019, 0.010, 0.004, 0.030, 0.062, {
    ...metal, tint: [0.55, 0.55, 0.56], wear: 0.75
  });
  b.addBox(0.0208, 0.019, 0.010, 0.003, 0.026, 0.056, {
    ...metal, tint: [0.30, 0.30, 0.31]
  });
  b.addCylinderBetween(V(0.021, 0.004, -0.021), V(0.021, 0.004, 0.041), 0.0022, 0.0022, 6, {
    ...metal, caps: false
  });
  // brass deflector + forward assist
  b.addBox(0.019, 0.030, 0.049, 0.010, 0.018, 0.026, metal);
  b.addCylinderBetween(V(0.017, 0.019, 0.048), V(0.032, 0.019, 0.048), 0.0062, 0.0058, 8, metal);

  // top rail runs the length of the upper and onto the handguard
  picatinny(b, 0.0455, -0.348, 0.108, 0.0210, metal);

  // --------------------------------------------------------- lower receiver
  bevelBox(b, 0, -0.020, 0.036, 0.0345, 0.050, 0.128, { ...metal, bevel: 0.16 });
  // magwell flares forward and down
  b.pushTransform(m(new THREE.Vector3(0, -0.048, -0.008), new THREE.Euler(0.075, 0, 0)));
  b.addBox(0, 0, 0, 0.0345, 0.060, 0.052, metal);
  b.addBox(0, 0.028, 0, 0.0375, 0.010, 0.056, metal);
  b.popTransform();

  // magazine: 30-round curved polymer, witness holes down the side
  b.pushTransform(m(new THREE.Vector3(0, -0.104, -0.006), new THREE.Euler(0.10, 0, 0)));
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const curve = t * t * 0.016;
    b.addBox(0, -t * 0.052 - 0.006, curve, 0.0268 - t * 0.001, 0.016, 0.0405 + t * 0.001, {
      ...poly, tint: [0.92, 0.9, 0.86]
    });
  }
  b.addBox(0, 0.020, -0.002, 0.0292, 0.014, 0.0432, poly);
  b.addBox(0, -0.238, 0.062, 0.0292, 0.014, 0.0432, { ...poly, tint: [0.7, 0.7, 0.7] });
  for (let i = 0; i < 4; i++) {
    b.addBox(0.0138, -0.032 - i * 0.040, 0.004 + i * 0.004, 0.003, 0.010, 0.012, {
      ...poly, tint: [0.3, 0.3, 0.3]
    });
  }
  b.popTransform();

  // trigger guard, trigger, hammer pin, mag release, bolt catch, selector
  b.addBox(0, -0.0455, 0.055, 0.0075, 0.005, 0.050, { ...metal, tint: [0.8, 0.8, 0.8] });
  b.addBox(0, -0.032, 0.0805, 0.0075, 0.030, 0.005, { ...metal, tint: [0.8, 0.8, 0.8] });
  b.pushTransform(m(new THREE.Vector3(0, -0.030, 0.0575), new THREE.Euler(0.30, 0, 0)));
  b.addBox(0, 0, 0, 0.0062, 0.021, 0.005, { ...metal, tint: [0.6, 0.6, 0.6] });
  b.popTransform();
  b.addCylinderBetween(V(-0.0195, -0.006, 0.0605), V(-0.0245, -0.006, 0.0605), 0.0068, 0.0068, 8, metal);
  b.pushTransform(m(new THREE.Vector3(-0.0235, -0.006, 0.062), new THREE.Euler(0, 0, -0.5)));
  b.addBox(0, 0, 0, 0.006, 0.0165, 0.0075, { ...metal, tint: [0.5, 0.5, 0.5] });
  b.popTransform();
  b.addBox(0.0192, -0.014, 0.0075, 0.006, 0.011, 0.011, { ...metal, tint: [0.55, 0.55, 0.55] });
  b.addBox(-0.0192, -0.010, 0.006, 0.005, 0.009, 0.028, { ...metal, tint: [0.5, 0.5, 0.5] });
  // takedown pins
  b.addCylinderBetween(V(0.0178, -0.010, -0.030), V(0.0208, -0.010, -0.030), 0.0042, 0.0042, 8, { ...metal, tint: [0.65, 0.65, 0.65] });
  b.addCylinderBetween(V(0.0178, -0.014, 0.0885), V(0.0208, -0.014, 0.0885), 0.0042, 0.0042, 8, { ...metal, tint: [0.65, 0.65, 0.65] });

  // ------------------------------------------------------------- pistol grip
  b.pushTransform(m(new THREE.Vector3(0, -0.072, 0.098), new THREE.Euler(0.42, 0, 0)));
  b.addBox(0, 0, 0, 0.0295, 0.086, 0.038, fde);
  b.addBox(0, -0.048, 0.002, 0.0315, 0.012, 0.040, fde);
  b.addBox(0, 0.035, -0.010, 0.031, 0.022, 0.030, fde);
  // finger swell + texture ribs
  for (let i = 0; i < 7; i++) {
    const rib = { ...fde, tint: [fde.tint[0] * 0.78, fde.tint[1] * 0.78, fde.tint[2] * 0.78] };
    b.addBox(0, 0.030 - i * 0.0125, -0.0192, 0.026, 0.0055, 0.004, rib);
    b.addBox(0, 0.030 - i * 0.0125, 0.0192, 0.026, 0.0055, 0.004, rib);
  }
  b.popTransform();

  // ---------------------------------------------------- buffer tube + stock
  b.addCylinderBetween(V(0, 0.014, 0.098), V(0, 0.014, 0.118), 0.0165, 0.0165, 12, { ...metal, caps: false });
  b.addCylinderBetween(V(0, 0.014, 0.118), V(0, 0.014, 0.314), 0.0148, 0.0148, 12, { ...metal, caps: false });
  // castle nut and receiver end plate
  b.addCylinderBetween(V(0, 0.014, 0.108), V(0, 0.014, 0.118), 0.0185, 0.0185, 10, { ...metal, tint: [0.7, 0.7, 0.7] });

  // collapsible stock body
  b.pushTransform(m(new THREE.Vector3(0, 0.012, 0.214), new THREE.Euler(0, 0, 0)));
  b.addBox(0, 0.006, 0, 0.040, 0.048, 0.098, fde);
  b.addBox(0, 0.030, 0.006, 0.030, 0.020, 0.086, fde);        // cheek riser
  b.addBox(0, -0.022, -0.028, 0.034, 0.020, 0.040, fde);       // release lever housing
  b.addBox(0, -0.030, -0.030, 0.014, 0.014, 0.030, { ...poly, tint: [0.6, 0.6, 0.6] });
  b.popTransform();
  // butt pad, angled
  b.pushTransform(m(new THREE.Vector3(0, 0.010, 0.272), new THREE.Euler(-0.13, 0, 0)));
  b.addBox(0, 0, 0, 0.042, 0.088, 0.016, { ...poly, tint: [0.55, 0.55, 0.55] });
  b.addBox(0, -0.036, 0.004, 0.040, 0.020, 0.012, { ...poly, tint: [0.42, 0.42, 0.42] });
  b.popTransform();
  // sling loop
  b.addBox(0.021, 0.006, 0.176, 0.006, 0.020, 0.010, metal);

  // ----------------------------------------------------------- optic (RDS)
  // mount
  b.addBox(0, 0.054, -0.055, 0.030, 0.018, 0.052, { ...metal, tint: [0.9, 0.9, 0.9] });
  b.addBox(0.017, 0.050, -0.055, 0.008, 0.014, 0.048, { ...metal, tint: [0.7, 0.7, 0.7] });
  b.addCylinderBetween(V(0.021, 0.050, -0.070), V(0.021, 0.050, -0.040), 0.0055, 0.0055, 8, metal);
  // housing: squared tube with a protective hood
  bevelBox(b, 0, 0.0855, -0.055, 0.0345, 0.040, 0.060, { ...metal, bevel: 0.2, tint: [0.85, 0.85, 0.85] });
  b.addBox(0, 0.104, -0.055, 0.0365, 0.006, 0.064, { ...metal, tint: [0.75, 0.75, 0.75] });
  // windows: front and rear apertures left hollow, filled by the glass mesh
  b.addBox(0, 0.0855, -0.0855, 0.0345, 0.040, 0.005, { ...metal, tint: [0.8, 0.8, 0.8] });
  b.addBox(0, 0.0855, -0.0245, 0.0345, 0.040, 0.005, { ...metal, tint: [0.8, 0.8, 0.8] });
  // brightness knob + battery cap
  b.addCylinderBetween(V(-0.019, 0.0855, -0.062), V(-0.027, 0.0855, -0.062), 0.0085, 0.0085, 10, {
    ...metal, tint: [0.7, 0.7, 0.7]
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.addBox(-0.0235, 0.0855 + Math.sin(a) * 0.0085, -0.062 + Math.cos(a) * 0.0085, 0.003, 0.003, 0.003, {
      ...metal, tint: [0.55, 0.55, 0.55]
    });
  }
  b.addCylinder(0, 0.104, -0.048, 0.0092, 0.0092, 0.007, 10, { ...metal, tint: [0.65, 0.65, 0.65] });

  // ---------------------------------------------- back-up iron sights (folded)
  b.addBox(0, 0.053, -0.300, 0.014, 0.014, 0.016, { ...metal, tint: [0.6, 0.6, 0.6] });
  b.addBox(0, 0.053, 0.078, 0.016, 0.013, 0.018, { ...metal, tint: [0.6, 0.6, 0.6] });

  // -------------------------------------------------------- angled foregrip
  b.pushTransform(m(new THREE.Vector3(0, -0.040, -0.248), new THREE.Euler(0.48, 0, 0)));
  b.addBox(0, -0.030, 0, 0.024, 0.062, 0.030, fde);
  b.addBox(0, -0.062, 0.002, 0.028, 0.010, 0.034, fde);
  for (let i = 0; i < 4; i++) {
    b.addBox(0, -0.016 - i * 0.013, -0.0155, 0.020, 0.006, 0.004, { ...fde, tint: [0.8, 0.74, 0.6] });
  }
  b.popTransform();

  // -------------------------------------------------------------- QD sling
  b.addCylinderBetween(V(-0.020, -0.016, -0.120), V(-0.026, -0.016, -0.120), 0.005, 0.005, 8, {
    ...metal, tint: [0.6, 0.6, 0.6]
  });

  return WEAPON_ANCHORS;
}

/**
 * Gloved hands and sleeves. Built as tapered boxes and blobs rather than a
 * skinned mesh: at viewmodel distance the silhouette and the material do all
 * the work, and it stays a single static buffer we can animate rigidly.
 */
export function buildHands(b) {
  const glove = { layer: LAYER.GEAR_CLOTH, tint: [1.62, 1.26, 0.92], wear: 0.7, uvScale: 14 };
  const gloveHard = { layer: LAYER.POLYMER, tint: [2.05, 1.72, 1.32], wear: 0.6, uvScale: 16 };
  const sleeve = { layer: LAYER.GEAR_CLOTH, tint: [1.72, 1.58, 1.12], wear: 0.75, uvScale: 7 };
  const skin = { layer: LAYER.GEAR_CLOTH, tint: [2.6, 1.9, 1.45], wear: 0.35, uvScale: 18 };

  // ---------------- right hand on the pistol grip
  b.pushTransform(m(
    new THREE.Vector3(0.005, -0.075, 0.102),
    new THREE.Euler(0.42, 0.06, 0.0)
  ));
  // palm wrapped round the grip
  b.addBox(0, -0.004, 0.0, 0.050, 0.085, 0.050, glove);
  b.addBox(0.0, 0.030, -0.004, 0.046, 0.026, 0.048, glove);
  // knuckle pad
  b.addBox(0.0, 0.014, -0.029, 0.044, 0.048, 0.008, gloveHard);
  // fingers curled around the front strap
  for (let i = 0; i < 4; i++) {
    const y = 0.020 - i * 0.0195;
    const len = 0.040 - Math.abs(i - 1.2) * 0.003;
    b.pushTransform(m(new THREE.Vector3(0, y, -0.028), new THREE.Euler(0, 0, 0)));
    b.addBox(0, 0, -len * 0.5, 0.040, 0.0165, len, glove);
    b.addBox(0, -0.002, -len - 0.008, 0.036, 0.015, 0.020, glove);
    b.popTransform();
  }
  // thumb along the left side
  b.pushTransform(m(new THREE.Vector3(-0.022, 0.020, -0.006), new THREE.Euler(0.2, 0, -0.55)));
  b.addBox(0, 0, -0.020, 0.017, 0.019, 0.048, glove);
  b.addBox(0, 0.006, -0.048, 0.015, 0.017, 0.020, glove);
  b.popTransform();
  // Wrist, cuff, then the forearm dropping out of the bottom of the frame.
  // The pitch is steep on purpose: a forearm aimed at the lens presents one
  // flat facet filling a quarter of the screen.
  b.pushTransform(m(new THREE.Vector3(0.012, -0.040, 0.050), new THREE.Euler(0.62, 0.16, 0)));
  b.addBox(0, 0, 0.020, 0.050, 0.048, 0.050, glove);
  b.addBox(0, 0, 0.052, 0.056, 0.054, 0.026, { ...gloveHard, tint: [0.42, 0.40, 0.36] });
  taperedLimb(b, 0.070, 0.062, 0.155, sleeve);
  b.popTransform();
  b.popTransform();

  // ---------------- left hand supporting the handguard
  b.pushTransform(m(
    new THREE.Vector3(0.002, -0.026, -0.222),
    new THREE.Euler(0.26, -0.06, 0.10)
  ));
  b.addBox(0, -0.014, 0.004, 0.052, 0.062, 0.076, glove);
  b.addBox(0, 0.018, 0.004, 0.046, 0.030, 0.070, glove);
  b.addBox(0, 0.006, -0.040, 0.046, 0.046, 0.010, gloveHard);
  // fingers over the top of the handguard, thumb underneath
  for (let i = 0; i < 4; i++) {
    const z = -0.026 + i * 0.0205;
    b.pushTransform(m(new THREE.Vector3(0.004, 0.030, z), new THREE.Euler(0, 0, -1.15)));
    b.addBox(0, -0.020, 0, 0.017, 0.046, 0.019, glove);
    b.addBox(0.004, -0.046, 0, 0.015, 0.020, 0.017, glove);
    b.popTransform();
  }
  b.pushTransform(m(new THREE.Vector3(-0.020, -0.026, -0.010), new THREE.Euler(0, 0.4, 0.3)));
  b.addBox(0, 0, 0.022, 0.018, 0.019, 0.048, glove);
  b.popTransform();
  // forearm angling down and left, out of the frame
  b.pushTransform(m(new THREE.Vector3(-0.012, -0.052, 0.050), new THREE.Euler(0.54, -0.42, 0.22)));
  b.addBox(0, 0, 0.026, 0.052, 0.050, 0.052, glove);
  b.addBox(0, 0, 0.058, 0.058, 0.056, 0.024, { ...gloveHard, tint: [0.42, 0.40, 0.36] });
  taperedLimb(b, 0.072, 0.064, 0.170, sleeve);
  b.popTransform();
  b.popTransform();

  void skin;
}

/**
 * A forearm as a short stack of shrinking segments rather than one long box.
 * The extra silhouette breaks and the shading variation between facets are
 * what stop a sleeve reading as a painted rectangle at the edge of the screen.
 */
function taperedLimb(b, width, height, length, mat) {
  const segments = 4;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const z = 0.076 + t * length;
    const k = 1 + t * 0.16;                    // swells toward the elbow
    const seg = length / segments + 0.014;
    b.addBox(0, -t * 0.004, z, width * k, height * k, seg, mat);
  }
  // cuff seam where the sleeve meets the glove
  b.addBox(0, 0, 0.074, width * 1.05, height * 1.05, 0.012, {
    ...mat, tint: [mat.tint[0] * 0.82, mat.tint[1] * 0.82, mat.tint[2] * 0.82]
  });
}

/** Small parts that move independently of the receiver. */
export function buildBoltCarrier(b) {
  const metal = { layer: LAYER.GUNMETAL, tint: [0.75, 0.75, 0.76], wear: 0.4, uvScale: 12 };
  b.addBox(0, 0, 0, 0.026, 0.024, 0.060, metal);
  b.addCylinderBetween(V(0, 0, -0.030), V(0, 0, -0.046), 0.0092, 0.0092, 10, metal);
  b.addBox(0.011, 0.006, 0.008, 0.008, 0.008, 0.026, { ...metal, tint: [0.6, 0.6, 0.6] });
}

export function buildChargingHandle(b) {
  const metal = { layer: LAYER.GUNMETAL, tint: [0.62, 0.62, 0.63], wear: 0.6, uvScale: 12 };
  b.addBox(0, 0, 0, 0.030, 0.010, 0.048, metal);
  b.addBox(-0.020, 0, 0.020, 0.020, 0.012, 0.010, metal);
  b.addBox(0.020, 0, 0.020, 0.020, 0.012, 0.010, metal);
  b.addBox(0, 0, -0.036, 0.014, 0.008, 0.036, metal);
}

export function buildMagazine(b) {
  const poly = { layer: LAYER.POLYMER, tint: [0.92, 0.9, 0.86], wear: 0.6, uvScale: 11 };
  // Stacked slices following the STANAG curve; the banana profile is the single
  // most recognisable part of the silhouette, so it gets the vertices.
  const SEGS = 9;
  for (let i = 0; i < SEGS; i++) {
    const t = i / (SEGS - 1);
    const curve = t * t * 0.024;
    b.addBox(0, -t * 0.185 - 0.008, curve, 0.0268 - t * 0.001, 0.026, 0.0405, {
      ...poly, tint: [0.92 - t * 0.02, 0.90 - t * 0.02, 0.86 - t * 0.02]
    });
  }
  b.addBox(0, 0.020, -0.002, 0.0292, 0.014, 0.0432, poly);
  b.addBox(0, -0.200, 0.024, 0.0300, 0.016, 0.0450, { ...poly, tint: [0.7, 0.7, 0.7] });
  b.addBox(0, 0.030, -0.004, 0.020, 0.008, 0.036, {
    layer: LAYER.GUNMETAL, tint: [0.8, 0.75, 0.4], wear: 0.3, uvScale: 20
  });
}

const _zero = new THREE.Vector3(0, 0, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
