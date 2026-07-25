import * as THREE from 'three';
import { LAYER } from '../world/MaterialLibrary.js';
import { GeometryBuilder } from '../world/GeometryBuilder.js';

/**
 * Procedural soldier. Built in bone-local frames where +Y always points from
 * the joint toward its child, so the same geometry works whether the pose comes
 * from the animation rig or from the ragdoll solver.
 *
 * The silhouette is layered the way real kit is: base uniform, then plate
 * carrier and pouches, then helmet, straps and slung gear on top. That
 * layering is what makes a character read as a soldier at 60 metres.
 */

export const BONE = {
  PELVIS: 0, CHEST: 1, HEAD: 2,
  UPPERARM_L: 3, FOREARM_L: 4, HAND_L: 5,
  UPPERARM_R: 6, FOREARM_R: 7, HAND_R: 8,
  THIGH_L: 9, SHIN_L: 10, FOOT_L: 11,
  THIGH_R: 12, SHIN_R: 13, FOOT_R: 14,
  WEAPON: 15
};
export const BONE_COUNT = 16;

export const BONE_LENGTH = {
  [BONE.PELVIS]: 0.36,
  [BONE.CHEST]: 0.20,
  [BONE.HEAD]: 0.16,
  [BONE.UPPERARM_L]: 0.28, [BONE.FOREARM_L]: 0.26, [BONE.HAND_L]: 0.10,
  [BONE.UPPERARM_R]: 0.28, [BONE.FOREARM_R]: 0.26, [BONE.HAND_R]: 0.10,
  [BONE.THIGH_L]: 0.42, [BONE.SHIN_L]: 0.42, [BONE.FOOT_L]: 0.10,
  [BONE.THIGH_R]: 0.42, [BONE.SHIN_R]: 0.42, [BONE.FOOT_R]: 0.10
};

export const TEAM_PALETTES = {
  A: {
    uniform: [0.52, 0.48, 0.36],
    carrier: [0.34, 0.33, 0.27],
    helmet: [0.36, 0.35, 0.30],
    accent: [0.55, 0.42, 0.22],
    gloves: [0.20, 0.19, 0.17]
  },
  B: {
    uniform: [0.36, 0.34, 0.32],
    carrier: [0.22, 0.22, 0.23],
    helmet: [0.24, 0.24, 0.25],
    accent: [0.42, 0.16, 0.14],
    gloves: [0.16, 0.16, 0.16]
  }
};

const CLOTH = LAYER.GEAR_CLOTH;
const POLY = LAYER.POLYMER;
const METAL = LAYER.GUNMETAL;
const NYLON = LAYER.FABRIC;

/** Vertical capsule-ish limb segment in bone space (origin at the joint). */
function limb(b, length, rTop, rBottom, opts, segments = 8) {
  b.addCylinder(0, 0, 0, rTop, rBottom, length, segments, { ...opts, caps: false });
  b.addBlob(0, 0, 0, rTop * 1.06, rTop * 0.9, rTop * 1.06, segments, 4, opts);
  b.addBlob(0, length, 0, rBottom * 1.04, rBottom * 0.85, rBottom * 1.04, segments, 4, opts);
}

function pouch(b, x, y, z, w, h, d, opts) {
  b.addBox(x, y, z, w, h, d, opts);
  b.addBox(x, y + h * 0.5, z, w * 0.94, h * 0.16, d * 1.08, { ...opts, tint: mul(opts.tint, 0.86) });
  b.addBox(x, y - h * 0.42, z - d * 0.5, w * 0.3, h * 0.2, 0.006, { ...opts, tint: mul(opts.tint, 0.7) });
}

function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

