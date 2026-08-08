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
    this.onPointerLockError = null;
    this.onPauseRequested = null;
    // Keys the browser must keep even while the pointer is locked. Everything
    // else is swallowed: crouch is Ctrl, so Ctrl+D bookmarks the page, Ctrl+S
    // saves it and Ctrl+P opens print — all reachable by crouch-walking.
    this._passThroughCodes = new Set(['F5', 'F11', 'F12']);
    // ...and while it is not locked the menu is a normal focusable document, so
    // only the keys that would move focus out from under it are taken.
    this._blockedCodes = new Set(['Tab', 'F1', 'F3']);

    this._bind();
  }

  _bind() {
    const kd = (e) => {
      if (!this.enabled) return;
      // Escape is the browser's own way out of pointer lock and cannot be
      // cancelled; F5/F11/F12 stay usable on purpose. Ctrl+W and Ctrl+T are
      // reserved by the browser and cannot be blocked from a page at all,
      // which is why nothing in the default binds pairs with them.
      if (this.locked ? !this._passThroughCodes.has(e.code) : this._blockedCodes.has(e.code)) {
        e.preventDefault();
      }
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
      if (this.locked) this._lockKeyboard();
      else {
        this._unwind();
        this.keys.clear();
        this.buttons = [false, false, false];
      }
      if (this.onPointerLockChange) this.onPointerLockChange(this.locked);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = [false, false, false];
      // Focus is leaving with the lock still held — alt-tab, a notification, a
      // debugger. Give everything back now: a confinement held across a focus
      // change is the state that goes stale.
      this.releaseLock();
    });
    // A hidden tab must hold nothing. Anything left engaged here is exactly
    // the state that outlives the tab in the compositor.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseLock();
    });
    // The player can leave fullscreen without us — F11, Escape, the browser's
    // own bubble. Forgetting that we entered it keeps `_unwind` honest about
    // what it is allowed to tear down.
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        this._enteredFullscreen = false;
        this._unlockKeyboard();
      }
    });
  }

  /**
   * Take the mouse, and fullscreen with it.
   *
   * Fullscreen is not cosmetic here: it is the only state in which the Keyboard
   * Lock API will hand over Ctrl+W and Ctrl+T. Crouch is Ctrl, so without it a
   * player who crouch-walks forward closes the tab, and no amount of
   * preventDefault on the page can stop that.
   */
  async requestLock() {
    if (this.locked) return;
    if (!document.fullscreenElement && Settings.data.fullscreenOnPlay !== false) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        this._enteredFullscreen = true;
      } catch { /* denied or unsupported */ }
    }
    // Raw mouse input (unadjustedMovement) bypasses pointer acceleration, but
    // on Windows it also takes a different cursor-confinement path — the one
    // implicated when the visible cursor stays pinned to a corner of the
    // screen after the lock ends on scaled displays. It is opt-in: aim feel
    // costs a preference, a trapped cursor costs the whole session.
    const wantRaw = Settings.data.rawInput === true;
    const ok = wantRaw
      ? (await this._attemptLock({ unadjustedMovement: true }) || await this._attemptLock())
      : await this._attemptLock();
    if (!ok) {
      // Half-acquired is the dangerous state: fullscreen without pointer lock
      // leaves the browser's cursor confinement with nothing to release it.
      this._unwind();
      this.onPointerLockError?.();
    }
  }

  /**
   * Ask for the lock and resolve with whether it was actually granted.
   *
   * Awaiting the return of `requestPointerLock()` does not answer that.
   * Current Chromium returns a promise; older engines return `undefined`, and
   * `await undefined` is a resolved `true` — so a refused request reported
   * success and the game carried on believing it had the mouse. The events are
   * the only reliable answer. Refusal is a normal outcome here and not an
   * error: the spec has the browser reject a request made straight after its
   * own unlock gesture, which is exactly what Escape-then-click looks like.
   */
  _attemptLock(options) {
    return new Promise((resolve) => {
      const held = () => document.pointerLockElement === this.canvas;
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => finish(held());
      const onError = () => finish(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      // Neither event is guaranteed to arrive — a headless browser fires
      // nothing at all — so the wait is bounded and the DOM has the last word.
      const timer = setTimeout(() => finish(held()), 1500);

      try {
        const pending = this.canvas.requestPointerLock(options);
        if (pending && typeof pending.then === 'function') {
          pending.then(() => finish(held()), () => finish(false));
        }
      } catch {
        finish(false);
      }
    });
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    else this._unwind();
  }

  /**
   * Give back everything the lock took, together and in order.
   *
   * Chromium confines the OS cursor with a clip rectangle while the pointer is
   * locked in fullscreen, and on displays with scaling that rectangle is
   * computed in the wrong units — releasing only the pointer lock can leave a
   * stale clip pinning the visible cursor into the top-left quarter of the
   * screen until something else resets it. Tearing down keyboard lock and the
   * fullscreen we entered whenever the pointer lock ends forces the browser to
   * recompute, which is the only page-side lever there is.
   */
  _unwind() {
    this._unlockKeyboard();
    if (this._enteredFullscreen && document.fullscreenElement) {
      this._enteredFullscreen = false;
      document.exitFullscreen().catch(() => { /* already gone */ });
    }
  }

  /**
   * A page cannot cancel Ctrl+W or Ctrl+T with preventDefault. The Keyboard
   * Lock API can, but only in fullscreen, so this is a bonus on top of the
   * blanket preventDefault rather than a replacement for it.
   */
  _lockKeyboard() {
    if (!document.fullscreenElement || !navigator.keyboard?.lock) return;
    navigator.keyboard.lock().catch(() => { /* not permitted; preventDefault still applies */ });
    this._keyboardLocked = true;
  }

  _unlockKeyboard() {
    if (!this._keyboardLocked) return;
    this._keyboardLocked = false;
    try { navigator.keyboard.unlock(); } catch { /* already released */ }
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

  /**
   * Edge-triggered actions, consumed on read.
   *
   * The simulation runs a fixed step and can take several substeps per rendered
   * frame, so a press that merely sits in the set until the end of the frame
   * fires its action once per substep — one tap of the fire selector would walk
   * through every mode. Consuming here makes it exactly once per press.
   */
  actionPressed(name) {
    const code = Settings.data.keybinds[name];
    if (!code) return false;
    const mouse = mouseIndex(code);
    if (mouse >= 0) {
      if (!this.buttonsPressed[mouse]) return false;
      this.buttonsPressed[mouse] = false;
      return true;
    }
    return this.pressedThisFrame.delete(code);
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

  /** Drop any edge nobody consumed, so it cannot leak into the next frame. */
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
