import * as THREE from 'three';

/**
 * Critically-parametrised spring integrators used everywhere motion needs to
 * feel physical rather than keyframed: viewmodel sway, recoil recovery, camera
 * lean, HUD element settle.
 *
 * Integration is semi-implicit and stable for any timestep because the
 * coefficients are recomputed from the exact analytic solution each step.
 */

export class Spring {
  constructor(value = 0, frequency = 12, damping = 1.0) {
    this.value = value;
    this.velocity = 0;
    this.target = value;
    this.frequency = frequency;
    this.damping = damping;
  }

  set(v) { this.value = v; this.target = v; this.velocity = 0; return this; }

  nudge(v) { this.velocity += v; return this; }

  update(dt) {
    const omega = this.frequency;
    const zeta = this.damping;
    // exact solution for a damped harmonic oscillator, clamped for big steps
    const f = 1 + 2 * dt * zeta * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const invDet = 1 / (f + hhoo);
    const detX = f * this.value + dt * this.velocity + hhoo * this.target;
    const detV = this.velocity + hoo * (this.target - this.value);
    this.value = detX * invDet;
    this.velocity = detV * invDet;
    return this.value;
  }
}

export class Spring3 {
  constructor(frequency = 12, damping = 1.0) {
    this.value = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.frequency = frequency;
    this.damping = damping;
  }

  set(x, y, z) {
    this.value.set(x, y, z);
    this.target.set(x, y, z);
    this.velocity.set(0, 0, 0);
    return this;
  }

  nudge(x, y, z) { this.velocity.x += x; this.velocity.y += y; this.velocity.z += z; return this; }

  update(dt) {
    const omega = this.frequency;
    const zeta = this.damping;
    const f = 1 + 2 * dt * zeta * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const invDet = 1 / (f + hhoo);
    for (const axis of AXES) {
      const x = this.value[axis], v = this.velocity[axis], t = this.target[axis];
      this.value[axis] = (f * x + dt * v + hhoo * t) * invDet;
      this.velocity[axis] = (v + hoo * (t - x)) * invDet;
    }
    return this.value;
  }
}

const AXES = ['x', 'y', 'z'];

/** Frame-rate independent exponential approach. */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function dampVec(out, target, lambda, dt) {
  const k = Math.exp(-lambda * dt);
  out.x = target.x + (out.x - target.x) * k;
  out.y = target.y + (out.y - target.y) * k;
  out.z = target.z + (out.z - target.z) * k;
  return out;
}

export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
