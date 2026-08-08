import * as THREE from 'three';
import { FullscreenPass } from './FullscreenPass.js';
import { ShadowSystem } from './ShadowSystem.js';
import { Sky } from './Sky.js';
import { createGradingLUT } from './ColorGrade.js';
import {
  COMBINE_FRAG, GTAO_FRAG, AO_BLUR_FRAG, AO_TEMPORAL_FRAG, TAA_FRAG,
  TILE_MAX_FRAG, TILE_DILATE_FRAG, MOTION_BLUR_FRAG,
  BLOOM_PREFILTER_FRAG, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG,
  LUMINANCE_FRAG, LUMINANCE_DOWN_FRAG, EXPOSURE_FRAG, COMPOSITE_FRAG, BLIT_FRAG, DEBUG_FRAG
} from './shaders/post.glsl.js';

export const DEBUG_VIEWS = [
  'off', 'normals', 'velocity', 'ao', 'depth', 'direct', 'ambient', 'bloom', 'cascades', 'roughness'
];

// 8-sample Halton(2,3) jitter sequence, centred on the pixel.
const HALTON = [];
for (let i = 1; i <= 8; i++) HALTON.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);
function halton(index, base) {
  let f = 1, r = 0, i = index;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}

const BLOOM_LEVELS = 6;
/** Baseline exposure compensation in EV; the time of day biases it further. */
const EXPOSURE_COMPENSATION = -0.9;
/** How far the meter may open and close around that baseline. */
const EXPOSURE_MIN_EV = -2.5;
const EXPOSURE_MAX_EV = 6.5;
const TILE_SIZE = 12;
/** Trim on the baked sky probe; see `updateSkyUniforms`. */
const SKY_IRRADIANCE = 0.46;

/**
 * The whole frame is owned here: shadows, a fused MRT forward pass, GTAO,
 * TAA, tile-dilated motion blur, a Karis bloom pyramid, GPU exposure metering
 * and an AgX + 3D-LUT composite. EffectComposer is never used.
 */
export class RenderGraph {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.width = 1;
    this.height = 1;
    this.renderWidth = 1;
    this.renderHeight = 1;
    this.renderScale = quality.renderScale;
    this.frameIndex = 0;
    this.debugView = 0;
    // three resets renderer.info on every render() call, so the graph keeps its
    // own running totals across the whole frame's passes.
    this.stats = { drawCalls: 0, triangles: 0 };

    this.shadows = new ShadowSystem(renderer, {
      resolution: quality.shadowResolution,
      cascades: quality.shadowCascades
    });
    this.sky = new Sky(renderer, quality);

    this.prevViewProjection = new THREE.Matrix4();
    this.currViewProjection = new THREE.Matrix4();
    // The viewmodel is drawn through its own narrower camera, so it needs its
    // own history matrix or every hand and rail smears across the motion buffer.
    this.vmPrevViewProjection = new THREE.Matrix4();
    this.vmCurrViewProjection = new THREE.Matrix4();
    this._vmHistoryValid = false;
    this.jitter = new THREE.Vector4();

    this.lut = createGradingLUT();

    // ---- shared lighting uniforms, referenced by every scene material
    this.lightUniforms = {
      uSunDirection: { value: this.sky.sunDirection },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uSkySH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
      uHorizonColor: { value: new THREE.Vector3(0.6, 0.7, 0.85) },
      uZenithColor: { value: new THREE.Vector3(0.25, 0.45, 0.85) },
      uGroundColor: { value: new THREE.Vector3(0.25, 0.22, 0.18) },
      uCloudShadowStrength: { value: 0.45 },
      uCloudShadowOffset: { value: this.sky.cloudShadowOffset },
      uTime: { value: 0 },
      uShadowMap: { value: this.shadows.target.texture },
      uCascadeMatrix: { value: this.shadows.matrices },
      uCascadeSplits: { value: this.shadows.splits },
      uShadowTexel: { value: 1 / quality.shadowResolution },
      uCascadeCount: { value: quality.shadowCascades },
      uShadowStrength: { value: 1.0 },
      uPointLights: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uPointColors: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uPointLightCount: { value: 0 },
      uFogColor: { value: new THREE.Vector3(0.72, 0.76, 0.82) },
      uFogDensity: { value: 0.0009 },
      uCameraPos: { value: new THREE.Vector3() },
      uPrevViewProjection: { value: this.prevViewProjection },
      uJitter: { value: this.jitter }
    };

