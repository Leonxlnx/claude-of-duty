import * as THREE from 'three';
import { GLSL_LIGHTING } from '../render/shaders/world.glsl.js';
import { GLSL_NOISE } from '../render/shaders/noise.glsl.js';

export const DECAL = { HOLE_HARD: 0, HOLE_SOFT: 1, HOLE_METAL: 2, HOLE_GLASS: 3, SCORCH: 4, BLOOD: 5 };

const DECAL_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 aDecal;      // x kind, y seed, z age-normalised fade, w scale
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec4 uJitter;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec4 vDecal;
void main(){
  vWorldPos = position;
  vNormal = normal;
  vUv = uv;
  vDecal = aDecal;
  vec4 clip = projectionMatrix * viewMatrix * vec4(position, 1.0);
  clip.xy += uJitter.xy * clip.w;
  gl_Position = clip;
}
`;

const DECAL_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DArray;
${GLSL_NOISE}
${GLSL_LIGHTING}

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec4 vDecal;
uniform mat4 viewMatrix;
layout(location = 0) out vec4 outColor;

void main(){
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  int kind = int(vDecal.x + 0.5);
  float seed = vDecal.y;
  float fade = vDecal.z;

  vec3 albedo = vec3(0.1);
  float alpha = 0.0;
  float rough = 0.85;
  float crater = 0.0;

  if(kind <= 3){
    // impact crater: a dark punched hole ringed by spalled, brighter material
    float wobble = fbm(c * 3.1 + seed * 41.0, 3, 0.6) - 0.5;
    float rr = r + wobble * 0.34;
    float hole = 1.0 - smoothstep(0.16, 0.34, rr);
    float ring = (1.0 - smoothstep(0.30, 0.92, rr)) * (1.0 - hole);
    float spall = (1.0 - smoothstep(0.55, 1.0, rr)) * 0.55;
    crater = hole;

    if(kind == 0){        // concrete / plaster / brick
      albedo = mix(vec3(0.62, 0.60, 0.56), vec3(0.030, 0.028, 0.026), hole);
      alpha = clamp(hole * 1.0 + ring * 0.85 + spall * 0.45, 0.0, 1.0);
    } else if(kind == 1){ // wood / fabric / sandbag
      albedo = mix(vec3(0.30, 0.21, 0.13), vec3(0.020, 0.015, 0.010), hole);
      alpha = clamp(hole * 1.0 + ring * 0.7 + spall * 0.3, 0.0, 1.0);
    } else if(kind == 2){ // metal: bright bare-metal scar, no dust ring
      albedo = mix(vec3(0.52, 0.53, 0.55), vec3(0.05, 0.05, 0.055), hole * 0.8);
      rough = mix(0.30, 0.7, hole);
      alpha = clamp(hole * 0.95 + ring * 0.75, 0.0, 1.0);
    } else {              // glass
      float shards = 0.0;
      for(int i = 0; i < 7; i++){
        float a = hash11(seed * 13.0 + float(i)) * 6.2831853;
        vec2 d = vec2(cos(a), sin(a));
        float line = abs(dot(c, vec2(-d.y, d.x)));
        shards = max(shards, (1.0 - smoothstep(0.0, 0.035, line)) * (1.0 - smoothstep(0.1, 1.0, r)));
      }
      albedo = vec3(0.78, 0.82, 0.86);
      alpha = clamp(hole * 0.9 + shards * 0.8, 0.0, 1.0);
      rough = 0.15;
    }
  } else if(kind == 4){
    float n = fbm(c * 2.2 + seed * 17.0, 4, 0.55);
    float mask = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.6);
    albedo = vec3(0.020, 0.018, 0.016);
    alpha = mask * 0.8;
    rough = 0.95;
  } else {
    // blood: dense core, feathered edge, a few thrown droplets
    float n = fbm(c * 2.8 + seed * 23.0, 4, 0.6);
    float core = 1.0 - smoothstep(0.15, 0.62, r + (n - 0.5) * 0.55);
    float spatter = 0.0;
    for(int i = 0; i < 6; i++){
      float a = hash11(seed * 7.0 + float(i) * 3.1) * 6.2831853;
      float d = 0.45 + hash11(seed * 11.0 + float(i)) * 0.5;
      vec2 p = vec2(cos(a), sin(a)) * d;
      spatter = max(spatter, 1.0 - smoothstep(0.0, 0.10 + hash11(float(i) + seed) * 0.07, length(c - p)));
    }
    albedo = mix(vec3(0.115, 0.010, 0.008), vec3(0.045, 0.004, 0.004), core);
    alpha = clamp(core + spatter * 0.85, 0.0, 1.0);
    rough = mix(0.45, 0.25, core);
  }

  alpha *= fade;
  if(alpha < 0.004) discard;

  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 N = normalize(vNormal);
  // craters read as depth by tilting the normal inward
  N = normalize(N - normalize(vec3(c.x, 0.0, c.y)) * crater * 0.0);
  float viewDepth = -(viewMatrix * vec4(vWorldPos, 1.0)).z;
  SurfaceOut s = shadeSurface(vWorldPos, N, V, albedo, rough, kind == 2 ? 0.85 : 0.0, 1.0, viewDepth, 1.0, 0.0);
  vec3 col = s.direct + s.ambient;

  float dist = distance(uCameraPos, vWorldPos);
  float fogAmount = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uFogColor, clamp(fogAmount, 0.0, 1.0));

  outColor = vec4(col, alpha);
}
`;

