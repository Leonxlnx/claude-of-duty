const p = g.player;
p.spawnProtect = 1e9;
const wait = (s) => h.wait(s);
const Vec = p.eye.constructor;
const from = new Vec();

const clearAhead = (angle) => {
  const dir = new Vec(-Math.sin(angle), 0, -Math.cos(angle));
  from.copy(p.controller.position);
  let d = 40;
  for (const hy of [0.4, 1.1, 1.7]) {
    const hit = g.world.bvh.raycast(new Vec(from.x, from.y + hy, from.z), dir, 40);
    if (hit.hit) d = Math.min(d, hit.t);
  }
  return d;
};

const headings = [];
for (let a = 0; a < 24; a++) {
  const ang = (a / 24) * Math.PI * 2;
  headings.push({ ang: +ang.toFixed(2), d: +clearAhead(ang).toFixed(1) });
}
headings.sort((x, y) => y.d - x.d);

h.releaseAll();
await wait(0.4);

const runs = [];
for (const { ang, d } of headings.slice(0, 4)) {
  p.yaw = ang; p.pitch = 0;
  h.key('KeyW', true);
  h.key('ShiftLeft', true);
  await wait(1.2);
  runs.push({
    ang, clear: d,
    speed: +p.speed2D.toFixed(2),
    sprinting: p.sprinting,
    sprintKey: g.input.action('sprint'),
    airborneFor: +p.airborneFor.toFixed(2),
    crouched: p.crouched,
    cooldown: +p.slideCooldown.toFixed(2)
  });
  if (p.speed2D > 7) break;
  h.releaseAll();
  await wait(0.5);
}

// try the slide from the last run
h.key('KeyC', true);
let slid = false;
for (let i = 0; i < 16; i++) {
  await wait(0.04);
  if (p.sliding) slid = true;
}
h.releaseAll();

return { pos: [+p.controller.position.x.toFixed(1), +p.controller.position.z.toFixed(1)], runs, slid };
