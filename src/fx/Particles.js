import * as THREE from 'three';
import { PARTICLE_VERT, PARTICLE_FRAG } from '../render/shaders/particle.glsl.js';

export const PKIND = { DUST: 0, SMOKE: 1, SPARK: 2, BLOOD: 3, TRACER: 4, FLASH: 5, DEBRIS: 6 };

/**
 * One instanced pool for every loose visual element. Simulation runs on the
 * CPU because the counts are modest and it lets impacts, gravity, wind and
 * collision against the BVH share the same code path as the rest of the game.
 */
export class ParticleSystem {
  constructor(capacity, quality) {
    this.capacity = capacity;
    this.count = 0;
    this.quality = quality;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);   // size, rotation, stretch, kind
    this.color = new Float32Array(capacity * 4);

    // per-particle simulation state, not uploaded
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.fade = new Uint8Array(capacity);           // 0 linear, 1 ease-out, 2 flash

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aParams = new THREE.InstancedBufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPosition', this.aPos);
    geo.setAttribute('iVelocity', this.aVel);
    geo.setAttribute('iParams', this.aParams);
    geo.setAttribute('iColor', this.aColor);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;
    quad.dispose();

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Vector3(1, 1, 1) },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uAmbient: { value: new THREE.Vector3(0.4, 0.45, 0.55) },
        uTime: { value: 0 },
        uJitter: { value: new THREE.Vector4() }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.wind = new THREE.Vector3(0.55, 0, 0.2);
  }

  /** Allocate a slot, recycling the oldest when the pool is saturated. */
  _alloc() {
    if (this.count < this.capacity) return this.count++;
    // saturated: evict whichever of a small random sample is closest to dying
    let oldest = 0, best = Infinity;
    for (let k = 0; k < 12; k++) {
      const i = (Math.random() * this.count) | 0;
      const remaining = this.life[i] - this.age[i];
      if (remaining < best) { best = remaining; oldest = i; }
    }
    return oldest;
  }

  spawn(opts) {
    const i = this._alloc();
    const i3 = i * 3, i4 = i * 4;
    const p = opts.position, v = opts.velocity;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v ? v.x : 0; this.vel[i3 + 1] = v ? v.y : 0; this.vel[i3 + 2] = v ? v.z : 0;
    const size = opts.size ?? 0.2;
    this.params[i4] = size;
    this.params[i4 + 1] = opts.rotation ?? Math.random() * Math.PI * 2;
    this.params[i4 + 2] = opts.stretch ?? 0;
    this.params[i4 + 3] = opts.kind ?? PKIND.DUST;
    const c = opts.color ?? WHITE;
    this.color[i4] = c[0]; this.color[i4 + 1] = c[1]; this.color[i4 + 2] = c[2];
    this.color[i4 + 3] = opts.alpha ?? 1;
    this.age[i] = 0;
    this.life[i] = opts.life ?? 1;
    this.drag[i] = opts.drag ?? 1.4;
    this.gravity[i] = opts.gravity ?? 0;
    this.growth[i] = opts.growth ?? 0;
    this.spin[i] = opts.spin ?? 0;
    this.baseAlpha[i] = opts.alpha ?? 1;
    this.baseSize[i] = size;
    this.fade[i] = opts.fade ?? 0;
    return i;
  }

  update(dt, time) {
    const n = this.count;
    const pos = this.pos, vel = this.vel, params = this.params, color = this.color;
    let write = 0;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) continue;

      const i3 = i * 3, i4 = i * 4;
      const kind = params[i4 + 3];
      const drag = Math.exp(-this.drag[i] * dt);
      vel[i3] *= drag;
      vel[i3 + 1] *= drag;
      vel[i3 + 2] *= drag;
      vel[i3 + 1] -= this.gravity[i] * dt;
      if (kind === PKIND.SMOKE || kind === PKIND.DUST) {
        vel[i3] += this.wind.x * dt * 0.5;
        vel[i3 + 2] += this.wind.z * dt * 0.5;
      }
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      params[i4] = this.baseSize[i] * (1 + this.growth[i] * t);
      params[i4 + 1] += this.spin[i] * dt;

      let a;
      if (this.fade[i] === 1) a = (1 - t) * (1 - t);
      else if (this.fade[i] === 2) a = Math.pow(1 - t, 4);
      else a = 1 - t;
      // ease in over the first 8% so nothing pops into existence
      a *= Math.min(1, t / 0.08);
      color[i4 + 3] = this.baseAlpha[i] * a;

      if (write !== i) this._move(i, write);
      write++;
    }
    this.count = write;
    this.geometry.instanceCount = write;
    if (write > 0) {
      this.aPos.needsUpdate = true;
      this.aVel.needsUpdate = true;
      this.aParams.needsUpdate = true;
      this.aColor.needsUpdate = true;
    }
    this.material.uniforms.uTime.value = time;
  }

  _move(from, to) {
    const f3 = from * 3, t3 = to * 3, f4 = from * 4, t4 = to * 4;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
    }
    for (let k = 0; k < 4; k++) {
      this.params[t4 + k] = this.params[f4 + k];
      this.color[t4 + k] = this.color[f4 + k];
    }
    this.age[to] = this.age[from];
    this.life[to] = this.life[from];
    this.drag[to] = this.drag[from];
    this.gravity[to] = this.gravity[from];
    this.growth[to] = this.growth[from];
    this.spin[to] = this.spin[from];
    this.baseAlpha[to] = this.baseAlpha[from];
    this.baseSize[to] = this.baseSize[from];
    this.fade[to] = this.fade[from];
  }

  setLighting(sunColor, sunDir, ambient) {
    this.material.uniforms.uSunColor.value.copy(sunColor);
    this.material.uniforms.uSunDirection.value.copy(sunDir);
    this.material.uniforms.uAmbient.value.copy(ambient);
  }

  clear() { this.count = 0; this.geometry.instanceCount = 0; }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

const WHITE = [1, 1, 1];
