// Bumped when a default changes in a way that a stored set would contradict:
// saved values win over defaults on load. v2 -> v3 turns fullscreen-on-play
// off for everyone, because the stored `true` from v2 would keep the cursor
// trap alive on the machines that suffer from it.
const STORAGE_KEY = 'dust-corridor.settings.v3';

/**
 * Ten quality levels, where 4 is what used to be called "ultra".
 *
 * The old top preset rendered at exactly native resolution, so there was
 * nothing above "no aliasing beyond what TAA removes" — no supersampling, no
 * sharper shadows, nowhere for a strong machine to spend. Levels 5 and up
 * exist to be spent: the render target grows past the display (the single
 * biggest lever on how crisp a frame looks, because every pixel is then an
 * average of several), shadows sharpen, AO and cloud march get more samples.
 *
 * `renderScale` is a linear multiplier on each axis, so level 8 at 1.6 is 2.6x
 * the pixels of native. That is the cost, and it is meant to be.
 *
 * Motion blur backs off as the level rises rather than increasing: at the top
 * the point is a clean, resolved image, and blur is the opposite of that.
 */
export const QUALITY_LEVELS = [
  { // 1
    renderScale: 0.72, shadowResolution: 1024, shadowCascades: 3, aoSamples: 4, aoEnabled: true,
    cloudSteps: 12, particleDensity: 0.45, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: false, decalBudget: 96, maxRigidBodies: 90, heatHaze: false, sharpen: 0.30
  },
  { // 2
    renderScale: 0.85, shadowResolution: 1536, shadowCascades: 4, aoSamples: 6, aoEnabled: true,
    cloudSteps: 20, particleDensity: 0.7, motionBlur: 'low', bloom: true, taa: true,
    contactShadows: true, decalBudget: 160, maxRigidBodies: 140, heatHaze: true, sharpen: 0.32
  },
  { // 3
    renderScale: 1.0, shadowResolution: 2048, shadowCascades: 4, aoSamples: 9, aoEnabled: true,
    cloudSteps: 30, particleDensity: 1.0, motionBlur: 'low', bloom: true, taa: true,
    contactShadows: true, decalBudget: 256, maxRigidBodies: 200, heatHaze: true, sharpen: 0.32
  },
  { // 4 — the old "ultra"
    renderScale: 1.0, shadowResolution: 3072, shadowCascades: 4, aoSamples: 12, aoEnabled: true,
    cloudSteps: 44, particleDensity: 1.35, motionBlur: 'low', bloom: true, taa: true,
    contactShadows: true, decalBudget: 384, maxRigidBodies: 260, heatHaze: true, sharpen: 0.34
  },
  { // 5 — first level that supersamples
    renderScale: 1.15, shadowResolution: 3072, shadowCascades: 4, aoSamples: 14, aoEnabled: true,
    cloudSteps: 52, particleDensity: 1.5, motionBlur: 'low', bloom: true, taa: true,
    contactShadows: true, decalBudget: 448, maxRigidBodies: 300, heatHaze: true, sharpen: 0.36
  },
  { // 6
    renderScale: 1.3, shadowResolution: 4096, shadowCascades: 4, aoSamples: 16, aoEnabled: true,
    cloudSteps: 64, particleDensity: 1.6, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: true, decalBudget: 512, maxRigidBodies: 340, heatHaze: true, sharpen: 0.38
  },
  // Levels 7-10 spend almost everything they cost on render scale, because
  // that is the lever the eye actually reads. The others are deliberately held
  // back: measured, an 8192 map across 5 cascades is 335MB of depth on its own
  // and bought nothing a 4096 map does not already resolve, and a 120-step
  // cloud march is the most expensive pass in the frame for a layer that
  // composites at half resolution behind everything. Both were most of why
  // level 10 collapsed to single-figure frame rates while looking no sharper
  // than 8.
  { // 7
    renderScale: 1.45, shadowResolution: 4096, shadowCascades: 4, aoSamples: 18, aoEnabled: true,
    cloudSteps: 64, particleDensity: 1.75, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: true, decalBudget: 576, maxRigidBodies: 380, heatHaze: true, sharpen: 0.40
  },
  { // 8 — the intended "looks great and still plays" level
    // Four cascades, not five. A fifth is an entire extra shadow render of the
    // scene for detail at a distance where the supersampling has already done
    // the visible work, and it was a large part of why 8 fell off a cliff
    // relative to 6.
    renderScale: 1.6, shadowResolution: 4096, shadowCascades: 4, aoSamples: 16, aoEnabled: true,
    cloudSteps: 64, particleDensity: 1.8, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: true, decalBudget: 640, maxRigidBodies: 420, heatHaze: true, sharpen: 0.42
  },
  { // 9
    renderScale: 1.8, shadowResolution: 4096, shadowCascades: 5, aoSamples: 20, aoEnabled: true,
    cloudSteps: 80, particleDensity: 2.0, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: true, decalBudget: 704, maxRigidBodies: 460, heatHaze: true, sharpen: 0.44
  },
  { // 10 — 4x the pixels of native. For a machine with nothing better to do.
    renderScale: 2.0, shadowResolution: 6144, shadowCascades: 5, aoSamples: 22, aoEnabled: true,
    cloudSteps: 88, particleDensity: 2.2, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: true, decalBudget: 768, maxRigidBodies: 500, heatHaze: true, sharpen: 0.46
  }
];

