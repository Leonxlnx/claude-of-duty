import * as THREE from 'three';
import { RayHit, SURFACE, SURFACE_INFO } from '../physics/BVH.js';
import { ParticleSystem, PKIND } from '../fx/Particles.js';
import { DecalSystem, DECAL } from '../fx/Decals.js';
import { InstancedBatch, casingGeometry, magazineGeometry } from '../fx/InstancedBatch.js';
import { SeededRandom } from '../core/SeededRandom.js';

/**
 * Ballistics and impact response.
 *
 * A shot is resolved instantly along its ray — the tracer that follows is a
 * visual that travels at the round's real muzzle velocity, so the feedback
 * looks like flight time without the hit ever lagging the trigger. Rounds
 * carry energy through soft materials and glance off hard ones at shallow
 * angles; each surface answers with its own dust, spall and sound.
 */

const MAX_BOUNCES = 3;
const MAX_DECALS = 384;
/** Fallback ballistics for a generic intermediate rifle round. */
const DEFAULT_ROUND = {
  headMultiplier: 2.0, limbMultiplier: 0.85, penetration: 0.6,
  falloffStart: 34, falloffEnd: 96, falloffFloor: 0.6
};
const DECAL_KIND_BY_SURFACE = [
  DECAL.HOLE_HARD,  // concrete
  DECAL.HOLE_HARD,  // plaster
  DECAL.HOLE_HARD,  // brick
  DECAL.HOLE_METAL, // metal
  DECAL.HOLE_SOFT,  // wood
  DECAL.HOLE_GLASS, // glass
  DECAL.HOLE_SOFT,  // fabric
  DECAL.HOLE_SOFT,  // sand
  DECAL.HOLE_SOFT,  // dirt
  DECAL.HOLE_HARD,  // tile
  DECAL.HOLE_SOFT,  // rubber
  DECAL.HOLE_SOFT   // sandbag
];

export class Combat {
  constructor({ world, rigidWorld, lightUniforms, quality, audio, seed = 0xb001 }) {
    this.world = world;
    this.bvh = world.bvh;
    this.rigid = rigidWorld;
    this.audio = audio;
    this.quality = quality;
    this.rng = new SeededRandom(seed);
    this.indoorFactor = 0;

    // Pools are sized for the heaviest preset so switching quality mid-match
    // only moves a budget, never reallocates a GPU buffer.
    this.particles = new ParticleSystem(2300, quality);
    this.decals = new DecalSystem(lightUniforms, MAX_DECALS);
    this.decals.budget = Math.min(MAX_DECALS, quality.decalBudget);
    this.casings = new InstancedBatch(casingGeometry(), lightUniforms, 96, { roughness: 0.28, metal: 0.95 });
    this.mags = new InstancedBatch(magazineGeometry(), lightUniforms, 8, { roughness: 0.62, metal: 0.0 });

    this.scene = new THREE.Scene();
    this.scene.add(this.casings.mesh, this.mags.mesh);
    this.transparentScene = new THREE.Scene();
    this.transparentScene.add(this.decals.mesh, this.particles.mesh);

    this.tracers = [];
    this.lights = [];
    this.characters = [];
    this.hit = new RayHit();
    this.onHitConfirm = null;
    this.onKill = null;
    this.onImpactSound = null;
    this.shotsFired = 0;

    this._casingBodies = [];
    this._magBodies = [];
  }

  /**
   * Adopt a new quality preset. Pool capacities stay put — reallocating
   * instanced buffers mid-match would stall the GPU — but every spawn rate and
   * budget derived from the preset picks up the new numbers immediately.
   */
  setQuality(quality) {
    this.quality = quality;
    this.decals.budget = Math.min(this.decals.capacity, quality.decalBudget);
    this.rigid.maxBodies = Math.min(this.rigid.pool.length, quality.maxRigidBodies);
  }

  registerCharacter(c) { this.characters.push(c); }
  unregisterCharacter(c) {
    const i = this.characters.indexOf(c);
    if (i >= 0) this.characters.splice(i, 1);
  }

