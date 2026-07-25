import * as THREE from 'three';
import { WORLD_VERT, WORLD_FRAG } from './shaders/world.glsl.js';
import { CHARACTER_VERT, CHARACTER_FRAG } from './shaders/character.glsl.js';

/**
 * Factory for the shared world material. Every static and dynamic surface in
 * the game uses this one shader; variation comes from the per-vertex layer
 * index, tint and wear attributes plus the texture arrays.
 */
export class MaterialFactory {
  constructor(lightUniforms, materialLibrary) {
    this.lightUniforms = lightUniforms;
    this.lib = materialLibrary;
    this.materials = [];
  }

  _baseUniforms() {
    return {
      ...this.lightUniforms,
      uAlbedoArray: { value: this.lib.albedo },
      uNormalArray: { value: this.lib.normal },
      uOrmArray: { value: this.lib.orm },
      uPrevModelMatrix: { value: new THREE.Matrix4() },
      uPrevModelValid: { value: 0 },
      uDetailStrength: { value: 1.0 },
      uViewmodelLight: { value: 0 }
    };
  }

  create({ side = THREE.FrontSide, detailStrength = 1.0, name = 'world' } = {}) {
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: WORLD_VERT,
      fragmentShader: WORLD_FRAG,
      uniforms: this._baseUniforms(),
      side,
      transparent: false,
      depthTest: true,
      depthWrite: true
    });
    mat.uniforms.uDetailStrength.value = detailStrength;
    mat.name = name;
    this.materials.push(mat);
    return mat;
  }

  /**
   * Dynamic objects need their own previous model matrix for velocity.
   * The heavy uniforms (textures, lighting) are shared by reference.
   */
  createDynamic(name, opts = {}) {
    const mat = this.create({ name, ...opts });
    mat.uniforms.uPrevModelValid.value = 1;
    mat.userData.dynamic = true;
    return mat;
  }

  /**
   * The viewmodel is rendered through a narrower camera, so it needs its own
   * previous view-projection or TAA and motion blur reproject it against the
   * world camera and smear the gun across the screen.
   */
  createViewmodel(name, prevViewProjection, opts = {}) {
    const mat = this.createDynamic(name, opts);
    mat.uniforms.uPrevViewProjection = { value: prevViewProjection };
    mat.uniforms.uViewmodelLight.value = 1;
    mat.userData.viewmodel = true;
    return mat;
  }

  /**
   * Characters carry their whole pose in a bone array, so they get a distinct
   * shader with per-bone previous transforms for clean motion vectors on a
   * running body.
   */
  createCharacter(prevViewProjection) {
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: CHARACTER_VERT,
      fragmentShader: CHARACTER_FRAG,
      uniforms: {
        ...this.lightUniforms,
        uAlbedoArray: { value: this.lib.albedo },
        uNormalArray: { value: this.lib.normal },
        uOrmArray: { value: this.lib.orm },
        uDetailStrength: { value: 1.0 },
        uHitFlash: { value: 0 },
        uBones: { value: null },
        uPrevBones: { value: null },
        uPrevViewProjection: prevViewProjection
          ? { value: prevViewProjection }
          : this.lightUniforms.uPrevViewProjection
      },
      side: THREE.FrontSide,
      transparent: false,
      depthTest: true,
      depthWrite: true
    });
    mat.name = 'character';
    this.materials.push(mat);
    return mat;
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
  }
}

/**
 * Track previous world matrices for correct per-object motion vectors.
 * Called once per frame after all transforms are final.
 */
export class VelocityTracker {
  constructor() {
    this.entries = [];
  }

  register(mesh, material) {
    this.entries.push({ mesh, material, prev: new THREE.Matrix4().copy(mesh.matrixWorld) });
  }

  unregister(mesh) {
    const i = this.entries.findIndex((e) => e.mesh === mesh);
    if (i >= 0) this.entries.splice(i, 1);
  }

  /** Push current matrices into the shader, then store them for next frame. */
  update() {
    for (const e of this.entries) {
      e.material.uniforms.uPrevModelMatrix.value.copy(e.prev);
    }
  }

  commit() {
    for (const e of this.entries) e.prev.copy(e.mesh.matrixWorld);
  }
}
