import * as THREE from 'three';
import { Agent, AI_STATE } from './Agent.js';
import { Character } from '../game/Character.js';

/**
 * Runs every AI combatant: staggered thinking, squad separation, respawns and
 * the small amount of coordination that makes a team read as a team.
 *
 * Expensive senses are budgeted across frames — with a dozen agents, running
 * full visibility checks for everyone every frame is most of a millisecond for
 * no perceptible gain.
 */

const SENSE_HZ = 12;

export class Director {
  constructor({ scene, nav, bvh, factory, rng, shadowSystem, prevViewProjection, combat, audio }) {
    this.scene = scene;
    this.nav = nav;
    this.bvh = bvh;
    this.factory = factory;
    this.rng = rng;
    this.shadowSystem = shadowSystem;
    this.prevViewProjection = prevViewProjection;
    this.combat = combat;
    this.audio = audio;

    this.agents = [];
    this.characters = [];
    this.teams = { A: [], B: [] };
    this.player = null;
    this._senseCursor = 0;
    this._respawnQueue = [];
    this.respawnDelay = 5.5;
    this.spawnPoints = { A: [], B: [] };

    this.onAgentKilled = null;
  }

  setSpawnPoints(teamA, teamB) {
    this.spawnPoints.A = teamA;
    this.spawnPoints.B = teamB;
  }

  /** Player is registered as a target so agents can see and shoot at them. */
  setPlayer(playerCharacter) {
    this.player = playerCharacter;
  }

  createAgent(team, skill, squad) {
    const id = this.agents.length + 1;
    const rng = this.rng.fork(id * 977);
    const character = new Character({
      id, team, variant: id % 3,
      factory: this.factory,
      bvh: this.bvh,
      rng,
      prevViewProjection: this.prevViewProjection,
      shadowSystem: this.shadowSystem
    });
    this.scene.add(character.mesh);
    this.combat?.registerCharacter(character);

    const agent = new Agent({ character, nav: this.nav, bvh: this.bvh, rng, skill, squad });
    character.onDamaged = (amount, info) => {
      agent.onDamaged(info);
      // Squadmates within earshot orient on the shooter too.
      this._alertNearby(agent, info?.point, 26);
      void amount;
    };
    character.onKilled = (info) => {
      agent._setState(AI_STATE.DEAD);
      this._respawnQueue.push({ agent, time: this.respawnDelay });
      this.onAgentKilled?.(agent, info);
    };

    agent.onFire = (origin, dir, self) => {
      this.combat?.fireBullet({
        origin, direction: dir, owner: self.character, damage: AI_ROUND.damage,
        muzzle: origin, firstPerson: false, spec: AI_ROUND
      });
      this.combat?.spawnMuzzleFlash(origin, dir, false);
      this.combat?.ejectCasing(origin, dir, self.controller.velocity);
      this.audio?.playGunshot(origin, { firstPerson: false });
      this._propagateSound(origin, 1.0, self);
    };
    agent.onReload = (self) => {
      this.audio?.playReload(self.character.position, 0.55);
    };

    this.agents.push(agent);
    this.characters.push(character);
    this.teams[team].push(agent);
    return agent;
  }

  spawnTeam(team, count, skillRange = [0.4, 0.8]) {
    for (let i = 0; i < count; i++) {
      const skill = skillRange[0] + this.rng.next() * (skillRange[1] - skillRange[0]);
      const agent = this.createAgent(team, skill, i % 2);
      this.respawn(agent, true);
    }
  }

  /** Place an agent at the spawn furthest from the nearest living enemy. */
  respawn(agent, initial = false) {
    const points = this.spawnPoints[agent.character.team];
    if (!points || !points.length) return;
    const enemies = this._enemiesOf(agent.character.team);

    let best = points[0], bestScore = -Infinity;
    for (const p of points) {
      let nearest = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        nearest = Math.min(nearest, p.distanceToSquared(e.position));
      }
      const score = (nearest === Infinity ? 400 : Math.min(nearest, 3600)) + this.rng.next() * 60;
      if (score > bestScore) { bestScore = score; best = p; }
    }

    _spawn.copy(best);
    _spawn.x += (this.rng.next() - 0.5) * 2.6;
    _spawn.z += (this.rng.next() - 0.5) * 2.6;
    _spawn.y = this.nav.heightAt(_spawn.x, _spawn.z) + 0.05;
    agent.spawn(_spawn, this.rng.next() * Math.PI * 2);
    if (initial) agent.state = AI_STATE.PATROL;
  }

  _enemiesOf(team) {
    const list = [];
    for (const c of this.characters) if (c.team !== team) list.push(c);
    if (this.player && this.player.team !== team) list.push(this.player);
    return list;
  }

  _alliesOf(team) {
    const list = [];
    for (const a of this.agents) if (a.character.team === team) list.push(a);
    return list;
  }

  /** Gunfire is heard by everyone in range, friend or foe. */
  _propagateSound(position, loudness, source) {
    for (const a of this.agents) {
      if (a === source || !a.alive) continue;
      a.hearSound(position, loudness);
    }
  }

  playerFired(position) {
    this._propagateSound(position, 1.15, null);
  }

  _alertNearby(agent, point, radius) {
    if (!point) return;
    for (const a of this._alliesOf(agent.character.team)) {
      if (a === agent || !a.alive) continue;
      if (a.position.distanceTo(agent.position) > radius) continue;
      a.awareness = Math.max(a.awareness, 0.75);
      a.suspicionPoint.copy(point);
      a.hasSuspicion = true;
    }
  }

  update(dt) {
    // ---------------------------------------------------------- respawns
    for (let i = this._respawnQueue.length - 1; i >= 0; i--) {
      const entry = this._respawnQueue[i];
      entry.time -= dt;
      if (entry.time <= 0) {
        this.respawn(entry.agent);
        this._respawnQueue.splice(i, 1);
      }
    }

    // ------------------------------------------------------- separation
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.agents.length; j++) {
        const b = this.agents[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 2.56 || d2 < 1e-5) continue;
        const d = Math.sqrt(d2);
        const push = (1.6 - d) / 1.6;
        const nx = dx / d, nz = dz / d;
        a.addSeparation(-nx * push, -nz * push);
        b.addSeparation(nx * push, nz * push);
      }
    }

    // ------------------------------------------------------------ think
    const teamACache = this._enemiesOf('A');
    const teamBCache = this._enemiesOf('B');
    const alliesA = this._alliesOf('A');
    const alliesB = this._alliesOf('B');

    for (const agent of this.agents) {
      const team = agent.character.team;
      agent.update(dt, {
        enemies: team === 'A' ? teamACache : teamBCache,
        allies: team === 'A' ? alliesA : alliesB
      });
    }
  }

  aliveCount(team) {
    let n = 0;
    for (const a of this.agents) if (a.character.team === team && a.alive) n++;
    return n;
  }

  dispose() {
    for (const c of this.characters) {
      this.scene.remove(c.mesh);
      this.combat?.unregisterCharacter(c);
      c.dispose();
    }
    this.agents.length = 0;
    this.characters.length = 0;
    this.teams.A.length = 0;
    this.teams.B.length = 0;
  }
}

// AI rounds hit slightly softer than the player's so a firefight is survivable.
const AI_ROUND = {
  damage: 22,
  headMultiplier: 2.6,
  limbMultiplier: 0.72,
  falloffStart: 30,
  falloffEnd: 95,
  falloffMin: 0.55,
  penetration: 0.55,
  muzzleVelocity: 780,
  maxRange: 220
};

export { AI_ROUND };
const _spawn = new THREE.Vector3();
