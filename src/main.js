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

// Nothing here re-acquires pointer lock.
//
// This used to relock on any canvas mousedown while the state was 'playing',
// which combined with a lock-loss handler that never ran meant Escape gave the
// mouse back and the very next click took it again, with no menu in between.
// The mouse is now only ever taken from a deliberate press of Deploy or
// Resume; losing it pauses the match, and it stays lost until asked for.
void canvas;

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
