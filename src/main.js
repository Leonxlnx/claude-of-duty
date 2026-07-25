import './ui/style.css';
import { Game } from './game/Game.js';
import { Settings } from './core/Settings.js';
import { installHarness } from './core/Harness.js';

/**
 * Entry point. Boots the game, wires the global keys and exposes a small
 * handle for the automated harness.
 */

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui-root');

const game = new Game(canvas, uiRoot);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (game.handleKey?.(e.code)) e.preventDefault();
}, false);

// Clicking the canvas re-acquires pointer lock after an accidental release.
canvas.addEventListener('mousedown', () => {
  if (game.state === 'playing') game.input.requestLock();
});

game.boot().then(() => {
  window.__game = game;
  installHarness(game);
  window.__ready = true;
  // ?auto=1 drops straight into a match, which is how the tests run.
  if (new URLSearchParams(location.search).get('auto') === '1') game.startMatch();
}).catch((err) => {
  console.error(err);
  uiRoot.innerHTML = `
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                flex-direction:column;gap:14px;font-family:ui-monospace,monospace;color:#e8e4dc;
                background:#0b0c0e;text-align:center;padding:40px">
      <div style="color:#e8613c;letter-spacing:.3em;font-size:11px">FAILED TO START</div>
      <div style="font-size:14px;max-width:520px;line-height:1.7">${err.message}</div>
      <div style="font-size:11px;color:#5d5a55">This game requires a WebGL2 context with
        multiple render targets and float textures.</div>
    </div>`;
});

// Expose settings so the harness can force a preset without touching storage.
window.__settings = Settings;
