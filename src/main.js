import './ui/style.css';
import { Game } from './game/Game.js';
import { Settings } from './core/Settings.js';
import { installHarness } from './core/Harness.js';
import { showFatalOverlay } from './ui/Fatal.js';

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
  uiRoot.innerHTML = '';
  showFatalOverlay(uiRoot, 'Failed to start', err.message,
    'Requires WebGL2 with multiple render targets and float textures.');
});

// Expose settings so the harness can force a preset without touching storage.
window.__settings = Settings;
