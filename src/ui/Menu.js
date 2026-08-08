import { Settings, QUALITY_PRESETS } from '../core/Settings.js';

/**
 * Start screen, pause menu, settings and the end-of-match board.
 *
 * One panel system serves all three states; which items are shown depends on
 * whether a match is running. Every control writes straight through to the
 * settings store, which persists and notifies the renderer.
 */

const KEY_LABELS = {
  ControlLeft: 'L CTRL', ControlRight: 'R CTRL',
  ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT',
  AltLeft: 'L ALT', AltRight: 'R ALT',
  Space: 'SPACE', Escape: 'ESC', Tab: 'TAB',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'M4', Mouse4: 'M5',
  WheelUp: 'WHEEL &uarr;', WheelDown: 'WHEEL &darr;'
};

function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  return code.toUpperCase();
}

const BIND_ORDER = [
  ['fire', 'Fire'], ['aim', 'Aim down sights'],
  ['forward', 'Move forward'], ['back', 'Move back'],
  ['left', 'Strafe left'], ['right', 'Strafe right'],
  ['jump', 'Jump'], ['crouch', 'Crouch'], ['sprint', 'Sprint'], ['slide', 'Slide'],
  ['leanLeft', 'Peek left'], ['leanRight', 'Peek right'],
  ['grenade', 'Grenade'], ['reload', 'Reload'],
  ['fireMode', 'Fire mode'], ['inspect', 'Inspect weapon'],
  ['scoreboard', 'Scoreboard'], ['pause', 'Pause']
];

export class Menu {
  constructor(root, { audio } = {}) {
    this.root = root;
    this.audio = audio;
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.innerHTML = TEMPLATE;
    root.appendChild(this.el);

    this.board = document.createElement('div');
    this.board.id = 'scoreboard';
    root.appendChild(this.board);

    this.lockPrompt = document.createElement('div');
    this.lockPrompt.id = 'lock-prompt';
    this.lockPrompt.textContent = 'Click to resume';
    root.appendChild(this.lockPrompt);

    this.onStart = null;
    this.onResume = null;
    this.onRestart = null;
    this.onQuitToMenu = null;
    this.onSettingChanged = null;

    this.mode = 'start';        // 'start' | 'pause'
    this.settingsOpen = false;
    this._listening = null;

    this._wire();
    this._buildSettings();
  }

  _wire() {
    const q = (s) => this.el.querySelector(s);
    this.dom = {
      inner: q('.menu-inner'),
      list: q('.menu-list'),
      title: q('.title-block h1'),
      eyebrow: q('.title-block .eyebrow'),
      sub: q('.title-block .sub'),
      panel: q('.panel'),
      panelBody: q('.panel .body'),
      btnPrimary: q('#mi-primary'),
      btnSettings: q('#mi-settings'),
      btnRestart: q('#mi-restart'),
      btnQuit: q('#mi-quit')
    };

    for (const b of this.el.querySelectorAll('.menu-item')) {
      b.addEventListener('mouseenter', () => this.audio?.playUI('hover'));
    }

    this.dom.btnPrimary.addEventListener('click', () => {
      this.audio?.playUI('click');
      if (this.mode === 'start') this.onStart?.();
      else this.onResume?.();
    });
    this.dom.btnSettings.addEventListener('click', () => {
      this.audio?.playUI('click');
      this.toggleSettings();
    });
    this.dom.btnRestart.addEventListener('click', () => {
      this.audio?.playUI('click');
      this.onRestart?.();
    });
    this.dom.btnQuit.addEventListener('click', () => {
      this.audio?.playUI('back');
      this.onQuitToMenu?.();
    });

    // Rebinding grabs the next key or mouse button pressed.
    window.addEventListener('keydown', (e) => {
      if (!this._listening) return;
      e.preventDefault();
      if (e.code !== 'Escape') this._applyBind(this._listening, e.code);
      this._stopListening();
    }, true);
    window.addEventListener('mousedown', (e) => {
      if (!this._listening) return;
      e.preventDefault();
      e.stopPropagation();
      this._applyBind(this._listening, `Mouse${e.button}`);
      this._stopListening();
    }, true);
  }

