import * as THREE from 'three';

const SIZE = 33;

/**
 * Procedural 33x33x33 grading LUT built at startup.
 * The look is a restrained warm-neutral daylight grade: a slight cool lift in
 * the shadows, warm highlights, gentle S-curve contrast and a small hue
 * rotation that keeps sunlit plaster from going pink.
 */
export function createGradingLUT() {
  const data = new Uint8Array(SIZE * SIZE * SIZE * 4);
  let p = 0;
  for (let b = 0; b < SIZE; b++) {
    for (let g = 0; g < SIZE; g++) {
      for (let r = 0; r < SIZE; r++) {
        let cr = r / (SIZE - 1);
        let cg = g / (SIZE - 1);
        let cb = b / (SIZE - 1);

        // lift / gamma / gain
        const lift = [0.006, 0.008, 0.016];
        const gain = [1.012, 1.0, 0.976];
        cr = (cr + lift[0] * (1 - cr)) * gain[0];
        cg = (cg + lift[1] * (1 - cg)) * gain[1];
        cb = (cb + lift[2] * (1 - cb)) * gain[2];

        // soft S-curve contrast around 0.44
        const pivot = 0.44, contrast = 1.08;
        cr = contrastCurve(cr, pivot, contrast);
        cg = contrastCurve(cg, pivot, contrast);
        cb = contrastCurve(cb, pivot, contrast);

        // luminance-dependent temperature: warm highs, cool shadows
        const l = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        const warm = smoothstep(0.35, 0.95, l);
        cr += warm * 0.022;
        cb -= warm * 0.026;
        const cool = 1 - smoothstep(0.0, 0.35, l);
        cb += cool * 0.018;
        cr -= cool * 0.006;

        // global saturation with highlight desaturation to protect sky/flash
        const sat = 1.06 - smoothstep(0.72, 1.0, l) * 0.28;
        cr = l + (cr - l) * sat;
        cg = l + (cg - l) * sat;
        cb = l + (cb - l) * sat;

        data[p++] = clamp255(cr);
        data[p++] = clamp255(cg);
        data[p++] = clamp255(cb);
        data[p++] = 255;
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, SIZE, SIZE, SIZE);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return { texture: tex, size: SIZE };
}

function contrastCurve(x, pivot, amount) {
  const d = x - pivot;
  return pivot + d * amount + d * d * d * 0.12;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}
