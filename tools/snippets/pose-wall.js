// Walk up to the nearest facade and look straight at it, so a screenshot shows
// wall material detail at the distance a player actually fights from.
const start = g.player.eye.clone();
let best = null;

for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2;
  const hit = g.world.bvh.raycast(start, { x: Math.cos(a), y: 0, z: Math.sin(a) }, 40);
  if (hit.hit && hit.t > 3 && (!best || hit.t < best.t)) best = { t: hit.t, a };
}
if (!best) return { error: 'no wall found' };

const back = 2.6;
const px = start.x + Math.cos(best.a) * (best.t - back);
const pz = start.z + Math.sin(best.a) * (best.t - back);
const py = g.world.groundAt(px, pz) + 0.1;
h.teleport(px, py, pz);
g.playerTarget?.sync?.();
h.aimAt(
  start.x + Math.cos(best.a) * (best.t + 1),
  py + 1.6,
  start.z + Math.sin(best.a) * (best.t + 1)
);
return { distance: best.t, standoff: back };
