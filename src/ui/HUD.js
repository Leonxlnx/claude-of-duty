import * as THREE from 'three';

/**
 * The in-match interface.
 *
 * Everything here is DOM, and everything is written to only when the value it
 * shows actually changed. A HUD that touches layout every frame will happily
 * eat two milliseconds; this one costs nothing on a quiet frame.
 */

const KILL_FEED_LIFE = 5.2;

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.className = 'passthrough';
    this.el.innerHTML = TEMPLATE;
    root.appendChild(this.el);

    const q = (sel) => this.el.querySelector(sel);
    this.dom = {
      crosshair: q('#crosshair'),
      ticks: Array.from(this.el.querySelectorAll('#crosshair .tick')),
      hitmarker: q('#hitmarker'),
      rounds: q('#ammo .rounds'),
      reserve: q('#ammo .reserve'),
      mode: q('#ammo .mode'),
      reloadHint: q('#reload-hint'),
      health: q('#vitals .value'),
      healthFill: q('#health-bar .fill'),
      chipCrouch: q('#chip-crouch'),
      chipSprint: q('#chip-sprint'),
      chipAds: q('#chip-ads'),
      chipPeek: q('#chip-peek'),
      grenades: q('#grenades'),
      grenadePips: q('#grenades .pips'),
      throwPower: q('#throw-power'),
      throwFill: q('#throw-power .fill'),
      scoreA: q('#score-a'),
      scoreB: q('#score-b'),
      clock: q('#clock'),
      killfeed: q('#killfeed'),
      announce: q('#announce'),
      announceBig: q('#announce .big'),
      announceSmall: q('#announce .small'),
      damageVignette: q('#damage-vignette'),
      criticalPulse: q('#critical-pulse'),
      flash: q('#flash'),
      deathFade: q('#death-fade'),
      respawn: q('#respawn'),
      respawnName: q('#respawn .name'),
      respawnTimer: q('#respawn .timer'),
      damageDirs: q('#damage-dirs'),
      compassStrip: q('#compass .strip'),
      perf: q('#perf')
    };

    this._buildCompass();

    this._cache = {
      rounds: -1, reserve: -1, mode: '', health: -1,
      scoreA: -1, scoreB: -1, clock: '', spread: -1,
      crouch: null, sprint: null, ads: null, reload: null, peek: null,
      grenadeCount: -1, grenadeReady: null, grenadeCharging: null
    };
    this.killEntries = [];
    this.damageArrows = [];
    this.damageNumbers = [];
    this.damageFlash = 0;
    this.visible = false;
    this._compassYaw = 999;
  }

  setVisible(v) {
    this.visible = v;
    this.el.classList.toggle('visible', v);
  }

  setPerfVisible(v) { this.dom.perf.classList.toggle('show', v); }
  setPerfText(text) { if (this.dom.perf.textContent !== text) this.dom.perf.textContent = text; }

  // ------------------------------------------------------------- crosshair

  /**
   * @param spread  angular cone half-width in radians
   * @param fov     vertical FOV in radians, to convert to pixels
   * @param hidden  true while aiming down the optic
   */
  updateCrosshair(spread, fov, viewportHeight, hidden) {
    this.dom.crosshair.classList.toggle('hidden', hidden);
    if (hidden) return;
    // Convert the cone to the on-screen radius it actually covers.
    const px = Math.tan(spread) / Math.tan(fov * 0.5) * viewportHeight * 0.5;
    const gap = Math.max(3, Math.min(70, px));
    if (Math.abs(gap - this._cache.spread) < 0.35) return;
    this._cache.spread = gap;
    const t = this.dom.ticks;
    t[0].style.transform = `translateY(${-gap - 7}px)`;
    t[1].style.transform = `translateY(${gap}px)`;
    t[2].style.transform = `translateX(${-gap - 7}px)`;
    t[3].style.transform = `translateX(${gap}px)`;
  }

  showHitmarker(kill) {
    const el = this.dom.hitmarker;
    el.classList.remove('show');
    el.classList.toggle('kill', !!kill);
    void el.offsetWidth;           // restart the animation
    el.classList.add('show');
  }

  /** Floating damage number at a projected screen position. */
  showDamageNumber(amount, screenX, screenY, headshot) {
    if (this.damageNumbers.length > 14) return;
    const el = document.createElement('div');
    el.className = `dmg-num${headshot ? ' head' : ''}`;
    el.textContent = Math.round(amount);
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    this.el.appendChild(el);
    const entry = { el, life: 0.9 };
    this.damageNumbers.push(entry);
  }

  // ------------------------------------------------------------- vitals

  updateAmmo(rounds, reserve, mode, reloading) {
    if (rounds !== this._cache.rounds) {
      this._cache.rounds = rounds;
      this.dom.rounds.textContent = String(rounds).padStart(2, '0');
      this.dom.rounds.classList.toggle('low', rounds <= 7);
    }
    if (reserve !== this._cache.reserve) {
      this._cache.reserve = reserve;
      this.dom.reserve.textContent = `/ ${reserve}`;
    }
    if (mode !== this._cache.mode) {
      this._cache.mode = mode;
      this.dom.mode.textContent = mode;
    }
    const hint = rounds === 0 && !reloading;
    if (hint !== this._cache.reload) {
      this._cache.reload = hint;
      this.dom.reloadHint.classList.toggle('show', hint);
      this.dom.reloadHint.textContent = 'RELOAD  [R]';
    }
  }

  updateHealth(health, max) {
    const rounded = Math.max(0, Math.round(health));
    if (rounded === this._cache.health) return;
    this._cache.health = rounded;
    const frac = rounded / max;
    this.dom.health.textContent = String(rounded);
    this.dom.healthFill.style.width = `${frac * 100}%`;
    const cls = frac < 0.28 ? 'critical' : frac < 0.6 ? 'hurt' : '';
    this.dom.health.className = `value ${cls}`;
    this.dom.healthFill.className = `fill ${cls}`;
    this.dom.criticalPulse.classList.toggle('active', frac < 0.28 && rounded > 0);
  }

  /**
   * Grenade count, and the throw power meter while one is being cooked. The
   * meter only exists during a charge — a permanent empty bar is one more thing
   * to read past when nothing is happening.
   */
  updateGrenades({ count, equipped, charging, charge }) {
    if (count !== this._cache.grenadeCount) {
      this._cache.grenadeCount = count;
      this.dom.grenadePips.textContent = count > 0 ? '\u25CF '.repeat(count).trim() : '\u25CB';
    }
    if (equipped !== this._cache.grenadeReady) {
      this._cache.grenadeReady = equipped;
      this.dom.grenades.classList.toggle('ready', equipped);
    }
    if (charging !== this._cache.grenadeCharging) {
      this._cache.grenadeCharging = charging;
      this.dom.throwPower.classList.toggle('active', charging);
    }
    if (charging) this.dom.throwFill.style.width = `${charge * 100}%`;
  }

  updateStance(crouch, sprint, ads, peek = false) {
    if (peek !== this._cache.peek) {
      this._cache.peek = peek;
      this.dom.chipPeek.classList.toggle('on', peek);
    }
    if (crouch !== this._cache.crouch) {
      this._cache.crouch = crouch;
      this.dom.chipCrouch.classList.toggle('on', crouch);
    }
    if (sprint !== this._cache.sprint) {
      this._cache.sprint = sprint;
      this.dom.chipSprint.classList.toggle('on', sprint);
    }
    if (ads !== this._cache.ads) {
      this._cache.ads = ads;
      this.dom.chipAds.classList.toggle('on', ads);
    }
  }

  updateScore(a, b, secondsLeft, target) {
    if (a !== this._cache.scoreA) { this._cache.scoreA = a; this.dom.scoreA.textContent = a; }
    if (b !== this._cache.scoreB) { this._cache.scoreB = b; this.dom.scoreB.textContent = b; }
    const m = Math.max(0, Math.floor(secondsLeft / 60));
    const s = Math.max(0, Math.floor(secondsLeft % 60));
    const clock = `${m}:${String(s).padStart(2, '0')}`;
    if (clock !== this._cache.clock) { this._cache.clock = clock; this.dom.clock.textContent = clock; }
    if (target !== undefined && this._cache.target !== target) {
      this._cache.target = target;
      this.el.querySelector('#score-target').textContent = `TARGET ${target}`;
    }
  }

  // ------------------------------------------------------------- feedback

  addKill({ killer, victim, killerTeam, victimTeam, headshot, involvesPlayer }) {
    const el = document.createElement('div');
    el.className = `kill-entry${headshot ? ' headshot' : ''}`;
    el.innerHTML = `
      <span class="name ${killerTeam}${involvesPlayer === 'killer' ? ' self' : ''}">${killer}</span>
      <span class="glyph">${headshot ? '&#9678;' : '&#9656;'}</span>
      <span class="name ${victimTeam}${involvesPlayer === 'victim' ? ' self' : ''}">${victim}</span>`;
    this.dom.killfeed.appendChild(el);
    this.killEntries.push({ el, life: KILL_FEED_LIFE });
    while (this.killEntries.length > 6) {
      const old = this.killEntries.shift();
      old.el.remove();
    }
  }

  announce(big, small = '') {
    this.dom.announceBig.textContent = big;
    this.dom.announceSmall.textContent = small;
    this.dom.announce.classList.remove('show');
    void this.dom.announce.offsetWidth;
    this.dom.announce.classList.add('show');
  }

  /** Directional damage arrow, angle relative to the player's facing. */
  showDamageDirection(relativeAngle) {
    const el = document.createElement('div');
    el.className = 'dmg-arrow';
    el.style.transform = `rotate(${relativeAngle}rad)`;
    this.dom.damageDirs.appendChild(el);
    this.damageArrows.push({ el, life: 1.5 });
  }

  flashDamage(intensity) {
    this.damageFlash = Math.min(1, this.damageFlash + intensity);
  }

  screenFlash(amount) {
    this.dom.flash.style.opacity = String(Math.min(1, amount));
  }

  setDeathFade(amount) {
    this.dom.deathFade.style.opacity = String(amount);
    this.el.classList.toggle('dead', amount > 0.01);
  }

  showRespawn(killerName, seconds) {
    this.dom.respawn.classList.add('show');
    this.dom.respawnName.textContent = killerName;
    this._cache.respawn = null;
    this.updateRespawn(seconds, false);
  }

  updateRespawn(seconds, canSkip = false) {
    const text = canSkip
      ? 'REDEPLOY  [SPACE]'
      : `RESPAWN IN ${Math.max(0, seconds).toFixed(1)}`;
    if (text === this._cache.respawn) return;
    this._cache.respawn = text;
    this.dom.respawnTimer.textContent = text;
    this.dom.respawnTimer.classList.toggle('ready', canSkip);
  }

  hideRespawn() { this.dom.respawn.classList.remove('show'); }

  // ------------------------------------------------------------- compass

  _buildCompass() {
    const strip = this.dom.compassStrip;
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    // Three copies so the strip can scroll seamlessly through 360°.
    for (let rep = -1; rep <= 1; rep++) {
      for (let deg = 0; deg < 360; deg += 15) {
        const el = document.createElement('div');
        const label = labels[deg];
        el.className = label ? `mark${deg % 90 === 0 ? ' card' : ''}` : 'mark tick';
        if (label) el.textContent = label;
        el.style.left = `${(rep * 360 + deg) * COMPASS_PX_PER_DEG}px`;
        strip.appendChild(el);
      }
    }
  }

  updateCompass(yaw) {
    // Player yaw 0 faces -Z, which is map north.
    let deg = (-yaw * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;
    if (Math.abs(deg - this._compassYaw) < 0.15) return;
    this._compassYaw = deg;
    this.dom.compassStrip.style.transform = `translateX(${160 - deg * COMPASS_PX_PER_DEG}px)`;
  }

  // ------------------------------------------------------------- per frame

  update(dt) {
    // damage vignette decays on its own so a burst of hits stacks smoothly
    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
      this.dom.damageVignette.style.opacity = String(this.damageFlash * 0.9);
    }

    for (let i = this.killEntries.length - 1; i >= 0; i--) {
      const e = this.killEntries[i];
      e.life -= dt;
      if (e.life < 0.5 && !e.fading) { e.fading = true; e.el.classList.add('fading'); }
      if (e.life <= 0) { e.el.remove(); this.killEntries.splice(i, 1); }
    }

    for (let i = this.damageArrows.length - 1; i >= 0; i--) {
      const a = this.damageArrows[i];
      a.life -= dt;
      a.el.style.opacity = String(Math.max(0, Math.min(1, a.life * 1.4)));
      if (a.life <= 0) { a.el.remove(); this.damageArrows.splice(i, 1); }
    }

    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const n = this.damageNumbers[i];
      n.life -= dt;
      if (n.life <= 0) { n.el.remove(); this.damageNumbers.splice(i, 1); }
    }
  }

  clear() {
    for (const e of this.killEntries) e.el.remove();
    this.killEntries.length = 0;
    for (const a of this.damageArrows) a.el.remove();
    this.damageArrows.length = 0;
    for (const n of this.damageNumbers) n.el.remove();
    this.damageNumbers.length = 0;
    this.damageFlash = 0;
    this.dom.damageVignette.style.opacity = '0';
    this.hideRespawn();
    this.setDeathFade(0);
  }
}

