import * as THREE from 'three';
import { FullscreenPass } from './FullscreenPass.js';
import { CLOUD_FRAG, SKY_FRAG, SKY_CAPTURE_FRAG } from './shaders/sky.glsl.js';

const CAPTURE_W = 64;
const CAPTURE_H = 32;

/**
 * Procedural atmosphere: physically-motivated single-scattering sky, a
 * ray-marched cumulus deck rendered at half resolution, and an SH9 irradiance
 * probe projected from an equirectangular capture of the same sky function.
 * No HDRI, no cube map, no static image anywhere in the chain.
 */
/**
 * Times of day, as a whole lighting state each rather than a sun angle.
 *
 * Elevations are kept above the horizon even at dawn and dusk — a sun exactly
 * on the horizon casts shadows of effectively infinite length, and the cascade
 * split cannot contain them, so the map fills with shadow acne. Six degrees is
 * low enough to read as golden hour and high enough to shadow cleanly.
 */
export const TIME_OF_DAY = {
  dawn:    { azimuth: 74,  elevation: 6.5, intensity: 8.5,  turbidity: 4.4, clouds: 0.58, tint: [1.0, 0.80, 0.60], ev: -0.30 },
  morning: { azimuth: 96,  elevation: 28,  intensity: 16.0, turbidity: 3.2, clouds: 0.50, tint: [1.0, 0.94, 0.86], ev: -0.05 },
  day:     { azimuth: 116, elevation: 57,  intensity: 21.0, turbidity: 2.6, clouds: 0.52, tint: [1.0, 1.00, 1.00], ev: 0 },
  sunset:  { azimuth: 252, elevation: 7.0, intensity: 9.5,  turbidity: 5.2, clouds: 0.62, tint: [1.0, 0.72, 0.46], ev: -0.35 },
  // Night needs a large negative bias or it does not exist. Auto-exposure
  // keys the average of the frame to a fixed target, so dimming the sun by
  // twenty-five times just makes the meter open up by twenty-five times and
  // hands back the same picture — a dark scene metered back to daylight. The
  // bias is what stops the meter from undoing the time of day.
  night:   { azimuth: 288, elevation: 34,  intensity: 0.85, turbidity: 2.0, clouds: 0.40, tint: [0.62, 0.72, 1.0], ev: -2.60 }
};

export class Sky {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.sunDirection = new THREE.Vector3(0.34, 0.66, -0.67).normalize();
    this.sunColor = new THREE.Color(1.0, 0.955, 0.88);
    this.sunIntensity = 21.0;
    this.turbidity = 2.6;
    // Post cluster-mask this reads lower than the number suggests: heaps of
    // cumulus with real blue between them, not four-tenths of the sky filled.
    this.cloudCoverage = 0.52;
    this.wind = new THREE.Vector2(1.0, 0.35);
    this.cloudShadowOffset = new THREE.Vector2();

    this.sh = [];
    for (let i = 0; i < 9; i++) this.sh.push(new THREE.Vector3());
    this.horizonColor = new THREE.Color();
    this.zenithColor = new THREE.Color();
    this.groundColor = new THREE.Color();
    this.averageSky = new THREE.Color();

    const shared = {
      uSunDirection: { value: this.sunDirection },
      uSunIntensity: { value: this.sunIntensity },
      uTurbidity: { value: this.turbidity },
      uSunColor: { value: new THREE.Vector3(1, 0.955, 0.88) }
    };
    this.shared = shared;

    this.cloudPass = new FullscreenPass(CLOUD_FRAG, {
      ...shared,
      uInvViewProjection: { value: new THREE.Matrix4() },
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uCoverage: { value: 0.52 },
      uSteps: { value: quality.cloudSteps },
      uWind: { value: this.wind }
    });

    this.skyPass = new FullscreenPass(SKY_FRAG, {
      ...shared,
      uInvViewProjection: { value: new THREE.Matrix4() },
      uPrevViewProjection: { value: new THREE.Matrix4() },
      uCameraPos: { value: new THREE.Vector3() },
      uClouds: { value: null },
      uTime: { value: 0 }
    });
    this.skyPass.material.depthTest = false;
    this.skyPass.material.depthWrite = false;

    this.capturePass = new FullscreenPass(SKY_CAPTURE_FRAG, {
      ...shared,
      uCloudCoverage: { value: this.cloudCoverage }
    });

