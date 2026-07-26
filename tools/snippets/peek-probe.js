// Drive _allowedLean directly against a wall at a known lateral distance and
// dump what each probe ray actually sees.
const p = g.player;
const Vec = p.eye.constructor;
const bvh = g.world.bvh;

// Park somewhere open and find a wall to stand beside.
const open = g.nav.randomPoint(g.rng, new Vec());
p.controller.position.copy(open);
p.controller.position.y += 0.1;
await new Promise((r) => setTimeout(r, 500));

const body = new Vec().copy(p.controller.position);
const eyeY = body.y + p.eyeHeight;
const dir = new Vec();
let found = null;
for (let a = 0; a < 96; a++) {
  const ang = (a / 96) * Math.PI * 2;
  dir.set(Math.sin(ang), 0, Math.cos(ang));
  const from = new Vec(body.x, eyeY, body.z);
  const hit = bvh.raycast(from, dir, 10);
  if (hit.hit && hit.t > 2) { found = { ang, t: hit.t, dir: dir.clone() }; break; }
}
if (!found) return { error: 'no wall in range' };

const standoff = 0.30;
p.controller.position.x = body.x + found.dir.x * (found.t - standoff);
p.controller.position.z = body.z + found.dir.z * (found.t - standoff);
// forward = dir rotated so the wall lands off the right shoulder
p.yaw = Math.atan2(-found.dir.x, -found.dir.z) + Math.PI / 2;

// What does the player's own right vector look like versus the wall direction?
const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
const right = new Vec(cos, 0, -sin);
const dot = right.dot(found.dir);

// Re-probe by hand at the same three heights the game uses.
const probes = [];
for (const dy of [0.12, -0.02, -0.34]) {
  const from = new Vec(
    p.controller.position.x,
    p.controller.position.y + p.eyeHeight + dy,
    p.controller.position.z
  );
  const hit = bvh.raycast(from, right, 0.68);
  probes.push({ dy, hit: hit.hit, t: hit.hit ? +hit.t.toFixed(3) : null });
}

return {
  wallDistance: +found.t.toFixed(3),
  standoff,
  rightDotWallDir: +dot.toFixed(3),
  probes,
  allowedRight: +p._allowedLean(1).toFixed(3),
  allowedLeft: +p._allowedLean(-1).toFixed(3)
};