export function buildSoldier(team = 'A', variant = 0, rng) {
  const pal = TEAM_PALETTES[team] || TEAM_PALETTES.A;
  const jitter = (v, amt) => v.map((c) => c * (1 + (rng.next() - 0.5) * amt));
  const uniform = { layer: CLOTH, tint: jitter(pal.uniform, 0.14), wear: 0.7, uvScale: 5.5 };
  const carrier = { layer: NYLON, tint: jitter(pal.carrier, 0.10), wear: 0.65, uvScale: 6.5 };
  const helmetMat = { layer: POLY, tint: jitter(pal.helmet, 0.08), wear: 0.55, uvScale: 7 };
  const glove = { layer: POLY, tint: pal.gloves, wear: 0.6, uvScale: 12 };
  const boot = { layer: POLY, tint: [0.17, 0.15, 0.13], wear: 0.75, uvScale: 8 };
  const skin = { layer: CLOTH, tint: [0.62, 0.44, 0.33], wear: 0.25, uvScale: 14 };
  const accent = { layer: NYLON, tint: pal.accent, wear: 0.6, uvScale: 9 };
  const gun = { layer: METAL, tint: [1, 1, 1], wear: 0.6, uvScale: 9 };

  const b = new GeometryBuilder(null, `soldier-${team}`);

  // ------------------------------------------------------------ pelvis/torso
  b.setBone(BONE.PELVIS);
  b.addBox(0, 0.055, 0, 0.30, 0.17, 0.20, uniform);
  b.addBox(0, 0.16, -0.005, 0.315, 0.14, 0.205, uniform);
  b.addBox(0, 0.26, -0.005, 0.325, 0.13, 0.20, uniform);
  // belt with kit
  b.addBox(0, 0.055, 0, 0.315, 0.048, 0.212, { ...carrier, tint: mul(carrier.tint, 0.8) });
  b.addBox(0, 0.055, -0.108, 0.070, 0.040, 0.014, { ...carrier, tint: [0.6, 0.58, 0.5] });
  // drop holster on the right thigh line
  b.addBox(0.135, 0.005, 0.03, 0.055, 0.13, 0.075, { ...carrier, tint: mul(carrier.tint, 0.9) });
  b.addBox(0.135, 0.062, 0.03, 0.048, 0.03, 0.062, { ...glove });
  // dump pouch on the left
  b.addBox(-0.148, 0.030, 0.020, 0.045, 0.11, 0.09, accent);

  b.setBone(BONE.CHEST);
  // ribcage / shoulders
  b.addBox(0, 0.075, -0.008, 0.34, 0.19, 0.21, uniform);
  b.addBox(0, 0.165, -0.010, 0.375, 0.09, 0.205, uniform);
  // plate carrier front and back with a defined shoulder yoke
  b.addBox(0, 0.085, -0.108, 0.285, 0.235, 0.036, carrier);
  b.addBox(0, 0.085, 0.104, 0.285, 0.235, 0.034, carrier);
  b.addBox(0.152, 0.085, 0, 0.030, 0.20, 0.20, { ...carrier, tint: mul(carrier.tint, 0.92) });
  b.addBox(-0.152, 0.085, 0, 0.030, 0.20, 0.20, { ...carrier, tint: mul(carrier.tint, 0.92) });
  b.addBox(0.098, 0.185, -0.010, 0.075, 0.045, 0.215, carrier);
  b.addBox(-0.098, 0.185, -0.010, 0.075, 0.045, 0.215, carrier);
  // magazine pouches across the chest
  for (let i = 0; i < 3; i++) {
    pouch(b, -0.088 + i * 0.088, 0.048, -0.140, 0.078, 0.115, 0.050, {
      ...carrier, tint: mul(carrier.tint, 0.95 + i * 0.02)
    });
  }
  // admin pouch, radio, IFAK
  pouch(b, 0.108, 0.150, -0.128, 0.070, 0.070, 0.042, accent);
  b.addBox(-0.118, 0.150, 0.106, 0.060, 0.100, 0.048, { ...carrier, tint: [0.16, 0.16, 0.17] });
  b.addCylinder(-0.118, 0.198, 0.106, 0.005, 0.004, 0.135, 6, { ...gun, tint: [0.12, 0.12, 0.12], caps: false });
  pouch(b, 0.120, 0.020, 0.104, 0.060, 0.075, 0.048, carrier);
  // hydration bladder
  b.addBox(0, 0.130, 0.132, 0.190, 0.180, 0.060, { ...carrier, tint: mul(carrier.tint, 0.85) });
  // shoulder straps and buckles
  b.addBox(0.075, 0.190, -0.100, 0.045, 0.040, 0.030, { ...accent, tint: mul(accent.tint, 0.8) });
  b.addBox(-0.075, 0.190, -0.100, 0.045, 0.040, 0.030, { ...accent, tint: mul(accent.tint, 0.8) });

  b.setBone(BONE.HEAD);
  // neck, then head, then helmet shell over it
  b.addCylinder(0, -0.02, 0.005, 0.052, 0.055, 0.07, 8, { ...skin, caps: false });
  b.addBlob(0, 0.085, 0.004, 0.087, 0.105, 0.098, 12, 8, skin);
  b.addBox(0, 0.045, -0.070, 0.115, 0.075, 0.045, { ...carrier, tint: [0.20, 0.20, 0.19] }); // face cover
  b.addBlob(0, 0.098, 0.002, 0.108, 0.108, 0.118, 14, 9, helmetMat);
  b.addBox(0, 0.055, 0.010, 0.215, 0.030, 0.230, { ...helmetMat, tint: mul(helmetMat.tint, 0.95) });
  // helmet rails, NVG mount, counterweight, chinstrap
  b.addBox(0.104, 0.095, 0.004, 0.010, 0.020, 0.150, { ...helmetMat, tint: [0.2, 0.2, 0.2] });
  b.addBox(-0.104, 0.095, 0.004, 0.010, 0.020, 0.150, { ...helmetMat, tint: [0.2, 0.2, 0.2] });
  b.addBox(0, 0.130, -0.098, 0.045, 0.035, 0.030, { ...helmetMat, tint: [0.22, 0.22, 0.22] });
  b.addBox(0, 0.140, -0.115, 0.028, 0.018, 0.028, { ...gun, tint: [0.3, 0.3, 0.3] });
  b.addBox(0, 0.080, 0.108, 0.085, 0.055, 0.035, { ...carrier, tint: [0.2, 0.2, 0.2] });
  b.addBox(0, 0.010, 0.030, 0.180, 0.012, 0.150, { ...accent, tint: mul(accent.tint, 0.7) });
  // eye protection
  b.addBox(0, 0.078, -0.086, 0.150, 0.036, 0.020, {
    layer: METAL, tint: [0.12, 0.14, 0.16], wear: 0.2, uvScale: 14
  });

  // ------------------------------------------------------------------- arms
  for (const side of [-1, 1]) {
    const ua = side < 0 ? BONE.UPPERARM_L : BONE.UPPERARM_R;
    const fa = side < 0 ? BONE.FOREARM_L : BONE.FOREARM_R;
    const hd = side < 0 ? BONE.HAND_L : BONE.HAND_R;

    b.setBone(ua);
    limb(b, BONE_LENGTH[ua], 0.062, 0.052, uniform);
    b.addBlob(0, 0.01, 0, 0.075, 0.070, 0.075, 10, 6, { ...carrier, tint: mul(carrier.tint, 0.95) });
    b.addBox(side * 0.055, 0.06, 0, 0.014, 0.055, 0.055, { ...accent, tint: mul(accent.tint, 0.75) });

    b.setBone(fa);
    limb(b, BONE_LENGTH[fa], 0.052, 0.042, uniform);
    // rolled cuff and elbow pad
    b.addBlob(0, 0.005, 0, 0.058, 0.050, 0.058, 9, 5, { ...glove, tint: mul(glove.tint, 1.4) });
    b.addBox(0, BONE_LENGTH[fa] - 0.02, 0, 0.092, 0.032, 0.092, { ...uniform, tint: mul(uniform.tint, 0.9) });

    b.setBone(hd);
    b.addBox(0, 0.032, 0, 0.058, 0.080, 0.046, glove);
    b.addBox(0, 0.070, -0.006, 0.052, 0.030, 0.042, glove);
    b.addBox(0, 0.030, -0.026, 0.050, 0.055, 0.010, { ...glove, tint: mul(glove.tint, 0.7) });
  }

  // ------------------------------------------------------------------- legs
  for (const side of [-1, 1]) {
    const th = side < 0 ? BONE.THIGH_L : BONE.THIGH_R;
    const sh = side < 0 ? BONE.SHIN_L : BONE.SHIN_R;
    const ft = side < 0 ? BONE.FOOT_L : BONE.FOOT_R;

    b.setBone(th);
    limb(b, BONE_LENGTH[th], 0.088, 0.070, uniform);
    // thigh cargo pocket
    b.addBox(side * 0.070, 0.19, 0.008, 0.028, 0.130, 0.115, { ...uniform, tint: mul(uniform.tint, 0.92) });

    b.setBone(sh);
    limb(b, BONE_LENGTH[sh], 0.068, 0.052, uniform);
    // knee pad over the top of the shin
    b.addBox(0, 0.030, -0.052, 0.105, 0.115, 0.030, { ...glove, tint: [0.18, 0.17, 0.16] });
    b.addBlob(0, 0.012, -0.032, 0.072, 0.062, 0.062, 10, 6, { ...glove, tint: [0.20, 0.19, 0.18] });
    // blousing at the boot top
    b.addBox(0, BONE_LENGTH[sh] - 0.045, 0, 0.115, 0.075, 0.115, {
      ...uniform, tint: mul(uniform.tint, 0.95)
    });

    b.setBone(ft);
    b.addBox(0, 0.030, -0.055, 0.106, 0.085, 0.190, boot);
    b.addBox(0, -0.008, -0.062, 0.112, 0.030, 0.205, { ...boot, tint: [0.10, 0.09, 0.08] });
    b.addBox(0, 0.062, 0.010, 0.098, 0.050, 0.100, { ...boot, tint: mul(boot.tint, 1.2) });
    for (let i = 0; i < 4; i++) {
      b.addBox(0, 0.055 - i * 0.014, -0.070, 0.075, 0.005, 0.006, { ...boot, tint: [0.30, 0.28, 0.25] });
    }
  }

  // ------------------------------------------------------- carried carbine
  b.setBone(BONE.WEAPON);
  buildThirdPersonCarbine(b, gun, variant);

  return b.build();
}