  // ------------------------------------------------------------------ shots
  fireBullet(shot) {
    this.shotsFired++;
    const dir = _dir.copy(shot.direction).normalize();
    const origin = _origin.copy(shot.origin);
    // Callers outside the weapon code (the AI, the test harness) fire single
    // rounds without a full weapon profile behind them.
    const spec = shot.spec ? { ...DEFAULT_ROUND, ...shot.spec } : DEFAULT_ROUND;
    let energy = 1.0;
    let travelled = 0;
    let damage = shot.damage;
    const maxRange = 320;
    const segments = [];
    let hitSomething = false;

    for (let bounce = 0; bounce <= MAX_BOUNCES; bounce++) {
      const charHit = this._raycastCharacters(origin, dir, maxRange - travelled, shot.owner);
      const worldHit = this.bvh.raycast(origin, dir, maxRange - travelled, this.hit);

      const charT = charHit ? charHit.t : Infinity;
      const worldT = worldHit.hit ? worldHit.t : Infinity;

      if (charT === Infinity && worldT === Infinity) {
        _end.copy(origin).addScaledVector(dir, maxRange - travelled);
        segments.push([origin.clone(), _end.clone()]);
        break;
      }

      if (charT < worldT) {
        // ------- character hit
        _point.copy(origin).addScaledVector(dir, charT);
        segments.push([origin.clone(), _point.clone()]);
        travelled += charT;
        hitSomething = true;

        const falloff = this._falloff(travelled, spec);
        const zoneMul = charHit.zone === 'head' ? spec.headMultiplier
          : charHit.zone === 'limb' ? spec.limbMultiplier : 1.0;
        const applied = damage * falloff * zoneMul * energy;

        const killed = charHit.character.applyDamage(applied, {
          source: shot.owner, point: _point, direction: dir, zone: charHit.zone,
          impulse: 9.5 * energy, part: charHit.part
        });

        this._bloodImpact(_point, dir, charHit.zone);
        this.audio?.playFleshImpact(_point, charHit.zone);
        if (shot.firstPerson) {
          this.onHitConfirm?.({ zone: charHit.zone, damage: applied, killed, position: _point.clone() });
        }
        if (killed) this.onKill?.(shot.owner, charHit.character, charHit.zone);

        // rounds over-penetrate soft tissue but lose most of their energy
        energy *= charHit.zone === 'head' ? 0.25 : 0.42;
        damage *= 0.55;
        if (energy < 0.16) break;
        origin.copy(_point).addScaledVector(dir, 0.22);
        continue;
      }

      // ------- world hit
      const t = worldHit.t;
      _point.copy(origin).addScaledVector(dir, t);
      segments.push([origin.clone(), _point.clone()]);
      travelled += t;
      hitSomething = true;

      const surface = worldHit.surface;
      const info = SURFACE_INFO[surface] || SURFACE_INFO[0];
      _normal.copy(worldHit.normal);
      const incidence = Math.abs(dir.dot(_normal));

      this._surfaceImpact(_point, _normal, dir, surface, energy);
      this.audio?.playImpact(_point, info.name, energy);
      this.onImpactSound?.(_point, info.name, energy);

      // --- ricochet on hard materials at shallow angles
      const ricochetChance = info.ricochet * (1 - incidence) * (1 - incidence);
      if (bounce < MAX_BOUNCES && this.rng.next() < ricochetChance && energy > 0.3) {
        energy *= 0.45 + info.ricochet * 0.2;
        damage *= 0.5;
        dir.reflect(_normal);
        // scatter the deflection so ricochets are never mirror-perfect
        dir.x += (this.rng.next() - 0.5) * 0.22;
        dir.y += (this.rng.next() - 0.5) * 0.22;
        dir.z += (this.rng.next() - 0.5) * 0.22;
        dir.normalize();
        this._ricochetSparks(_point, dir);
        this.audio?.playRicochet(_point);
        origin.copy(_point).addScaledVector(dir, 0.02);
        continue;
      }

      // --- penetration through thin, soft material
      const canPenetrate = info.penetrable && energy > 0.30 && bounce < MAX_BOUNCES;
      if (canPenetrate) {
        const maxThickness = (spec.penetration / Math.max(info.hardness, 0.05)) * 0.16;
        const exit = this._findExit(_point, dir, maxThickness);
        if (exit) {
          const cost = (exit.thickness / maxThickness) * 0.75 + info.hardness * 0.22;
          energy *= Math.max(0, 1 - cost);
          damage *= Math.max(0, 1 - cost * 1.15);
          if (energy > 0.16) {
            this._surfaceImpact(exit.point, exit.normal, dir, surface, energy * 0.6);
            origin.copy(exit.point).addScaledVector(dir, 0.01);
            travelled += exit.thickness;
            // exit wounds spray forward
            continue;
          }
        }
      }
      break;
    }

    // one tracer per shot, flying the whole polyline at muzzle velocity
    if (segments.length) {
      this._spawnTracer(shot.muzzle || segments[0][0], segments, spec.muzzleVelocity, shot.firstPerson);
    }
    return hitSomething;
  }