  _applyBind(action, code) {
    const binds = { ...Settings.data.keybinds, [action]: code };
    Settings.set('keybinds', binds);
    const el = this.el.querySelector(`.bind-key[data-action="${action}"]`);
    if (el) el.innerHTML = keyLabel(code);
    this.audio?.playUI('click');
  }

  _stopListening() {
    const el = this.el.querySelector('.bind-key.listening');
    el?.classList.remove('listening');
    this._listening = null;
  }

  // ------------------------------------------------------------- settings

  _buildSettings() {
    const body = this.dom.panelBody;
    body.innerHTML = '';

    body.appendChild(this._group('Display', [
      this._segment('Quality preset', Object.keys(QUALITY_PRESETS), Settings.data.quality,
        (v) => this._set('quality', v)),
      this._slider('Field of view', 70, 110, 1, Settings.data.fov,
        (v) => this._set('fov', v), (v) => `${v}°`),
      this._slider('Viewmodel FOV', 50, 80, 1, Settings.data.viewmodelFov,
        (v) => this._set('viewmodelFov', v), (v) => `${v}°`),
      this._toggle('Dynamic resolution', Settings.data.dynamicResolution,
        (v) => this._set('dynamicResolution', v)),
      this._toggle('Show performance', Settings.data.showFps,
        (v) => this._set('showFps', v))
    ]));

    body.appendChild(this._group('Image', [
      this._slider('Film grain', 0, 1, 0.05, Settings.data.filmGrain,
        (v) => this._set('filmGrain', v), pct),
      this._slider('Chromatic aberration', 0, 1, 0.05, Settings.data.chromaticAberration,
        (v) => this._set('chromaticAberration', v), pct),
      this._slider('Vignette', 0, 1, 0.05, Settings.data.vignette,
        (v) => this._set('vignette', v), pct),
      this._slider('Camera shake', 0, 1.5, 0.05, Settings.data.cameraShake,
        (v) => this._set('cameraShake', v), pct)
    ]));

    body.appendChild(this._group('Input', [
      this._slider('Sensitivity', 0.1, 3, 0.05, Settings.data.sensitivity,
        (v) => this._set('sensitivity', v), (v) => v.toFixed(2)),
      this._slider('ADS multiplier', 0.2, 1.4, 0.02, Settings.data.adsMultiplier,
        (v) => this._set('adsMultiplier', v), (v) => v.toFixed(2)),
      this._toggle('Invert vertical', Settings.data.invertY, (v) => this._set('invertY', v)),
      this._toggle('Fullscreen on deploy', Settings.data.fullscreenOnPlay === true,
        (v) => this._set('fullscreenOnPlay', v),
        'Also lets the game keep Ctrl+W. On some scaled displays the browser can '
        + 'trap the cursor in a corner of the screen afterwards — turn this off if that happens.'),
      this._toggle('Raw mouse input', Settings.data.rawInput === true,
        (v) => this._set('rawInput', v),
        'Skips pointer acceleration for aiming. Leave off if the cursor ever '
        + 'gets stuck in a region of the screen after a match.')
    ]));

    body.appendChild(this._group('Audio', [
      this._slider('Master volume', 0, 1, 0.05, Settings.data.masterVolume,
        (v) => this._set('masterVolume', v), pct)
    ]));

    body.appendChild(this._group('Match', [
      this._segment('AI difficulty', ['recruit', 'regular', 'veteran', 'elite'],
        Settings.data.difficulty, (v) => this._set('difficulty', v))
    ]));

    const binds = document.createElement('div');
    binds.className = 'group';
    const bt = document.createElement('div');
    bt.className = 'group-title';
    bt.textContent = 'Controls';
    binds.appendChild(bt);
    for (const [action, label] of BIND_ORDER) {
      const row = document.createElement('div');
      row.className = 'bind-row';
      const l = document.createElement('label');
      l.textContent = label;
      const k = document.createElement('button');
      k.className = 'bind-key';
      k.dataset.action = action;
      k.innerHTML = keyLabel(Settings.data.keybinds[action]);
      k.addEventListener('click', (e) => {
        e.stopPropagation();
        this._stopListening();
        this._listening = action;
        k.classList.add('listening');
        k.textContent = 'PRESS…';
        this.audio?.playUI('hover');
      });
      row.append(l, k);
      binds.appendChild(row);
    }
    body.appendChild(binds);

    const reset = document.createElement('button');
    reset.className = 'menu-item';
    reset.style.fontSize = '13px';
    reset.innerHTML = '<span>Reset all settings</span>';
    reset.addEventListener('click', () => {
      Settings.reset();
      this._buildSettings();
      this.onSettingChanged?.('*');
      this.audio?.playUI('back');
    });
    body.appendChild(reset);
  }