/**
 * Lower-detail carbine for third-person characters: the same silhouette as the
 * viewmodel — handguard, optic, magazine, collapsible stock — at a fraction of
 * the triangles, because at ten metres nobody counts the rail slots.
 */
function buildThirdPersonCarbine(b, gun, variant) {
  const poly = { layer: LAYER.POLYMER, tint: [0.9, 0.9, 0.9], wear: 0.55, uvScale: 10 };
  b.addBox(0, 0, -0.30, 0.040, 0.050, 0.19, gun);            // upper/lower
  b.addCylinder(0, 0, -0.62, 0.022, 0.022, 0.24, 8, { ...poly, caps: false, rotY: 0 });
  b.pushTransform(new THREE.Matrix4().makeTranslation(0, 0, -0.66));
  b.addCylinder(0, 0, 0, 0.009, 0.008, 0.10, 8, { ...gun, caps: false });
  b.popTransform();
  b.addCylinder(0, 0, -0.78, 0.013, 0.013, 0.03, 10, gun);   // muzzle device
  b.addBox(0, 0.038, -0.40, 0.020, 0.010, 0.36, gun);        // rail
  b.addBox(0, 0.070, -0.34, 0.032, 0.038, 0.055, gun);       // optic
  b.addBox(0, 0.052, -0.34, 0.026, 0.020, 0.048, gun);
  b.addBox(0, -0.085, -0.30, 0.028, 0.130, 0.042, {
    ...poly, tint: [0.85, 0.83, 0.8]
  });                                                         // magazine
  b.addBox(0, -0.062, -0.16, 0.030, 0.085, 0.038, poly);      // grip
  b.addBox(0, -0.042, -0.235, 0.008, 0.006, 0.055, gun);      // trigger guard
  b.addBox(0, 0.008, -0.075, 0.038, 0.048, 0.11, poly);       // stock
  b.addCylinder(0, 0.010, -0.13, 0.015, 0.015, 0.06, 8, { ...gun, caps: false });
  b.addBox(0, -0.030, -0.52, 0.022, 0.055, 0.028, {
    ...poly, tint: [1.0, 0.92, 0.74]
  });                                                          // foregrip
  void variant;
}