/** The old names, kept so saved profiles and the harness keep working. */
export const QUALITY_PRESETS = {
  low: QUALITY_LEVELS[0],
  medium: QUALITY_LEVELS[1],
  high: QUALITY_LEVELS[2],
  ultra: QUALITY_LEVELS[3]
};

const QUALITY_ALIAS = { low: 1, medium: 2, high: 3, ultra: 4 };

/** Accepts a 1-10 level or one of the legacy names. */
export function resolveQualityLevel(value) {
  const n = typeof value === 'number' ? value : QUALITY_ALIAS[value];
  if (!n || Number.isNaN(n)) return 3;
  return Math.min(QUALITY_LEVELS.length, Math.max(1, Math.round(n)));
}

const DEFAULTS = {
  // 1-10; 4 is the old "ultra". Legacy names still resolve.
  //
  // 4 is the default: it is the best-looking level that still renders at
  // native resolution, so it costs no supersampling and dynamic resolution can
  // pull it down if a machine struggles. 5 and up are an explicit choice to
  // spend, not something anyone should land on without asking for it.
  quality: 4,
  sensitivity: 0.9,
  adsMultiplier: 0.72,
  fov: 90,
  viewmodelFov: 78,
  invertY: false,
  masterVolume: 0.85,
  musicless: true,
  dynamicResolution: true,
  filmGrain: 0.35,
  chromaticAberration: 0.4,
  vignette: 0.5,
  cameraShake: 0.85,
  showFps: true,
  difficulty: 'regular',
  // dawn | morning | day | sunset | night — see TIME_OF_DAY in render/Sky.js
  timeOfDay: 'day',
  // Hold the browser's own shortcuts (Ctrl+W, Ctrl+T, Ctrl+N...) so they reach
  // the game instead of the browser. Requires fullscreen — the Keyboard Lock
  // API is only honoured there, and it is the only mechanism that can do this
  // at all. Off by default because it takes the window over; on is the right
  // answer for anyone who wants crouch on Ctrl.
  captureShortcuts: false,
  // Raw (unadjusted) mouse input. Skips OS pointer acceleration, but its
  // Windows path is implicated in the stuck cursor clip on scaled displays.
  rawInput: false,
  keybinds: {
    fire: 'Mouse0', aim: 'Mouse2',
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    // Crouch is C, not Ctrl.
    //
    // A page cannot cancel Ctrl+W — it is reserved by the browser and never
    // reaches the document — so with crouch on Ctrl, crouch-walking forward
    // closed the tab. Ctrl+D, Ctrl+S, Ctrl+P and Ctrl+N are all reachable the
    // same way. C already doubles as the slide key and the movement code has
    // always treated the two as one intent (`crouch || slide`): tapped while
    // still it crouches, held out of a sprint it slides. Sharing the bind
    // matches the mechanic and leaves Ctrl unbound.
    jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft', slide: 'KeyC',
    reload: 'KeyR', inspect: 'KeyF', fireMode: 'KeyV', grenade: 'KeyB',
    leanLeft: 'KeyQ', leanRight: 'KeyE', pause: 'Escape', scoreboard: 'Tab'
  },
  // per-preset overrides applied on top of the quality preset
  overrides: {}
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

class SettingsStore {
  constructor() {
    this.data = deepClone(DEFAULTS);
    this.listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...deepClone(DEFAULTS), ...parsed, keybinds: { ...DEFAULTS.keybinds, ...(parsed.keybinds || {}) } };
        this._retireControlBinds();
      }
    } catch { /* storage unavailable — defaults are fine */ }
    const params = new URLSearchParams(location.search);
    if (params.has('quality')) this.data.quality = params.get('quality');
    if (params.has('grain')) this.data.filmGrain = parseFloat(params.get('grain'));
    if (params.has('dynres')) this.data.dynamicResolution = params.get('dynres') !== '0';
  }

  /**
   * Take Ctrl off any movement action a stored profile still has on it.
   *
   * Changing the default is not enough on its own: stored keybinds are spread
   * over the defaults, so anyone who has played before keeps the old bind
   * forever and keeps closing their tab. This rewrites it once, on load, and
   * the result is saved so it does not run again.
   *
   * Only the movement actions, and only Ctrl. A player who deliberately binds
   * Ctrl to something they do not press with W is left alone — the warning in
   * the rebinding UI is enough there.
   */
  _retireControlBinds() {
    // With shortcut capture on, Ctrl is the game's and there is nothing to
    // retire — stripping it here would silently undo the player's choice
    // every time they loaded the page.
    if (this.data.captureShortcuts === true) return;
    const CTRL = new Set(['ControlLeft', 'ControlRight']);
    const SAFE = { crouch: 'KeyC', forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft' };
    let changed = false;
    for (const [action, fallback] of Object.entries(SAFE)) {
      if (CTRL.has(this.data.keybinds[action])) {
        this.data.keybinds[action] = fallback;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this.save();
    for (const l of this.listeners) l(key, value);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get qualityLevel() { return resolveQualityLevel(this.data.quality); }

  get preset() {
    const base = QUALITY_LEVELS[this.qualityLevel - 1];
    return { ...base, level: this.qualityLevel, ...this.data.overrides };
  }

  reset() {
    this.data = deepClone(DEFAULTS);
    this.save();
    for (const l of this.listeners) l('*', this.data);
  }
}

export const Settings = new SettingsStore();
