import * as THREE from 'three';
import { GLSL_FULLSCREEN_VERT } from './shaders/noise.glsl.js';

const _quadGeom = new THREE.BufferGeometry();
_quadGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
_quadGeom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

const _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** A single full-screen triangle pass with its own shader + uniforms. */
export class FullscreenPass {
  constructor(fragmentShader, uniforms = {}, defines = {}) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: `precision highp float;\nprecision highp int;\nin vec3 position;\nin vec2 uv;\n${GLSL_FULLSCREEN_VERT}`,
      fragmentShader: `precision highp float;\nprecision highp int;\nprecision highp sampler2DArray;\nprecision highp sampler3D;\n${fragmentShader}`,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(_quadGeom, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  get uniforms() { return this.material.uniforms; }

  render(renderer, target = null, layer = undefined) {
    renderer.setRenderTarget(target, layer);
    renderer.render(this.scene, _camera);
  }

  dispose() {
    this.material.dispose();
  }
}

export const fullscreenCamera = _camera;
export const fullscreenGeometry = _quadGeom;