/**
 * Ring-buffer of projected quads. Decals are baked straight into one dynamic
 * buffer in world space — no per-decal object, no per-decal draw call — and the
 * oldest fades out as the budget is reused.
 */
export class DecalSystem {
  constructor(lightUniforms, budget = 256) {
    this.budget = budget;
    /** Allocated size. The live budget may shrink below it, never above. */
    this.capacity = budget;
    this.next = 0;
    this.count = 0;

    const verts = budget * 4;
    this.positions = new Float32Array(verts * 3);
    this.normals = new Float32Array(verts * 3);
    this.uvs = new Float32Array(verts * 2);
    this.decal = new Float32Array(verts * 4);
    const index = new Uint32Array(budget * 6);
    for (let i = 0; i < budget; i++) {
      const v = i * 4, o = i * 6;
      index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
      index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
    }
    for (let i = 0; i < budget; i++) {
      const u = i * 8;
      this.uvs[u] = 0; this.uvs[u + 1] = 0;
      this.uvs[u + 2] = 1; this.uvs[u + 3] = 0;
      this.uvs[u + 4] = 1; this.uvs[u + 5] = 1;
      this.uvs[u + 6] = 0; this.uvs[u + 7] = 1;
    }

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.aNrm = new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDecal = new THREE.BufferAttribute(this.decal, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('normal', this.aNrm);
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2));
    geo.setAttribute('aDecal', this.aDecal);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: { ...lightUniforms, viewMatrix: { value: new THREE.Matrix4() } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -6,
      side: THREE.DoubleSide
    });
    delete this.material.uniforms.viewMatrix;   // three provides it for us

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;

    this.ages = new Float32Array(budget);
    this.lifetimes = new Float32Array(budget);
    this.active = new Uint8Array(budget);
  }

  add(point, normal, kind, size, { seed = Math.random(), life = 46, tangentHint = null } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.budget;
    this.count = Math.min(this.count + 1, this.budget);

    _n.copy(normal).normalize();
    if (tangentHint) {
      _t.copy(tangentHint).sub(_n.clone().multiplyScalar(tangentHint.dot(_n)));
      if (_t.lengthSq() < 1e-6) _t.set(1, 0, 0);
    } else {
      _t.set(_n.z, _n.x, _n.y);
      _t.sub(_n.clone().multiplyScalar(_t.dot(_n)));
      if (_t.lengthSq() < 1e-6) _t.set(1, 0, 0);
    }
    _t.normalize();
    const angle = seed * Math.PI * 2;
    _t.applyAxisAngle(_n, angle);
    _b.crossVectors(_n, _t).normalize();

    const h = size * 0.5;
    const base = i * 4;
    _p.copy(point).addScaledVector(_n, 0.006);
    const corners = [
      [-h, -h], [h, -h], [h, h], [-h, h]
    ];
    for (let k = 0; k < 4; k++) {
      const [cu, cv] = corners[k];
      const vi = (base + k) * 3;
      this.positions[vi] = _p.x + _t.x * cu + _b.x * cv;
      this.positions[vi + 1] = _p.y + _t.y * cu + _b.y * cv;
      this.positions[vi + 2] = _p.z + _t.z * cu + _b.z * cv;
      this.normals[vi] = _n.x; this.normals[vi + 1] = _n.y; this.normals[vi + 2] = _n.z;
      const di = (base + k) * 4;
      this.decal[di] = kind;
      this.decal[di + 1] = seed;
      this.decal[di + 2] = 1;
      this.decal[di + 3] = size;
    }
    this.ages[i] = 0;
    this.lifetimes[i] = life;
    this.active[i] = 1;
    this.aPos.needsUpdate = true;
    this.aNrm.needsUpdate = true;
    this.aDecal.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count * 6 === 0 ? 0 : this.budget * 6);
    return i;
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.budget; i++) {
      if (!this.active[i]) continue;
      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];
      if (t >= 1) {
        this.active[i] = 0;
        for (let k = 0; k < 4; k++) this.decal[(i * 4 + k) * 4 + 2] = 0;
        dirty = true;
        continue;
      }
      // hold full opacity, then fade over the last quarter of the lifetime
      const f = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      for (let k = 0; k < 4; k++) this.decal[(i * 4 + k) * 4 + 2] = f;
      dirty = true;
    }
    if (dirty) this.aDecal.needsUpdate = true;
  }

  clear() {
    this.active.fill(0);
    this.decal.fill(0);
    this.count = 0;
    this.next = 0;
    this.geometry.setDrawRange(0, 0);
    this.aDecal.needsUpdate = true;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
