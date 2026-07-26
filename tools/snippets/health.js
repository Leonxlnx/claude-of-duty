// Is the loop even running? Count rAF ticks as a control against the game's
// own onFrame callback.
let raf = 0, frame = 0;
const tickRaf = () => { raf++; requestAnimationFrame(tickRaf); };
requestAnimationFrame(tickRaf);

const prev = g.onFrame;
g.onFrame = () => { frame++; };
const t0 = performance.now();
await new Promise((r) => setTimeout(r, 1500));
const wall = performance.now() - t0;
g.onFrame = prev;

return {
  wallMs: Math.round(wall),
  rafTicks: raf,
  gameFrames: frame,
  state: g.state,
  hidden: document.hidden,
  visibility: document.visibilityState,
  playerAlive: g.player.alive,
  paused: g.loop?.paused ?? null,
  running: g.loop?.running ?? null,
  frameStats: g.frameStats,
  hadPrevOnFrame: typeof prev
};
