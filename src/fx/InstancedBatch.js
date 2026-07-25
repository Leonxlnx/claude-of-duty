import * as THREE from 'three';
import { GLSL_LIGHTING } from '../render/shaders/world.glsl.js';
import { GLSL_NOISE } from '../render/shaders/noise.glsl.js';

const INST_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in mat4 instanceMatrix;
in vec3 iTint;
in float iVisible;

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 uPrevViewProjection;
uniform vec4 uJitter;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vTint;
out vec4 vCurClip;
out vec4 vPrevClip;

void main(){
  vec4 wp = instanceMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(instanceMatrix) * normal);
  vUv = uv;
  vTint = iTint;
  vec4 clip = projectionMatrix * viewMatrix * wp;
  if(iVisible < 0.5) clip = vec4(2.0, 2.0, 2.0, 1.0);
  vCurClip = clip;
  vPrevClip = uPrevViewProjection * wp;
  clip.xy += uJitter.xy * clip.w;
  gl_Position = clip;
}
`;

const INST_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
${GLSL_NOISE}
${GLSL_LIGHTING}

uniform mat4 viewMatrix;
uniform float uRoughness;
uniform float uMetal;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec3 vTint;
in vec4 vCurClip;
in vec4 vPrevClip;

layout(location = 0) out vec4 outDirect;
layout(location = 1) out vec4 outAmbient;
layout(location = 2) out vec4 outNormal;
layout(location = 3) out vec4 outVelocity;

void main(){
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 N = normalize(vNormal);
  float viewDepth = -(viewMatrix * vec4(vWorldPos, 1.0)).z;
  SurfaceOut s = shadeSurface(vWorldPos, N, V, vTint, uRoughness, uMetal, 1.0, viewDepth, 1.0, 0.0);

  float dist = distance(uCameraPos, vWorldPos);
  float fogAmount = 1.0 - exp(-dist * uFogDensity);
  outDirect = vec4(mix(s.direct, vec3(0.0), fogAmount), 0.0);
  outAmbient = vec4(mix(s.ambient, uFogColor, fogAmount), 1.0);
  outNormal = vec4(octEncode(N), uRoughness, 0.25);

  vec2 curNdc = vCurClip.xy / max(vCurClip.w, 1e-6);
  vec2 prevNdc = vPrevClip.xy / max(vPrevClip.w, 1e-6);
  outVelocity = vec4((curNdc - prevNdc) * 0.5, 0.0, 1.0);
}
`;

/**
 * Pool of small rigid props (spent casings, dropped magazines, debris chunks)
 * drawn in one instanced call and driven directly by rigid bodies.
 */
export class InstancedBatch {
  constructor(geometry, lightUniforms, capacity, { roughness = 0.35, metal = 0.9 } = {}) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, null, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = capacity;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.tints = new Float32Array(capacity * 3).fill(1);
    this.visible = new Float32Array(capacity);
    geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(this.tints, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('iVisible', new THREE.InstancedBufferAttribute(this.visible, 1).setUsage(THREE.DynamicDrawUsage));
    this.aTint = geometry.getAttribute('iTint');
    this.aVisible = geometry.getAttribute('iVisible');

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: INST_VERT,
      fragmentShader: INST_FRAG,
      uniforms: {
        ...lightUniforms,
        uRoughness: { value: roughness },
        uMetal: { value: metal }
      }
    });
    this.mesh.material = this.material;

    this.slots = [];
    for (let i = 0; i < capacity; i++) this.slots.push(i);
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  acquire(tint) {
    const i = this.slots.pop();
    if (i === undefined) return -1;
    this.visible[i] = 1;
    if (tint) {
      this.tints[i * 3] = tint[0];
      this.tints[i * 3 + 1] = tint[1];
      this.tints[i * 3 + 2] = tint[2];
    }
    this.aTint.needsUpdate = true;
    return i;
  }

  release(i) {
    if (i < 0) return;
    this.visible[i] = 0;
    this.slots.push(i);
    this.aVisible.needsUpdate = true;
  }

  setTransform(i, position, quaternion, scale = null) {
    this._m.compose(position, quaternion, scale || this._s);
    this.mesh.setMatrixAt(i, this._m);
  }

  flush() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aVisible.needsUpdate = true;
  }

  clear() {
    this.slots.length = 0;
    for (let i = 0; i < this.capacity; i++) { this.slots.push(i); this.visible[i] = 0; }
    this.aVisible.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** A 5.56 case: tapered body, extractor groove, hollow mouth. */
export function casingGeometry() {
  const g = new THREE.CylinderGeometry(0.0046, 0.0050, 0.0455, 8, 1, true);
  const rim = new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 8);
  rim.translate(0, -0.0245, 0);
  const merged = mergeSimple([g, rim]);
  merged.rotateZ(Math.PI * 0.5);
  return merged;
}

export function magazineGeometry() {
  const g = new THREE.BoxGeometry(0.028, 0.185, 0.042);
  return g;
}

/** Minimal geometry merge — enough for the two-part shapes above. */
function mergeSimple(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const t = g.attributes.uv.array;
    pos.set(p, vo * 3);
    nrm.set(n, vo * 3);
    uv.set(t, vo * 2);
    const gi = g.index ? g.index.array : null;
    const count = g.attributes.position.count;
    if (gi) {
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < count; i++) idx[io + i] = i + vo;
      io += count;
    }
    vo += count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
