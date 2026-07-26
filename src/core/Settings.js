// Bumped when the default bindings change in a way that a stored set would
// contradict: saved keys win over defaults on load, so leaving v1 in place
// would keep B on the fire selector while the grenade also claimed it.
const STORAGE_KEY = 'dust-corridor.settings.v2';

export const QUALITY_PRESETS = {
  low: {
    renderScale: 0.72, shadowResolution: 1024, shadowCascades: 3, aoSamples: 4, aoEnabled: true,
    cloudSteps: 12, particleDensity: 0.45, motionBlur: 'off', bloom: true, taa: true,
    contactShadows: false, decalBudget: 96, maxRigidBodies: 90, heatHaze: false
  },
  medium: {
    renderScale: 0.85, shadowResolution: 1536, shadowCascades: 4, aoSamples: 6, aoEnabled: true,
    cloudSteps: 20, particleDensity: 0.7, motionBlur: 'low', bloom: true, taa: true,
    contactShadows: true, decalBudget: 160, maxRigidBodies: 140, heatHaze: true
  },
  high: {
    renderScale: 1.0, shadowResolution: 2048, shadowCascades: 4, aoSamples: 9, aoEnabled: true,
    cloudSteps: 30, particleDensity: 1.0, motionBlur: 'low', bloom: true, taa: true,
    contactShadows: true, decalBudget: 256, maxRigidBodies: 200, heatHaze: true
  },
  ultra: {
    renderScale: 1.0, shadowResolution: 3072, shadowCascades: 4, aoSamples: 12, aoEnabled: true,
    cloudSteps: 44, particleDensity: 1.35, motionBlur: 'high', bloom: true, taa: true,
    contactShadows: true, decalBudget: 384, maxRigidBodies: 260, heatHaze: true
  }
};

const DEFAULTS = {
  quality: 'high',
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
  // Crouch is Ctrl, and only a fullscreen tab can take Ctrl+W back off the
  // browser. Turn this off and crouch-walking forward will close the tab.
  fullscreenOnPlay: true,
  keybinds: {
    fire: 'Mouse0', aim: 'Mouse2',
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft', slide: 'KeyC',
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
      }
    } catch { /* storage unavailable — defaults are fine */ }
    const params = new URLSearchParams(location.search);
    if (params.has('quality')) this.data.quality = params.get('quality');
    if (params.has('grain')) this.data.filmGrain = parseFloat(params.get('grain'));
    if (params.has('dynres')) this.data.dynamicResolution = params.get('dynres') !== '0';
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

  get preset() {
    const base = QUALITY_PRESETS[this.data.quality] || QUALITY_PRESETS.high;
    return { ...base, ...this.data.overrides };
  }

  reset() {
    this.data = deepClone(DEFAULTS);
    this.save();
    for (const l of this.listeners) l('*', this.data);
  }
}

export const Settings = new SettingsStore();