  _falloff(distance, spec) {
    if (distance <= spec.falloffStart) return 1;
    const t = THREE.MathUtils.clamp(
      (distance - spec.falloffStart) / (spec.falloffEnd - spec.falloffStart), 0, 1
    );
    return THREE.MathUtils.lerp(1, spec.falloffFloor, t * t);
  }

  /** March forward looking for the backface that ends this material. */
  _findExit(entry, dir, maxThickness) {
    const step = Math.min(maxThickness, 0.5);
    _probe.copy(entry).addScaledVector(dir, step);
    _back.copy(dir).multiplyScalar(-1);
    const h = this.bvh.raycast(_probe, _back, step, _exitHit);
    if (!h.hit) return null;
    const thickness = step - h.t;
    if (thickness <= 0.001 || thickness > maxThickness) return null;
    return {
      point: h.point.clone(),
      normal: h.normal.clone().multiplyScalar(-1),
      thickness
    };
  }

  _raycastCharacters(origin, dir, maxDist, exclude) {
    let best = null;
    for (const c of this.characters) {
      if (!c.alive || c === exclude || c.hitboxes === undefined) continue;
      if (c.boundsRadius !== undefined) {
        // quick reject against the bounding sphere before touching the parts
        _to.subVectors(c.position, origin);
        const proj = _to.dot(dir);
        if (proj < -c.boundsRadius || proj > maxDist + c.boundsRadius) continue;
        const perp2 = _to.lengthSq() - proj * proj;
        if (perp2 > c.boundsRadius * c.boundsRadius) continue;
      }
      for (const hb of c.hitboxes) {
        const t = rayCapsule(origin, dir, hb.a, hb.b, hb.radius, maxDist);
        if (t !== null && (!best || t < best.t)) {
          best = { t, zone: hb.zone, character: c, part: hb.name };
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------- FX
  _surfaceImpact(point, normal, dir, surface, energy) {
    const info = SURFACE_INFO[surface] || SURFACE_INFO[0];
    const dust = _color.setHex(info.dust);
    const density = this.quality.particleDensity;

    this.decals.add(point, normal, DECAL_KIND_BY_SURFACE[surface] ?? DECAL.HOLE_HARD,
      0.085 + this.rng.next() * 0.055, { seed: this.rng.next(), tangentHint: dir });

    // cone of dust ejecta along the surface normal, biased back toward the shooter
    _refl.copy(dir).reflect(normal);
    const puffs = Math.max(2, Math.round(5 * density * energy));
    for (let i = 0; i < puffs; i++) {
      _v.copy(normal).multiplyScalar(1.4 + this.rng.next() * 1.6);
      _v.addScaledVector(_refl, 0.7);
      _v.x += (this.rng.next() - 0.5) * 1.7;
      _v.y += (this.rng.next() - 0.5) * 1.2;
      _v.z += (this.rng.next() - 0.5) * 1.7;
      this.particles.spawn({
        position: point, velocity: _v, kind: PKIND.DUST,
        size: 0.055 + this.rng.next() * 0.13,
        color: [dust.r * 1.05, dust.g * 1.02, dust.b],
        alpha: 0.55 + this.rng.next() * 0.3,
        life: 0.5 + this.rng.next() * 0.85,
        drag: 3.1, gravity: 1.6, growth: 3.4, spin: (this.rng.next() - 0.5) * 3,
        fade: 1
      });
    }
    // lingering hang of fine dust
    if (density > 0.5) {
      this.particles.spawn({
        position: point, velocity: _v.copy(normal).multiplyScalar(0.35),
        kind: PKIND.SMOKE, size: 0.16, color: [dust.r, dust.g, dust.b],
        alpha: 0.24, life: 1.5 + this.rng.next(), drag: 1.5, gravity: -0.25,
        growth: 4.5, spin: (this.rng.next() - 0.5) * 0.7, fade: 1
      });
    }
    // hard surfaces throw chips
    if (info.hardness > 0.6) {
      const chips = Math.max(1, Math.round(3 * density));
      for (let i = 0; i < chips; i++) {
        _v.copy(normal).multiplyScalar(2.5 + this.rng.next() * 3.5);
        _v.x += (this.rng.next() - 0.5) * 3;
        _v.y += (this.rng.next() - 0.5) * 2;
        _v.z += (this.rng.next() - 0.5) * 3;
        this.particles.spawn({
          position: point, velocity: _v, kind: PKIND.DEBRIS,
          size: 0.008 + this.rng.next() * 0.014,
          color: [dust.r * 0.8, dust.g * 0.78, dust.b * 0.75],
          alpha: 1, life: 0.7 + this.rng.next() * 0.6,
          drag: 0.4, gravity: 13, spin: (this.rng.next() - 0.5) * 20, fade: 0
        });
      }
    }
    if (surface === SURFACE.METAL) this._ricochetSparks(point, _refl);
    if (surface === SURFACE.GLASS) {
      for (let i = 0; i < Math.round(6 * density); i++) {
        _v.copy(normal).multiplyScalar(1.5 + this.rng.next() * 2);
        _v.x += (this.rng.next() - 0.5) * 2.6;
        _v.y += (this.rng.next() - 0.5) * 2.0;
        _v.z += (this.rng.next() - 0.5) * 2.6;
        this.particles.spawn({
          position: point, velocity: _v, kind: PKIND.DEBRIS, size: 0.006 + this.rng.next() * 0.01,
          color: [0.75, 0.86, 0.9], alpha: 0.9, life: 0.9, drag: 0.3, gravity: 14,
          spin: (this.rng.next() - 0.5) * 25, fade: 0
        });
      }
    }
  }

  _ricochetSparks(point, dir) {
    const n = Math.max(3, Math.round(9 * this.quality.particleDensity));
    for (let i = 0; i < n; i++) {
      _v.copy(dir).multiplyScalar(5 + this.rng.next() * 11);
      _v.x += (this.rng.next() - 0.5) * 7;
      _v.y += (this.rng.next() - 0.5) * 5;
      _v.z += (this.rng.next() - 0.5) * 7;
      this.particles.spawn({
        position: point, velocity: _v, kind: PKIND.SPARK,
        size: 0.012 + this.rng.next() * 0.012, stretch: 2.2 + this.rng.next() * 3.5,
        color: [1.0, 0.7, 0.35], alpha: 1,
        life: 0.28 + this.rng.next() * 0.5, drag: 1.4, gravity: 11,
        fade: 2
      });
    }
  }

  _bloodImpact(point, dir, zone) {
    const density = this.quality.particleDensity;
    const n = Math.round((zone === 'head' ? 16 : 9) * density);
    for (let i = 0; i < n; i++) {
      _v.copy(dir).multiplyScalar(1.6 + this.rng.next() * 4.5);
      _v.x += (this.rng.next() - 0.5) * 2.6;
      _v.y += (this.rng.next() - 0.5) * 2.2 + 0.6;
      _v.z += (this.rng.next() - 0.5) * 2.6;
      this.particles.spawn({
        position: point, velocity: _v, kind: PKIND.BLOOD,
        size: 0.022 + this.rng.next() * 0.05,
        color: [0.36, 0.028, 0.022], alpha: 0.9,
        life: 0.4 + this.rng.next() * 0.5, drag: 2.2, gravity: 9,
        growth: 1.2, fade: 1
      });
    }
    // mist puff behind the hit
    this.particles.spawn({
      position: point, velocity: _v.copy(dir).multiplyScalar(1.2),
      kind: PKIND.BLOOD, size: 0.13, color: [0.30, 0.03, 0.025], alpha: 0.5,
      life: 0.34, drag: 3.5, gravity: 1.5, growth: 2.6, fade: 1
    });
    // splatter on whatever is behind them
    const h = this.bvh.raycast(point, dir, 3.2, _exitHit);
    if (h.hit) {
      this.decals.add(h.point, h.normal, DECAL.BLOOD, 0.32 + this.rng.next() * 0.4, {
        seed: this.rng.next(), life: 26
      });
    }
  }

  spawnMuzzleFlash(position, direction, firstPerson) {
    const scale = firstPerson ? 1 : 0.75;
    this.particles.spawn({
      position, velocity: _v.copy(direction).multiplyScalar(1.2),
      kind: PKIND.FLASH, size: (0.20 + this.rng.next() * 0.09) * scale,
      color: [1, 0.85, 0.6], alpha: 1, life: 0.045, drag: 8, fade: 2,
      rotation: this.rng.next() * Math.PI * 2
    });
    this.particles.spawn({
      position, velocity: _v.copy(direction).multiplyScalar(3.4),
      kind: PKIND.SMOKE, size: 0.085 * scale, color: [0.62, 0.60, 0.56], alpha: 0.30,
      life: 0.55, drag: 4.2, gravity: -0.6, growth: 5.5, fade: 1,
      spin: (this.rng.next() - 0.5) * 2
    });
    for (let i = 0; i < Math.round(4 * this.quality.particleDensity); i++) {
      _v.copy(direction).multiplyScalar(7 + this.rng.next() * 9);
      _v.x += (this.rng.next() - 0.5) * 3.2;
      _v.y += (this.rng.next() - 0.5) * 3.2;
      _v.z += (this.rng.next() - 0.5) * 3.2;
      this.particles.spawn({
        position, velocity: _v, kind: PKIND.SPARK, size: 0.009,
        stretch: 2.5, color: [1, 0.6, 0.25], alpha: 1, life: 0.14, drag: 3, gravity: 8, fade: 2
      });
    }
    this.lights.push({
      position: position.clone(),
      color: new THREE.Vector3(1.0, 0.78, 0.45),
      intensity: firstPerson ? 26 : 16,
      radius: 9,
      life: 0.055,
      age: 0
    });
  }

  _spawnTracer(muzzle, segments, speed, firstPerson) {
    // only every few rounds carries a visible trace, like real linked ammo
    if (!firstPerson && this.rng.next() > 0.34) return;
    if (firstPerson && this.rng.next() > 0.42) return;
    const path = [muzzle.clone()];
    for (const [, b] of segments) path.push(b.clone());
    this.tracers.push({
      path, speed, t: 0, index: 0,
      total: pathLength(path),
      travelled: 0,
      particle: -1
    });
  }

  ejectCasing(position, direction, carrierVelocity) {
    const body = this.rigid.spawnOrRecycle();
    if (!body) return;
    body.setBox(0.0055, 0.0055, 0.023, 0.012);
    body.position.copy(position);
    body.quaternion.setFromEuler(_euler.set(this.rng.next() * 6.28, this.rng.next() * 6.28, this.rng.next() * 6.28));
    body.velocity.copy(direction).multiplyScalar(2.9 + this.rng.next() * 1.5);
    if (carrierVelocity) body.velocity.add(carrierVelocity);
    body.velocity.y += 1.4;
    body.angular.set(
      (this.rng.next() - 0.5) * 40,
      (this.rng.next() - 0.5) * 40,
      (this.rng.next() - 0.5) * 40
    );
    body.restitution = 0.34;
    body.friction = 0.42;
    body.maxLifetime = 9;
    body.surface = SURFACE.METAL;
    const slot = this.casings.acquire([0.72, 0.55, 0.22]);
    if (slot < 0) { this.rigid.remove(body); return; }
    body.userData = { batch: this.casings, slot, kind: 'casing' };
    body.onContact = (impulse) => {
      if (impulse > 0.006) this.audio?.playCasingBounce(body.position, Math.min(1, impulse * 60));
    };
    this._casingBodies.push(body);
  }

  dropMagazine(vm) {
    const body = this.rigid.spawnOrRecycle();
    if (!body) return;
    body.setBox(0.014, 0.092, 0.021, 0.18);
    _p.set(0, -0.10, -0.02).applyMatrix4(vm.weapon.matrixWorld);
    body.position.copy(_p);
    body.quaternion.setFromRotationMatrix(vm.weapon.matrixWorld);
    body.velocity.set((this.rng.next() - 0.5) * 0.4, -1.2, (this.rng.next() - 0.5) * 0.4);
    body.angular.set((this.rng.next() - 0.5) * 6, (this.rng.next() - 0.5) * 6, (this.rng.next() - 0.5) * 6);
    body.restitution = 0.18;
    body.friction = 0.7;
    body.maxLifetime = 14;
    const slot = this.mags.acquire([0.20, 0.19, 0.17]);
    if (slot < 0) { this.rigid.remove(body); return; }
    body.userData = { batch: this.mags, slot, kind: 'mag' };
    body.onContact = (impulse) => {
      if (impulse > 0.05) this.audio?.playMagDrop(body.position);
    };
    this._magBodies.push(body);
  }

  // ---------------------------------------------------------------- update
  update(dt, time, camera) {
    this.particles.update(dt, time);
    this.decals.update(dt);

    // tracers advance along their polyline at the round's real speed
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.travelled += tr.speed * dt;
      if (tr.travelled >= tr.total) { this.tracers.splice(i, 1); continue; }
      pointAlong(tr.path, tr.travelled, _p, _v);
      this.particles.spawn({
        position: _p, velocity: _v, kind: PKIND.TRACER,
        size: 0.026, stretch: 8.5 + tr.speed * 0.008,
        color: [1.0, 0.55, 0.22], alpha: 0.9,
        life: 0.055, drag: 0, gravity: 0, fade: 0
      });
    }

    // dynamic lights decay fast; the shader only takes eight
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.age += dt;
      if (l.age >= l.life) this.lights.splice(i, 1);
      else l.currentIntensity = l.intensity * (1 - l.age / l.life);
    }

    this._syncBodies(this._casingBodies, this.casings);
    this._syncBodies(this._magBodies, this.mags);

    if (camera) this.particles.material.uniforms.uCameraPos.value.copy(camera.position);
  }

  _syncBodies(list, batch) {
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (!b.active) {
        batch.release(b.userData?.slot ?? -1);
        list.splice(i, 1);
        continue;
      }
      batch.setTransform(b.userData.slot, b.position, b.quaternion);
    }
    batch.flush();
  }

  activeLights() {
    const out = [];
    for (const l of this.lights) {
      out.push({ position: l.position, color: l.color, intensity: l.currentIntensity ?? l.intensity, radius: l.radius });
      if (out.length >= 8) break;
    }
    return out;
  }

  clear() {
    this.particles.clear();
    this.decals.clear();
    this.tracers.length = 0;
    this.lights.length = 0;
    for (const b of this._casingBodies) this.rigid.remove(b);
    for (const b of this._magBodies) this.rigid.remove(b);
    this._casingBodies.length = 0;
    this._magBodies.length = 0;
    this.casings.clear();
    this.mags.clear();
  }

  dispose() {
    this.particles.dispose();
    this.decals.dispose();
    this.casings.dispose();
    this.mags.dispose();
  }
}

// ------------------------------------------------------------------ helpers

/** Ray against a capsule; returns the entry distance or null. */
export function rayCapsule(ro, rd, a, b, radius, maxDist) {
  _ba.subVectors(b, a);
  _oa.subVectors(ro, a);
  const baba = _ba.dot(_ba);
  const bard = _ba.dot(rd);
  const baoa = _ba.dot(_oa);
  const rdoa = rd.dot(_oa);
  const oaoa = _oa.dot(_oa);
  let A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  let C = baba * oaoa - baoa * baoa - radius * radius * baba;
  let h = B * B - A * C;
  if (h >= 0) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 && t <= maxDist ? t : null;
    // caps
    _oc.copy(y <= 0 ? _oa : _oa.clone().sub(_ba));
    B = rd.dot(_oc);
    C = _oc.dot(_oc) - radius * radius;
    h = B * B - C;
    if (h > 0) {
      const t2 = -B - Math.sqrt(h);
      return t2 >= 0 && t2 <= maxDist ? t2 : null;
    }
  }
  return null;
}

function pathLength(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += path[i].distanceTo(path[i - 1]);
  return d;
}

function pointAlong(path, distance, outPoint, outDir) {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = path[i].distanceTo(path[i - 1]);
    if (acc + seg >= distance) {
      const t = (distance - acc) / Math.max(seg, 1e-5);
      outPoint.lerpVectors(path[i - 1], path[i], t);
      outDir.subVectors(path[i], path[i - 1]).normalize();
      return;
    }
    acc += seg;
  }
  outPoint.copy(path[path.length - 1]);
  outDir.subVectors(path[path.length - 1], path[Math.max(0, path.length - 2)]).normalize();
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _end = new THREE.Vector3();
const _refl = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _back = new THREE.Vector3();
const _to = new THREE.Vector3();
const _ba = new THREE.Vector3();
const _oa = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _color = new THREE.Color();
const _euler = new THREE.Euler();
const _exitHit = new RayHit();