    this._buildPasses();
    this._pointLightPool = [];
  }

  _buildPasses() {
    const r = this.renderer;
    void r;

    this.combinePass = new FullscreenPass(COMBINE_FRAG, {
      uDirect: { value: null }, uAmbient: { value: null }, uAO: { value: null },
      uAOStrength: { value: 1.0 }
    });

    this.gtaoPass = new FullscreenPass(GTAO_FRAG, {
      uDepth: { value: null }, uNormal: { value: null }, uVelocity: { value: null },
      viewMatrix3: { value: new THREE.Matrix3() },
      uRadius: { value: 0.9 }, uIntensity: { value: 1.9 },
      uSamples: { value: this.quality.aoSamples }, uFrameIndex: { value: 0 },
      uProjParams: { value: new THREE.Vector2(0.05, 500) },
      uInvProjection: { value: new THREE.Matrix4() },
      uProjection: { value: new THREE.Matrix4() },
      uTexelSize: { value: new THREE.Vector2() }
    });

    this.aoBlurPass = new FullscreenPass(AO_BLUR_FRAG, {
      uAO: { value: null }, uDirection: { value: new THREE.Vector2(1, 0) },
      uTexelSize: { value: new THREE.Vector2() }
    });

    this.aoTemporalPass = new FullscreenPass(AO_TEMPORAL_FRAG, {
      uAO: { value: null }, uHistory: { value: null }, uVelocity: { value: null },
      uTexelSize: { value: new THREE.Vector2() }
    });

    this.taaPass = new FullscreenPass(TAA_FRAG, {
      uCurrent: { value: null }, uHistory: { value: null }, uVelocity: { value: null },
      uDepth: { value: null }, uTexelSize: { value: new THREE.Vector2() },
      uBlend: { value: 0.9 }, uFirstFrame: { value: 1 }
    });

    this.tileMaxPass = new FullscreenPass(TILE_MAX_FRAG, {
      uVelocity: { value: null }, uTexelSize: { value: new THREE.Vector2() },
      uTileSize: { value: TILE_SIZE }
    });
    this.tileDilatePass = new FullscreenPass(TILE_DILATE_FRAG, {
      uTiles: { value: null }, uTexelSize: { value: new THREE.Vector2() }
    });
    this.motionBlurPass = new FullscreenPass(MOTION_BLUR_FRAG, {
      uColor: { value: null }, uVelocity: { value: null }, uNeighborMax: { value: null },
      uDepth: { value: null }, uStrength: { value: 1.0 }, uSamples: { value: 8 },
      uFrameIndex: { value: 0 },
      uProjParams: { value: new THREE.Vector2(0.05, 500) },
      uInvProjection: { value: new THREE.Matrix4() },
      uProjection: { value: new THREE.Matrix4() },
      uTexelSize: { value: new THREE.Vector2() }
    });

    this.bloomPrefilterPass = new FullscreenPass(BLOOM_PREFILTER_FRAG, {
      uColor: { value: null }, uExposure: { value: null },
      uThreshold: { value: 1.05 }, uSoftKnee: { value: 0.6 }
    });
    this.bloomDownPass = new FullscreenPass(BLOOM_DOWN_FRAG, {
      uSource: { value: null }, uTexelSize: { value: new THREE.Vector2() }, uKaris: { value: 1 }
    });
    this.bloomUpPass = new FullscreenPass(BLOOM_UP_FRAG, {
      uSource: { value: null }, uPrevious: { value: null },
      uTexelSize: { value: new THREE.Vector2() }, uRadius: { value: 1.15 }
    });

    this.luminancePass = new FullscreenPass(LUMINANCE_FRAG, {
      uColor: { value: null }, uTexelSize: { value: new THREE.Vector2() }
    });
    this.luminanceDownPass = new FullscreenPass(LUMINANCE_DOWN_FRAG, {
      uSource: { value: null }, uTexelSize: { value: new THREE.Vector2() }
    });
    this.exposurePass = new FullscreenPass(EXPOSURE_FRAG, {
      uLuminance: { value: null }, uPrevExposure: { value: null },
      uDeltaTime: { value: 0.016 }, uBrightenSpeed: { value: 2.6 }, uDarkenSpeed: { value: 1.1 },
      uCompensation: { value: EXPOSURE_COMPENSATION }, uMinEV: { value: -2.5 }, uMaxEV: { value: 6.5 },
      uReset: { value: 1 }
    });

    this.compositePass = new FullscreenPass(COMPOSITE_FRAG, {
      uColor: { value: null }, uBloom: { value: null }, uExposure: { value: null },
      uLut: { value: this.lut.texture }, uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 }, uBloomStrength: { value: 0.05 }, uVignette: { value: 0.5 },
      uGrain: { value: 0.35 }, uChromatic: { value: 0.4 }, uSharpen: { value: 0.32 },
      uLutSize: { value: this.lut.size }, uDamageFlash: { value: 0 },
      uDamageDir: { value: new THREE.Vector2(0, 1) }, uCriticalHealth: { value: 0 },
      uExposureOverride: { value: 0 }, uLensDirt: { value: 0.35 }
    });

    this.blitPass = new FullscreenPass(BLIT_FRAG, { uSource: { value: null } });

    this.debugPass = new FullscreenPass(DEBUG_FRAG, {
      uColor: { value: null }, uNormal: { value: null }, uVelocity: { value: null },
      uAO: { value: null }, uDepth: { value: null }, uDirect: { value: null },
      uAmbient: { value: null }, uBloom: { value: null },
      uShadowMap: { value: this.shadows.target.texture },
      uMode: { value: 0 }, uCascadeCount: { value: this.quality.shadowCascades }
    });
  }

  setQuality(quality) {
    this.quality = quality;
    this.shadows.setResolution(quality.shadowResolution);
    this.shadows.cascadeCount = Math.min(quality.shadowCascades, this.shadows.cameras.length);
    this.lightUniforms.uCascadeCount.value = this.shadows.cascadeCount;
    this.lightUniforms.uShadowTexel.value = 1 / quality.shadowResolution;
    this.gtaoPass.uniforms.uSamples.value = quality.aoSamples;
    this.sky.setQuality(quality);
    this.renderScale = quality.renderScale;
    this.resize(this.width, this.height, true);
  }

  resize(width, height, force = false) {
    width = Math.max(2, Math.floor(width));
    height = Math.max(2, Math.floor(height));
    const rw = Math.max(2, Math.floor(width * this.renderScale));
    const rh = Math.max(2, Math.floor(height * this.renderScale));
    if (!force && rw === this.renderWidth && rh === this.renderHeight && width === this.width) return;

    this.width = width;
    this.height = height;
    this.renderWidth = rw;
    this.renderHeight = rh;

    this._disposeTargets();

    const hdrOpts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false
    };

    this.depthTexture = new THREE.DepthTexture(rw, rh);
    this.depthTexture.format = THREE.DepthFormat;
    this.depthTexture.type = THREE.UnsignedIntType;
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;

    this.gbuffer = new THREE.WebGLRenderTarget(rw, rh, {
      count: 4, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      depthTexture: this.depthTexture
    });
    this.gbuffer.textures[0].name = 'gDirect';
    this.gbuffer.textures[1].name = 'gAmbient';
    this.gbuffer.textures[2].name = 'gNormal';
    this.gbuffer.textures[3].name = 'gVelocity';
    this.gbuffer.textures[3].format = THREE.RGFormat;
    this.gbuffer.textures[0].minFilter = this.gbuffer.textures[0].magFilter = THREE.LinearFilter;
    this.gbuffer.textures[1].minFilter = this.gbuffer.textures[1].magFilter = THREE.LinearFilter;

    this.hdrTarget = new THREE.WebGLRenderTarget(rw, rh, { ...hdrOpts, depthBuffer: true, depthTexture: this.depthTexture });
    this.taaTarget = new THREE.WebGLRenderTarget(rw, rh, hdrOpts);
    this.taaHistory = new THREE.WebGLRenderTarget(rw, rh, hdrOpts);
    this.blurTarget = new THREE.WebGLRenderTarget(rw, rh, hdrOpts);

    const aoW = Math.max(2, Math.floor(rw * 0.5));
    const aoH = Math.max(2, Math.floor(rh * 0.5));
    const aoOpts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
    };
    this.aoTarget = new THREE.WebGLRenderTarget(aoW, aoH, aoOpts);
    this.aoTargetB = new THREE.WebGLRenderTarget(aoW, aoH, aoOpts);
    this.aoHistory = new THREE.WebGLRenderTarget(aoW, aoH, aoOpts);

    const tw = Math.max(2, Math.ceil(rw / TILE_SIZE));
    const th = Math.max(2, Math.ceil(rh / TILE_SIZE));
    this.tileTarget = new THREE.WebGLRenderTarget(tw, th, aoOpts);
    this.tileDilated = new THREE.WebGLRenderTarget(tw, th, aoOpts);

    this.bloomTargets = [];
    let bw = Math.max(2, rw >> 1), bh = Math.max(2, rh >> 1);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloomTargets.push(new THREE.WebGLRenderTarget(bw, bh, hdrOpts));
      bw = Math.max(2, bw >> 1);
      bh = Math.max(2, bh >> 1);
    }
    this.bloomUpTargets = [];
    bw = Math.max(2, rw >> 1); bh = Math.max(2, rh >> 1);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloomUpTargets.push(new THREE.WebGLRenderTarget(bw, bh, hdrOpts));
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
    }

    this.lumTargets = [];
    let lw = 128;
    while (lw >= 1) {
      this.lumTargets.push(new THREE.WebGLRenderTarget(lw, lw, {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
      }));
      if (lw === 1) break;
      lw = Math.max(1, lw >> 1);
    }
    const expOpts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false
    };
    this.exposureTargets = [
      new THREE.WebGLRenderTarget(1, 1, expOpts),
      new THREE.WebGLRenderTarget(1, 1, expOpts)
    ];
    this.exposureIndex = 0;
    this.exposurePass.uniforms.uReset.value = 1;
    this.taaPass.uniforms.uFirstFrame.value = 1;

    this.sky.resize(rw, rh, this.quality);
  }

  _disposeTargets() {
    const all = [
      this.gbuffer, this.hdrTarget, this.taaTarget, this.taaHistory, this.blurTarget,
      this.aoTarget, this.aoTargetB, this.aoHistory, this.tileTarget, this.tileDilated,
      ...(this.bloomTargets || []), ...(this.bloomUpTargets || []),
      ...(this.lumTargets || []), ...(this.exposureTargets || [])
    ];
    for (const t of all) if (t) t.dispose();
    if (this.depthTexture) this.depthTexture.dispose();
  }

  setDynamicScale(scale) {
    scale = THREE.MathUtils.clamp(scale, 0.55, 1.0);
    if (Math.abs(scale - this.renderScale) < 0.02) return;
    this.renderScale = scale;
    this.resize(this.width, this.height, true);
  }

  updateSkyUniforms() {
    const u = this.lightUniforms;
    const sky = this.sky;
    // On a clear day the sun puts five to seven times more light on flat ground
    // than the whole sky dome does. Anything closer than that and the shadows
    // stop reading, which is the single biggest tell of a fake outdoor scene.
    const sunScale = sky.sunIntensity * 0.95;
    u.uSunColor.value.set(
      sky.sunColor.r * sunScale,
      sky.sunColor.g * sunScale,
      sky.sunColor.b * sunScale
    );
    // The probe is projected from a sky that already carries the sun's aureole
    // and its cloud deck, so taking it at face value double-counts the sun.
    for (let i = 0; i < 9; i++) u.uSkySH.value[i].copy(sky.sh[i]).multiplyScalar(SKY_IRRADIANCE);
    u.uHorizonColor.value.set(sky.horizonColor.r, sky.horizonColor.g, sky.horizonColor.b);
    u.uZenithColor.value.set(sky.zenithColor.r, sky.zenithColor.g, sky.zenithColor.b);
    u.uGroundColor.value.set(sky.groundColor.r, sky.groundColor.g, sky.groundColor.b);
    const fog = sky.horizonColor;
    u.uFogColor.value.set(
      fog.r * 0.55 + sky.averageSky.r * 0.4,
      fog.g * 0.55 + sky.averageSky.g * 0.4,
      fog.b * 0.55 + sky.averageSky.b * 0.45
    );
  }

  /** Push the active dynamic lights (muzzle flash, explosions) to the shader. */
  setPointLights(lights) {
    const u = this.lightUniforms;
    const n = Math.min(8, lights.length);
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      u.uPointLights.value[i].set(l.position.x, l.position.y, l.position.z, l.radius);
      u.uPointColors.value[i].set(l.color.x * l.intensity, l.color.y * l.intensity, l.color.z * l.intensity, 0);
    }
    u.uPointLightCount.value = n;
  }

  applyJitter(camera) {
    const [jx, jy] = HALTON[this.frameIndex % HALTON.length];
    this.jitter.set(
      (jx * 2) / this.renderWidth,
      (jy * 2) / this.renderHeight,
      this.jitter.x, this.jitter.y
    );
    void camera;
  }

  /**
   * @param {object} scenes { world, transparent, viewmodel, viewmodelShadow }
   */
  render(camera, viewmodelCamera, scenes, dt, options = {}) {
    const renderer = this.renderer;
    const u = this.lightUniforms;
    const q = this.quality;

    renderer.info.autoReset = false;
    renderer.info.reset();

    u.uCameraPos.value.copy(camera.position);
    u.uTime.value = options.time || 0;
    this.currViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    if (viewmodelCamera) {
      this.vmCurrViewProjection.multiplyMatrices(
        viewmodelCamera.projectionMatrix, viewmodelCamera.matrixWorldInverse
      );
      if (!this._vmHistoryValid) {
        this.vmPrevViewProjection.copy(this.vmCurrViewProjection);
        this._vmHistoryValid = true;
      }
    }

    this.applyJitter(camera);

    // ---------------------------------------------------------------- clouds
    this.sky.renderClouds(camera);

    // --------------------------------------------------------------- shadows
    this.shadows.update(camera, this.sky.sunDirection);
    this.shadows.render(scenes.world, this.sky.sunDirection);
    if (scenes.viewmodel && scenes.viewmodel.visible) {
      _vmCenter.setFromMatrixPosition(scenes.viewmodel.matrixWorld);
      this.shadows.renderViewmodel(scenes.viewmodel, this.sky.sunDirection, _vmCenter);
    }

    // ------------------------------------------------------- MRT main pass
    renderer.setRenderTarget(this.gbuffer);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);

    // sky first: fills colour + velocity where nothing else writes depth
    this.sky.renderSky(camera, this.prevViewProjection, this.gbuffer);

    renderer.setRenderTarget(this.gbuffer);
    renderer.autoClear = false;
    renderer.render(scenes.world, camera);

    // viewmodel with its own FOV, depth cleared so it never intersects walls
    if (scenes.viewmodel && scenes.viewmodel.visible) {
      renderer.clearDepth();
      renderer.render(scenes.viewmodel, viewmodelCamera);
    }
    renderer.autoClear = true;

    // ------------------------------------------------------------------ GTAO
    const aoTexel = _v2a.set(1 / this.aoTarget.width, 1 / this.aoTarget.height);
    if (q.aoEnabled) {
      const g = this.gtaoPass.uniforms;
      g.uDepth.value = this.depthTexture;
      g.uNormal.value = this.gbuffer.textures[2];
      g.uVelocity.value = this.gbuffer.textures[3];
      g.uFrameIndex.value = this.frameIndex;
      g.uProjParams.value.set(camera.near, camera.far);
      g.uInvProjection.value.copy(camera.projectionMatrixInverse);
      g.uProjection.value.copy(camera.projectionMatrix);
      g.uTexelSize.value.copy(aoTexel);
      _m3.setFromMatrix4(camera.matrixWorldInverse);
      g.viewMatrix3.value.copy(_m3);
      this.gtaoPass.render(renderer, this.aoTarget);

      const bu = this.aoBlurPass.uniforms;
      bu.uTexelSize.value.copy(aoTexel);
      bu.uAO.value = this.aoTarget.texture;
      bu.uDirection.value.set(1, 0);
      this.aoBlurPass.render(renderer, this.aoTargetB);
      bu.uAO.value = this.aoTargetB.texture;
      bu.uDirection.value.set(0, 1);
      this.aoBlurPass.render(renderer, this.aoTarget);

      const at = this.aoTemporalPass.uniforms;
      at.uAO.value = this.aoTarget.texture;
      at.uHistory.value = this.aoHistory.texture;
      at.uVelocity.value = this.gbuffer.textures[3];
      at.uTexelSize.value.copy(aoTexel);
      this.aoTemporalPass.render(renderer, this.aoTargetB);
      const swap = this.aoTarget; this.aoTarget = this.aoTargetB; this.aoTargetB = swap;
      // keep history in sync
      this.blitPass.uniforms.uSource.value = this.aoTarget.texture;
      this.blitPass.render(renderer, this.aoHistory);
    }

    // --------------------------------------------------------------- combine
    const c = this.combinePass.uniforms;
    c.uDirect.value = this.gbuffer.textures[0];
    c.uAmbient.value = this.gbuffer.textures[1];
    c.uAO.value = q.aoEnabled ? this.aoTarget.texture : _whiteTexture(renderer);
    c.uAOStrength.value = q.aoEnabled ? 1.0 : 0.0;
    this.combinePass.render(renderer, this.hdrTarget);

    // ----------------------------------------- forward transparents + effects
    if (scenes.transparent && scenes.transparent.children.length) {
      renderer.setRenderTarget(this.hdrTarget);
      renderer.autoClear = false;
      renderer.render(scenes.transparent, camera);
      renderer.autoClear = true;
    }
    if (scenes.viewmodelTransparent && scenes.viewmodelTransparent.children.length && scenes.viewmodel.visible) {
      renderer.setRenderTarget(this.hdrTarget);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scenes.viewmodelTransparent, viewmodelCamera);
      renderer.autoClear = true;
    }

    // ------------------------------------------------------------------- TAA
    let colorTex = this.hdrTarget.texture;
    if (q.taa) {
      const t = this.taaPass.uniforms;
      t.uCurrent.value = this.hdrTarget.texture;
      t.uHistory.value = this.taaHistory.texture;
      t.uVelocity.value = this.gbuffer.textures[3];
      t.uDepth.value = this.depthTexture;
      t.uTexelSize.value.set(1 / this.renderWidth, 1 / this.renderHeight);
      t.uBlend.value = 0.9;
      this.taaPass.render(renderer, this.taaTarget);
      this.blitPass.uniforms.uSource.value = this.taaTarget.texture;
      this.blitPass.render(renderer, this.taaHistory);
      t.uFirstFrame.value = 0;
      colorTex = this.taaTarget.texture;
    }

    // ----------------------------------------------------------- motion blur
    if (q.motionBlur !== 'off') {
      const strength = q.motionBlur === 'high' ? 0.8 : 0.45;
      const tm = this.tileMaxPass.uniforms;
      tm.uVelocity.value = this.gbuffer.textures[3];
      tm.uTexelSize.value.set(1 / this.renderWidth, 1 / this.renderHeight);
      this.tileMaxPass.render(renderer, this.tileTarget);
      const td = this.tileDilatePass.uniforms;
      td.uTiles.value = this.tileTarget.texture;
      td.uTexelSize.value.set(1 / this.tileTarget.width, 1 / this.tileTarget.height);
      this.tileDilatePass.render(renderer, this.tileDilated);

      const mb = this.motionBlurPass.uniforms;
      mb.uColor.value = colorTex;
      mb.uVelocity.value = this.gbuffer.textures[3];
      mb.uNeighborMax.value = this.tileDilated.texture;
      mb.uDepth.value = this.depthTexture;
      mb.uStrength.value = strength * (options.motionBlurScale ?? 1);
      mb.uSamples.value = q.motionBlur === 'high' ? 12 : 7;
      mb.uFrameIndex.value = this.frameIndex;
      mb.uProjParams.value.set(camera.near, camera.far);
      mb.uTexelSize.value.set(1 / this.renderWidth, 1 / this.renderHeight);
      this.motionBlurPass.render(renderer, this.blurTarget);
      colorTex = this.blurTarget.texture;
    }

    // -------------------------------------------------------------- exposure
    const lum = this.luminancePass.uniforms;
    lum.uColor.value = colorTex;
    lum.uTexelSize.value.set(1 / this.renderWidth, 1 / this.renderHeight);
    this.luminancePass.render(renderer, this.lumTargets[0]);
    for (let i = 1; i < this.lumTargets.length; i++) {
      const ld = this.luminanceDownPass.uniforms;
      ld.uSource.value = this.lumTargets[i - 1].texture;
      ld.uTexelSize.value.set(1 / this.lumTargets[i - 1].width, 1 / this.lumTargets[i - 1].height);
      this.luminanceDownPass.render(renderer, this.lumTargets[i]);
    }
    const src = this.exposureTargets[this.exposureIndex];
    const dst = this.exposureTargets[1 - this.exposureIndex];
    const ex = this.exposurePass.uniforms;
    ex.uLuminance.value = this.lumTargets[this.lumTargets.length - 1].texture;
    ex.uPrevExposure.value = src.texture;
    ex.uDeltaTime.value = Math.min(dt, 0.1);
    // The time of day biases the meter. Without this an auto-exposed night is
    // a daylit scene with a blue sky: the meter opens by exactly as much as the
    // sun was dimmed and hands back the picture it started with.
    //
    // Biasing alone is not enough, because `uMinEV` is a ceiling on how far the
    // meter may open and it sits at -2.5, which is 5.7x. A night scene is dark
    // enough to hit that ceiling and spend all of it, so the bias got eaten and
    // night came out as overcast afternoon. Moving the whole clamp window with
    // the bias keeps the meter's adaptive range — dark interiors still open up
    // — while denying it the headroom to undo the time of day.
    const bias = this.sky.exposureBias ?? 0;
    ex.uCompensation.value = EXPOSURE_COMPENSATION + bias;
    ex.uMinEV.value = EXPOSURE_MIN_EV - bias;
    ex.uMaxEV.value = EXPOSURE_MAX_EV - bias;
    this.exposurePass.render(renderer, dst);
    this.exposureIndex = 1 - this.exposureIndex;
    ex.uReset.value = 0;
    const exposureTex = dst.texture;

    // ----------------------------------------------------------------- bloom
    if (q.bloom) {
      const bp = this.bloomPrefilterPass.uniforms;
      bp.uColor.value = colorTex;
      bp.uExposure.value = exposureTex;
      this.bloomPrefilterPass.render(renderer, this.bloomTargets[0]);
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        const bd = this.bloomDownPass.uniforms;
        bd.uSource.value = this.bloomTargets[i - 1].texture;
        bd.uTexelSize.value.set(1 / this.bloomTargets[i - 1].width, 1 / this.bloomTargets[i - 1].height);
        bd.uKaris.value = i === 1 ? 1 : 0;
        this.bloomDownPass.render(renderer, this.bloomTargets[i]);
      }
      this.blitPass.uniforms.uSource.value = this.bloomTargets[BLOOM_LEVELS - 1].texture;
      this.blitPass.render(renderer, this.bloomUpTargets[BLOOM_LEVELS - 1]);
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const bu2 = this.bloomUpPass.uniforms;
        bu2.uSource.value = this.bloomUpTargets[i + 1].texture;
        bu2.uPrevious.value = this.bloomTargets[i].texture;
        bu2.uTexelSize.value.set(1 / this.bloomUpTargets[i + 1].width, 1 / this.bloomUpTargets[i + 1].height);
        this.bloomUpPass.render(renderer, this.bloomUpTargets[i]);
      }
    }

    // ------------------------------------------------------------- composite
    const cp = this.compositePass.uniforms;
    cp.uColor.value = colorTex;
    cp.uBloom.value = q.bloom ? this.bloomUpTargets[0].texture : _blackTexture(renderer);
    cp.uExposure.value = exposureTex;
    cp.uResolution.value.set(this.renderWidth, this.renderHeight);
    cp.uTime.value = options.time || 0;
    cp.uBloomStrength.value = q.bloom ? 0.055 : 0;
    cp.uDamageFlash.value = options.damageFlash || 0;
    if (options.damageDir) cp.uDamageDir.value.copy(options.damageDir);
    cp.uCriticalHealth.value = options.criticalHealth || 0;

    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, this.width, this.height);
    if (this.debugView > 0) {
      const d = this.debugPass.uniforms;
      d.uColor.value = colorTex;
      d.uNormal.value = this.gbuffer.textures[2];
      d.uVelocity.value = this.gbuffer.textures[3];
      d.uAO.value = this.aoTarget.texture;
      d.uDepth.value = this.depthTexture;
      d.uDirect.value = this.gbuffer.textures[0];
      d.uAmbient.value = this.gbuffer.textures[1];
      d.uBloom.value = q.bloom ? this.bloomUpTargets[0].texture : _blackTexture(renderer);
      d.uMode.value = this.debugView;
      d.uCascadeCount.value = this.shadows.cascadeCount;
      this.debugPass.render(renderer, null);
    } else {
      this.compositePass.render(renderer, null);
    }

    this.stats.drawCalls = renderer.info.render.calls;
    this.stats.triangles = renderer.info.render.triangles;

    this.prevViewProjection.copy(this.currViewProjection);
    this.vmPrevViewProjection.copy(this.vmCurrViewProjection);
    this.frameIndex++;
  }

  dispose() {
    this._disposeTargets();
    this.shadows.dispose();
    this.sky.dispose();
    this.lut.texture.dispose();
    for (const p of [
      this.combinePass, this.gtaoPass, this.aoBlurPass, this.aoTemporalPass, this.taaPass,
      this.tileMaxPass, this.tileDilatePass, this.motionBlurPass, this.bloomPrefilterPass,
      this.bloomDownPass, this.bloomUpPass, this.luminancePass, this.luminanceDownPass,
      this.exposurePass, this.compositePass, this.blitPass, this.debugPass
    ]) p.dispose();
  }
}

let _white = null, _black = null;
function _whiteTexture() {
  if (!_white) {
    _white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    _white.needsUpdate = true;
  }
  return _white;
}
function _blackTexture() {
  if (!_black) {
    _black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    _black.needsUpdate = true;
  }
  return _black;
}

const _v2a = new THREE.Vector2();
const _m3 = new THREE.Matrix3();
const _vmCenter = new THREE.Vector3();
