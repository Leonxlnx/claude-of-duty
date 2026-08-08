// Is the pointer-lock loss handler actually wired, and does the DOM event reach it?
const before = g.state;
let fired = 0;
const real = g.input.onPointerLockChange;
g.input.onPointerLockChange = (locked) => { fired++; return real?.(locked); };

document.dispatchEvent(new Event('pointerlockchange'));
await h.wait(0.2);

return {
  hasHandler: typeof real === 'function',
  hasErrorHandler: typeof g.input.onPointerLockError === 'function',
  fired,
  stateBefore: before,
  stateAfter: g.state,
  locked: g.input.locked,
  pointerLockElement: String(document.pointerLockElement)
};
