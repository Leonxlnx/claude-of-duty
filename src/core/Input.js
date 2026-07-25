import { Settings } from './Settings.js';

/**
 * Raw pointer-lock mouse + keyboard input. Mouse deltas are accumulated per
 * frame from raw movementX/Y so camera response never depends on frame pacing
 * beyond the accumulation window.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Map();
    this.pressedThisFrame = new Set();
    this.releasedThisFrame = new Set();
    this._look = { x: 0, y: 0 };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = [false, false, false];
    this.buttonsPressed = [false, false, false];
    this.locked = false;
    this.enabled = true;
    this.onPointerLockChange = null;
    this.onPauseRequested = null;
    this._blockedCodes = new Set(['Tab', 'F1', 'F3', 'F5']);

    this._bind();
  }

  _bind() {
    const kd = (e) => {
      if (!this.enabled) return;
      if (this._blockedCodes.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (!this.keys.get(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.set(e.code, true);
      if (e.code === 'Escape' && this.onPauseRequested) this.onPauseRequested();
    };
    const ku = (e) => {
      this.keys.set(e.code, false);
      this.releasedThisFrame.add(e.code);
    };
    window.addEventListener('keydown', kd, { passive: false });
    window.addEventListener('keyup', ku);

    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      if (e.button < 3) {
        if (!this.buttons[e.button]) this.buttonsPressed[e.button] = true;
        this.buttons[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.buttons = [false, false, false];
      }
      if (this.onPointerLockChange) this.onPointerLockChange(this.locked);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = [false, false, false];
    });
  }

  async requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) await p.catch(() => this.canvas.requestPointerLock());
    } catch {
      try { this.canvas.requestPointerLock(); } catch { /* pointer lock unavailable */ }
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Test seam. Pointer lock does not exist in a headless browser, so the
   * automated harness pushes input through here instead of faking DOM events.
   */
  inject({ key, down, look, button }) {
    if (key !== undefined) {
      if (down && !this.keys.get(key)) this.pressedThisFrame.add(key);
      if (!down) this.releasedThisFrame.add(key);
      this.keys.set(key, !!down);
    }
    if (look) { this.mouseDX += look.x || 0; this.mouseDY += look.y || 0; }
    if (button !== undefined) {
      if (down && !this.buttons[button]) this.buttonsPressed[button] = true;
      this.buttons[button] = !!down;
    }
  }

  action(name) {
    const code = Settings.data.keybinds[name];
    if (!code) return false;
    const mouse = mouseIndex(code);
    return mouse >= 0 ? this.buttons[mouse] === true : this.keys.get(code) === true;
  }

  actionPressed(name) {
    const code = Settings.data.keybinds[name];
    if (!code) return false;
    const mouse = mouseIndex(code);
    return mouse >= 0 ? this.buttonsPressed[mouse] === true : this.pressedThisFrame.has(code);
  }

  /**
   * Consume the accumulated mouse delta, in radians of view rotation.
   * The returned vector is reused between calls.
   */
  consumeLook() {
    const s = Settings.data.sensitivity * 0.0022;
    this._look.x = this.mouseDX * s;
    this._look.y = this.mouseDY * s * (Settings.data.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    return this._look;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.buttonsPressed[0] = this.buttonsPressed[1] = this.buttonsPressed[2] = false;
    this.wheel = 0;
  }
}

/** Bindings are stored as key codes or `Mouse0`/`Mouse1`/`Mouse2`. */
function mouseIndex(code) {
  return code.startsWith('Mouse') ? Number(code.slice(5)) : -1;
}
