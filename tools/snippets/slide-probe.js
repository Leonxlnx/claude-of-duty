// Slide out of a sprint from a fixed start: the north end of the market lane,
// running south down the middle of the street. The old version of this probe
// sprinted from wherever the player happened to spawn, which is why it could
// report a broken slide on a build where the slide worked fine.
const p = g.player;
const h2 = h;
p.spawnProtect = 1e9;
const wait = (s) => h2.wait(s);

const START = { x: -0.5, z: 14 };   // market lane, north end
const HEADING = 0;                // yaw 0 => forward is -Z, down the lane

h2.releaseAll();
h2.teleport(START.x, g.nav.heightAt(START.x, START.z) + 0.1, START.z);
g.playerTarget?.sync?.();
p.yaw = HEADING; p.pitch = 0;
await wait(0.4);

const standingEye = p.eye.y - p.controller.position.y;

h2.key('KeyW', true);
h2.key('ShiftLeft', true);
const trace = [];
for (let i = 0; i < 8; i++) {
  await wait(0.15);
  trace.push(+p.speed2D.toFixed(2));
}

let entrySpeed = 0, priorSpeed = 0;
p.onSlide = () => {
  priorSpeed = p.speed2D;
  entrySpeed = Math.hypot(p.controller.velocity.x, p.controller.velocity.z);
};

h2.key('KeyC', true);
let slid = false, lowestEye = Infinity;
for (let i = 0; i < 16; i++) {
  await wait(0.04);
  if (p.sliding) slid = true;
  lowestEye = Math.min(lowestEye, p.eye.y - p.controller.position.y);
}
p.onSlide = null;
h2.releaseAll();
await wait(1.4);

return {
  start: START,
  sprintTrace: trace,
  sprintSpeed: trace[trace.length - 1],
  slid, entrySpeed: +entrySpeed.toFixed(2), priorSpeed: +priorSpeed.toFixed(2),
  headDrop: +(standingEye - lowestEye).toFixed(2),
  endedCleanly: !p.sliding,
  settledSpeed: +p.speed2D.toFixed(2),
  endPos: [+p.controller.position.x.toFixed(1), +p.controller.position.z.toFixed(1)]
};
