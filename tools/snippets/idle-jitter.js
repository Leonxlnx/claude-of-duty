// Sample the eye rig every rendered frame with no input at all, then report how
// much each contributor actually moves. Anything the player reads as shake has
// to show up here as amplitude.
h.releaseAll();
await new Promise((r) => setTimeout(r, 1200));

const s = [];
const prev = g.onFrame;
g.onFrame = () => {
  const p = g.player;
  s.push([
    p.eye.y, p.viewPitch, p.viewYaw, p.viewRoll,
    p.controller.position.y, p.stepSmooth, p.bobAmount.value.y,
    p.heightSpring.value, p.controller.velocity.y, p.speed2D,
    g.graph.renderScale ?? 0
  ]);
};
await new Promise((r) => setTimeout(r, 2500));
g.onFrame = prev;

const names = ['eyeY', 'pitch', 'yaw', 'roll', 'bodyY', 'stepSmooth',
  'bobY', 'heightSpring', 'velY', 'speed2D', 'renderScale'];
const out = { frames: s.length };
for (let i = 0; i < names.length; i++) {
  const col = s.map((r) => r[i]);
  const min = Math.min(...col), max = Math.max(...col);
  // Peak frame-to-frame step matters more than range: a slow drift is
  // invisible, a fast one is the shake.
  let maxStep = 0;
  for (let k = 1; k < col.length; k++) maxStep = Math.max(maxStep, Math.abs(col[k] - col[k - 1]));
  out[names[i]] = {
    range: +(max - min).toPrecision(3),
    maxStep: +maxStep.toPrecision(3)
  };
}
return out;
