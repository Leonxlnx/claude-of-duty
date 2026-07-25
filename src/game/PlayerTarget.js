import * as THREE from 'three';

/**
 * Makes the local player look like a Character to the combat and AI systems:
 * a capsule the AI can see and shoot, and a damage sink that forwards to the
 * player controller. The player has no visible body, so there is no mesh and
 * no rig — just the hitboxes.
 */
export class PlayerTarget {
  constructor(player) {
    this.player = player;
    this.team = player.team;
    this.name = 'YOU';
    this.isLocal = true;
    this.position = new THREE.Vector3();
    this.velocity = player.controller.velocity;
    this.boundsRadius = 1.1;
    this.hitboxes = [
      { name: 'head', zone: 'head', radius: 0.115, a: new THREE.Vector3(), b: new THREE.Vector3() },
      { name: 'torso', zone: 'body', radius: 0.21, a: new THREE.Vector3(), b: new THREE.Vector3() },
      { name: 'legs', zone: 'limb', radius: 0.19, a: new THREE.Vector3(), b: new THREE.Vector3() }
    ];
    this.onDamaged = null;
  }

  get alive() { return this.player.alive; }
  get health() { return this.player.health; }

  /** Rebuild the capsules from the controller each fixed step. */
  sync() {
    const p = this.player.controller.position;
    const h = this.player.controller.height;
    this.position.copy(p);
    this.position.y += h * 0.5;

    const head = this.hitboxes[0];
    head.a.set(p.x, p.y + h - 0.16, p.z);
    head.b.set(p.x, p.y + h - 0.02, p.z);

    const torso = this.hitboxes[1];
    torso.a.set(p.x, p.y + h * 0.46, p.z);
    torso.b.set(p.x, p.y + h - 0.24, p.z);

    const legs = this.hitboxes[2];
    legs.a.set(p.x, p.y + 0.22, p.z);
    legs.b.set(p.x, p.y + h * 0.46, p.z);
  }

  getEyePosition(out) {
    return out.copy(this.player.eye);
  }

  applyDamage(amount, info) {
    const killed = this.player.applyDamage(amount, info.source, 'bullet');
    this.onDamaged?.(amount, info);
    return killed;
  }
}
