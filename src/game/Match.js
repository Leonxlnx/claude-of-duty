/**
 * Team-deathmatch rules: score, clock, respawns, kill feed events and the
 * end-of-match summary. Kept free of rendering and input so the whole match can
 * be simulated headlessly in a test.
 */

const CALLSIGNS_A = ['HAWK', 'VIPER', 'ATLAS', 'RONIN', 'CIPHER', 'ORACLE', 'BISHOP', 'NOMAD'];
const CALLSIGNS_B = ['JACKAL', 'SPECTRE', 'KILO', 'ONYX', 'HAVOC', 'WRAITH', 'TALON', 'ZEALOT'];

export class Match {
  constructor({ scoreLimit = 40, timeLimit = 600, respawnDelay = 4.5 } = {}) {
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.respawnDelay = respawnDelay;
    this.reset();
    this.onEnd = null;
    this.onKill = null;
  }

  reset() {
    this.scores = { A: 0, B: 0 };
    this.timeLeft = this.timeLimit;
    this.running = false;
    this.ended = false;
    this.winner = null;
    this.endReason = '';
    this.players = new Map();
    this.events = [];
    this.elapsed = 0;
  }

  registerPlayer(id, { name, team, isLocal = false }) {
    this.players.set(id, {
      id, name, team, isLocal,
      kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0, streak: 0, bestStreak: 0
    });
    return this.players.get(id);
  }

  static callsign(team, index) {
    const list = team === 'A' ? CALLSIGNS_A : CALLSIGNS_B;
    return `${list[index % list.length]}-${1 + Math.floor(index / list.length)}`;
  }

  start() {
    this.running = true;
    this.ended = false;
    this.timeLeft = this.timeLimit;
    this.elapsed = 0;
  }

  update(dt) {
    if (!this.running || this.ended) return;
    this.timeLeft -= dt;
    this.elapsed += dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._end(this.scores.A === this.scores.B ? null
        : this.scores.A > this.scores.B ? 'A' : 'B', 'Time expired');
    }
  }

  /**
   * Record a kill. `killerId` may be null for a suicide or environmental death,
   * which costs the victim's team a point instead of awarding one.
   */
  registerKill(killerId, victimId, { headshot = false } = {}) {
    if (this.ended) return null;
    const victim = this.players.get(victimId);
    const killer = killerId !== null ? this.players.get(killerId) : null;
    if (!victim) return null;

    victim.deaths++;
    victim.streak = 0;

    let scoringTeam = null;
    if (killer && killer.team !== victim.team) {
      killer.kills++;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      if (headshot) killer.headshots++;
      scoringTeam = killer.team;
    } else if (killer && killer.team === victim.team) {
      killer.kills--;              // team kill costs the shooter
      scoringTeam = victim.team === 'A' ? 'B' : 'A';
    } else {
      scoringTeam = victim.team === 'A' ? 'B' : 'A';
    }

    if (scoringTeam) this.scores[scoringTeam]++;

    const event = {
      killer: killer ? killer.name : 'THE WORLD',
      killerTeam: killer ? killer.team : (victim.team === 'A' ? 'b' : 'a'),
      victim: victim.name,
      victimTeam: victim.team,
      headshot,
      streak: killer ? killer.streak : 0,
      involvesPlayer: killer?.isLocal ? 'killer' : victim.isLocal ? 'victim' : null
    };
    this.events.push(event);
    this.onKill?.(event);

    if (this.scores[scoringTeam] >= this.scoreLimit) {
      this._end(scoringTeam, 'Score limit reached');
    }
    return event;
  }

  registerShot(id, hit = false) {
    const p = this.players.get(id);
    if (!p) return;
    p.shots++;
    if (hit) p.hits++;
  }

  _end(winner, reason) {
    this.ended = true;
    this.running = false;
    this.winner = winner;
    this.endReason = reason;
    this.onEnd?.(winner, reason);
  }

  /** Rows sorted the way a scoreboard should sort: by team, then by kills. */
  scoreboard() {
    const rows = [...this.players.values()].map((p) => ({
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      headshots: p.headshots,
      accuracy: p.shots > 0 ? p.hits / p.shots : null,
      self: p.isLocal
    }));
    rows.sort((a, b) => (a.team === b.team ? b.kills - a.kills : a.team < b.team ? -1 : 1));
    return rows;
  }

  localPlayer() {
    for (const p of this.players.values()) if (p.isLocal) return p;
    return null;
  }
}