    this.captureTarget = new THREE.WebGLRenderTarget(CAPTURE_W, CAPTURE_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false
    });
    this._capturePixels = new Uint16Array(CAPTURE_W * CAPTURE_H * 4);

    this.cloudTarget = null;
    this._resize(1, 1, quality);
  }

  setQuality(quality) {
    this.cloudPass.uniforms.uSteps.value = quality.cloudSteps;
    this._cloudScale = quality.cloudSteps >= 30 ? 0.5 : 0.34;
  }

  _resize(w, h, quality) {
    this._cloudScale = (quality?.cloudSteps ?? 30) >= 30 ? 0.5 : 0.34;
    const cw = Math.max(2, Math.floor(w * this._cloudScale));
    const ch = Math.max(2, Math.floor(h * this._cloudScale));
    if (this.cloudTarget) this.cloudTarget.dispose();
    this.cloudTarget = new THREE.WebGLRenderTarget(cw, ch, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false
    });
    this.skyPass.uniforms.uClouds.value = this.cloudTarget.texture;
  }

  resize(w, h, quality) { this._resize(w, h, quality); }

  setSun(azimuthDeg, elevationDeg) {
    const az = azimuthDeg * Math.PI / 180;
    const el = elevationDeg * Math.PI / 180;
    this.sunDirection.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    // warm the light slightly as the sun drops
    const t = THREE.MathUtils.clamp(1 - this.sunDirection.y, 0, 1);
    this.sunColor.setRGB(1.0, 0.965 - t * 0.13, 0.90 - t * 0.28);
    this.shared.uSunColor.value.set(this.sunColor.r, this.sunColor.g, this.sunColor.b);
  }

  /**
   * Put the sky at a time of day.
   *
   * Elevation alone is not a time of day. What separates dawn from noon is
   * mostly everything else: how far the light has travelled through the
   * atmosphere (turbidity), how much of it there is, and what colour it has
   * become on the way. Each preset therefore carries its own intensity,
   * turbidity, cloud deck and light colour, and the sun colour set by
   * `setSun` is then multiplied by that tint so a low sun still warms itself.
   *
   * Night is not a dark day: the key light becomes a cool moon at a fraction
   * of the intensity, and the ambient has to carry the frame instead.
   */
  setTimeOfDay(name) {
    const p = TIME_OF_DAY[name] || TIME_OF_DAY.day;
    this.timeOfDay = name in TIME_OF_DAY ? name : 'day';
    this.sunIntensity = p.intensity;
    this.turbidity = p.turbidity;
    this.cloudCoverage = p.clouds;
    this.shared.uSunIntensity.value = p.intensity;
    this.shared.uTurbidity.value = p.turbidity;
    // Read by RenderGraph when it drives the exposure meter.
    this.exposureBias = p.ev ?? 0;
    this.setSun(p.azimuth, p.elevation);
    // Tint on top of the elevation-driven warmth, so a moon reads cool and a
    // low sun reads hot rather than both simply reading "not midday".
    this.sunColor.setRGB(
      this.sunColor.r * p.tint[0], this.sunColor.g * p.tint[1], this.sunColor.b * p.tint[2]
    );
    this.shared.uSunColor.value.set(this.sunColor.r, this.sunColor.g, this.sunColor.b);
    return this.timeOfDay;
  }

  update(dt, time) {
    this.cloudPass.uniforms.uTime.value = time;
    this.skyPass.uniforms.uTime.value = time;
    // uCoverage is the density threshold the marched noise has to clear, so it
    // runs opposite to how much of the sky ends up covered. The slow sine
    // breathes the cloud deck over a couple of minutes.
    this.cloudPass.uniforms.uCoverage.value =
      0.60 - this.cloudCoverage * 0.42 + Math.sin(time * 0.006) * 0.025;
    this.cloudShadowOffset.x += this.wind.x * dt * 0.0016;
    this.cloudShadowOffset.y += this.wind.y * dt * 0.0016;
  }

  renderClouds(camera) {
    _invVP.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
    this.cloudPass.uniforms.uInvViewProjection.value.copy(_invVP);
    this.cloudPass.uniforms.uCameraPos.value.copy(camera.position);
    this.cloudPass.render(this.renderer, this.cloudTarget);
  }

  /** Sky fills the MRT gbuffer wherever nothing else was drawn. */
  renderSky(camera, prevViewProjection, target) {
    _invVP.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
    this.skyPass.uniforms.uInvViewProjection.value.copy(_invVP);
    this.skyPass.uniforms.uPrevViewProjection.value.copy(prevViewProjection);
    this.skyPass.uniforms.uCameraPos.value.copy(camera.position);
    this.skyPass.render(this.renderer, target);
  }

  /**
   * Project the sky into SH9 and derive the ambient reference colours.
   * Called at load and whenever the sun moves; it is a 64x32 readback.
   */
  bake() {
    const renderer = this.renderer;
    this.capturePass.uniforms.uCloudCoverage.value = this.cloudCoverage;
    const prev = renderer.getRenderTarget();
    this.capturePass.render(renderer, this.captureTarget);
    renderer.readRenderTargetPixels(this.captureTarget, 0, 0, CAPTURE_W, CAPTURE_H, this._capturePixels);
    renderer.setRenderTarget(prev);

    for (let i = 0; i < 9; i++) this.sh[i].set(0, 0, 0);
    let totalWeight = 0;
    let avgR = 0, avgG = 0, avgB = 0;
    let horizR = 0, horizG = 0, horizB = 0, horizN = 0;
    let zenR = 0, zenG = 0, zenB = 0, zenN = 0;

    for (let y = 0; y < CAPTURE_H; y++) {
      const v = (y + 0.5) / CAPTURE_H;
      const theta = (1 - v) * Math.PI;
      const sinT = Math.sin(theta);
      const dOmega = (2 * Math.PI / CAPTURE_W) * (Math.PI / CAPTURE_H) * sinT;
      for (let x = 0; x < CAPTURE_W; x++) {
        const u = (x + 0.5) / CAPTURE_W;
        const phi = (u * 2 - 1) * Math.PI;
        const dx = sinT * Math.sin(phi);
        const dy = Math.cos(theta);
        const dz = sinT * Math.cos(phi);

        const i = (y * CAPTURE_W + x) * 4;
        const r = fromHalf(this._capturePixels[i]);
        const g = fromHalf(this._capturePixels[i + 1]);
        const b = fromHalf(this._capturePixels[i + 2]);

        addSH(this.sh, dx, dy, dz, r, g, b, dOmega);
        totalWeight += dOmega;
        avgR += r * dOmega; avgG += g * dOmega; avgB += b * dOmega;

        if (dy > -0.12 && dy < 0.12) { horizR += r; horizG += g; horizB += b; horizN++; }
        if (dy > 0.85) { zenR += r; zenG += g; zenB += b; zenN++; }
      }
    }

    const inv = 1 / Math.max(totalWeight, 1e-6);
    this.averageSky.setRGB(avgR * inv, avgG * inv, avgB * inv);
    if (horizN) this.horizonColor.setRGB(horizR / horizN, horizG / horizN, horizB / horizN);
    if (zenN) this.zenithColor.setRGB(zenR / zenN, zenG / zenN, zenB / zenN);
    this.groundColor.copy(this.averageSky).multiplyScalar(0.34);
    this.groundColor.r *= 1.18; this.groundColor.g *= 1.02; this.groundColor.b *= 0.78;
    return this;
  }

  dispose() {
    this.cloudPass.dispose();
    this.skyPass.dispose();
    this.capturePass.dispose();
    this.cloudTarget?.dispose();
    this.captureTarget.dispose();
  }
}

function addSH(sh, x, y, z, r, g, b, w) {
  const basis = [
    0.282095,
    0.488603 * y, 0.488603 * z, 0.488603 * x,
    1.092548 * x * y, 1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y)
  ];
  for (let i = 0; i < 9; i++) {
    const c = basis[i] * w;
    sh[i].x += r * c;
    sh[i].y += g * c;
    sh[i].z += b * c;
  }
}

/** IEEE half → float, for reading HalfFloat render targets. */
function fromHalf(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  let val;
  if (e === 0) val = f / 1024 * Math.pow(2, -14);
  else if (e === 31) val = f ? NaN : Infinity;
  else val = (1 + f / 1024) * Math.pow(2, e - 15);
  return s ? -val : val;
}

const _invVP = new THREE.Matrix4();