  _set(key, value) {
    Settings.set(key, value);
    this.onSettingChanged?.(key, value);
    this.audio?.playUI('click');
  }

  _group(title, rows) {
    const g = document.createElement('div');
    g.className = 'group';
    const t = document.createElement('div');
    t.className = 'group-title';
    t.textContent = title;
    g.appendChild(t);
    for (const r of rows) g.appendChild(r);
    return g;
  }

  _row(label) {
    const row = document.createElement('div');
    row.className = 'setting';
    const l = document.createElement('label');
    l.textContent = label;
    const c = document.createElement('div');
    c.className = 'control';
    row.append(l, c);
    return { row, control: c };
  }

  _slider(label, min, max, step, value, onChange, format = (v) => String(v)) {
    const { row, control } = this._row(label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = value;
    const readout = document.createElement('span');
    readout.className = 'readout';
    readout.textContent = format(value);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      readout.textContent = format(v);
      onChange(v);
    });
    control.append(input, readout);
    return row;
  }

  _toggle(label, value, onChange, hint = '') {
    const { row, control } = this._row(label);
    if (hint) {
      const h = document.createElement('span');
      h.className = 'setting-hint';
      h.textContent = hint;
      row.querySelector('label').appendChild(h);
    }
    const t = document.createElement('div');
    t.className = `toggle${value ? ' on' : ''}`;
    t.addEventListener('click', () => {
      const next = !t.classList.contains('on');
      t.classList.toggle('on', next);
      onChange(next);
    });
    control.append(t);
    return row;
  }

  _segment(label, options, value, onChange) {
    const { row, control } = this._row(label);
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const opt of options) {
      const b = document.createElement('button');
      b.textContent = opt;
      b.className = opt === value ? 'on' : '';
      b.addEventListener('click', () => {
        for (const child of seg.children) child.className = '';
        b.className = 'on';
        onChange(opt);
      });
      seg.appendChild(b);
    }
    control.append(seg);
    return row;
  }

  // --------------------------------------------------------------- states

  showStart() {
    this.mode = 'start';
    this.el.classList.add('show');
    this.dom.eyebrow.textContent = 'Team Deathmatch — Suq Al-Rimal';
    this.dom.title.textContent = 'DUST CORRIDOR';
    this.dom.sub.innerHTML =
      'A market district at midday. Two fireteams, one street, no respawn timer worth waiting out.<br>'
      + 'Everything you are about to see — terrain, buildings, weapon, sky and every sound — is generated at runtime.';
    this.dom.btnPrimary.querySelector('span').textContent = 'Deploy';
    this.dom.btnPrimary.querySelector('.hint').textContent = 'ENTER';
    this.dom.btnRestart.style.display = 'none';
    this.dom.btnQuit.style.display = 'none';
    this.hideBoard();
    this.hideLockPrompt();
  }

  showPause() {
    this.mode = 'pause';
    this.el.classList.add('show');
    this.dom.eyebrow.textContent = 'Match paused';
    this.dom.title.textContent = 'STAND BY';
    this.dom.sub.textContent = 'The match is still running in the background. Take your time.';
    this.dom.btnPrimary.querySelector('span').textContent = 'Resume';
    this.dom.btnPrimary.querySelector('.hint').textContent = 'ESC';
    this.dom.btnRestart.style.display = '';
    this.dom.btnQuit.style.display = '';
  }

  hide() {
    this.el.classList.remove('show');
    this.settingsOpen = false;
    this.dom.panel.classList.remove('show');
    this._stopListening();
  }

  get visible() { return this.el.classList.contains('show'); }

  toggleSettings(force) {
    this.settingsOpen = force !== undefined ? force : !this.settingsOpen;
    this.dom.panel.classList.toggle('show', this.settingsOpen);
    if (!this.settingsOpen) this._stopListening();
  }

  showLockPrompt() { this.lockPrompt.classList.add('show'); }
  hideLockPrompt() { this.lockPrompt.classList.remove('show'); }

  // ---------------------------------------------------------- scoreboard

  showBoard({ won, scoreA, scoreB, rows, reason }) {
    this.board.innerHTML = `
      <div class="board">
        <div class="result ${won ? 'win' : 'loss'}">${won ? 'Victory' : 'Defeat'}</div>
        <div class="final">${scoreA} eliminated &nbsp;·&nbsp; ${scoreB} lost &nbsp;·&nbsp; ${reason}</div>
        <table>
          <thead>
            <tr><th>Operator</th><th>Kills</th><th>Deaths</th><th>K/D</th><th>Headshots</th><th>Accuracy</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr class="${r.self ? 'self ' : ''}team-${r.team.toLowerCase()}">
                <td>${r.name}</td>
                <td>${r.kills}</td>
                <td>${r.deaths}</td>
                <td>${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</td>
                <td>${r.headshots}</td>
                <td>${r.accuracy === null ? '—' : `${Math.round(r.accuracy * 100)}%`}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="actions">
          <button id="board-again">Play again</button>
          <button id="board-menu">Main menu</button>
        </div>
      </div>`;
    this.board.classList.add('show');
    this.board.querySelector('#board-again').addEventListener('click', () => {
      this.audio?.playUI('click');
      this.onRestart?.();
    });
    this.board.querySelector('#board-menu').addEventListener('click', () => {
      this.audio?.playUI('back');
      this.onQuitToMenu?.();
    });
  }

  hideBoard() { this.board.classList.remove('show'); }
  get boardVisible() { return this.board.classList.contains('show'); }
}