const COMPASS_PX_PER_DEG = 320 / 90;   // 90° of arc across the strip width

const TEMPLATE = /* html */`
<div id="screen-fx">
  <div id="damage-vignette"></div>
  <div id="critical-pulse"></div>
  <div id="flash"></div>
  <div id="death-fade"></div>
</div>

<div id="damage-dirs"></div>

<div id="crosshair">
  <div class="tick v"></div>
  <div class="tick v"></div>
  <div class="tick h"></div>
  <div class="tick h"></div>
  <div class="dot"></div>
</div>

<div id="hitmarker"><span></span><span></span><span></span><span></span></div>

<div id="compass"><div class="strip"></div></div>

<div id="score-strip">
  <div>
    <div class="tally" id="score-a">0</div>
    <div class="tally-label">Eliminated</div>
  </div>
  <div class="divider"></div>
  <div>
    <div class="clock" id="clock">10:00</div>
    <div class="target" id="score-target">TARGET 30</div>
  </div>
  <div class="divider"></div>
  <div>
    <div class="tally down" id="score-b">0</div>
    <div class="tally-label">Losses</div>
  </div>
</div>

<div id="killfeed"></div>

<div id="announce"><div class="big"></div><div class="small"></div></div>

<div id="vitals">
  <div class="value">100</div>
  <div class="label">Vitals</div>
  <div id="health-bar"><div class="fill"></div></div>
</div>

<div id="state-chips">
  <div class="chip" id="chip-crouch">CROUCH</div>
  <div class="chip" id="chip-sprint">SPRINT</div>
  <div class="chip" id="chip-ads">ADS</div>
  <div class="chip" id="chip-peek">PEEK</div>
</div>

<div id="ammo">
  <div class="rounds">30</div>
  <div class="reserve">/ 210</div>
  <div class="weapon">MK18 CARBINE <span class="mode">AUTO</span></div>
  <div id="grenades"><span class="pips"></span><span class="key">[B]</span></div>
</div>

<div id="throw-power"><div class="fill"></div></div>
<div id="reload-hint">RELOAD [R]</div>

<div id="respawn">
  <div class="killed-by">Killed by</div>
  <div class="name">—</div>
  <div class="timer">RESPAWN IN 3.0</div>
</div>

<div id="perf"></div>
`;