function pct(v) { return `${Math.round(v * 100)}%`; }

const TEMPLATE = /* html */`
<div class="frame"></div>
<div class="menu-inner">
  <div class="title-block">
    <div class="eyebrow"></div>
    <h1>DUST CORRIDOR</h1>
    <div class="sub"></div>
  </div>
  <div class="menu-list">
    <button class="menu-item" id="mi-primary"><span>Deploy</span><span class="hint">ENTER</span></button>
    <button class="menu-item" id="mi-settings"><span>Settings</span><span class="hint">O</span></button>
    <button class="menu-item" id="mi-restart"><span>Restart match</span><span class="hint"></span></button>
    <button class="menu-item" id="mi-quit"><span>Abandon match</span><span class="hint"></span></button>
  </div>
</div>
<div class="menu-footer">
  <div><kbd>WASD</kbd> move &nbsp; <kbd>SHIFT</kbd> sprint &nbsp; <kbd>CTRL</kbd> crouch &nbsp; <kbd>C</kbd> slide &nbsp; <kbd>SPACE</kbd> jump</div>
  <div><kbd>Q</kbd> <kbd>E</kbd> peek round corners &nbsp; <kbd>LMB</kbd> fire &nbsp; <kbd>RMB</kbd> aim</div>
  <div><kbd>B</kbd> grenade, hold <kbd>LMB</kbd> for range &nbsp; <kbd>R</kbd> reload &nbsp; <kbd>V</kbd> fire mode &nbsp; <kbd>F</kbd> inspect</div>
  <div><kbd>TAB</kbd> scoreboard &nbsp; <kbd>ESC</kbd> pause</div>
</div>
<div class="panel">
  <h2>Settings</h2>
  <div class="body"></div>
</div>
`;
