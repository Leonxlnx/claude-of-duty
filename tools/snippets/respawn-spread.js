// Respawn should scatter across the map and never drop the player where an
// enemy is already looking. Kill and redeploy repeatedly, then measure both.
const p = g.player;
const Vec = p.eye.constructor;
const points = [];

for (let i = 0; i < 24; i++) {
  const spot = g._pickRespawn();
  if (!spot) { points.push(null); continue; }

  let nearest = Infinity, exposed = false;
  for (const c of g.director.characters) {
    if (!c.alive || c.team === p.team) continue;
    const d = spot.distanceTo(c.position);
    if (d < nearest) nearest = d;
    const a = new Vec().copy(spot); a.y += 1.5;
    const b = new Vec().copy(c.position); b.y += 1.5;
    if (!g.world.bvh.occluded(a, b)) exposed = true;
  }
  points.push({ x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), nearest, exposed });
}

const good = points.filter(Boolean);
const xs = good.map((q) => q.x), zs = good.map((q) => q.z);
const uniq = new Set(good.map((q) => `${Math.round(q.x / 8)},${Math.round(q.z / 8)}`));
const dists = good.map((q) => q.nearest).filter((d) => d < Infinity);

return {
  picked: good.length,
  failed: points.length - good.length,
  distinctAreas: uniq.size,
  spanX: +(Math.max(...xs) - Math.min(...xs)).toFixed(1),
  spanZ: +(Math.max(...zs) - Math.min(...zs)).toFixed(1),
  exposedCount: good.filter((q) => q.exposed).length,
  nearestEnemy: dists.length
    ? { min: +Math.min(...dists).toFixed(1), avg: +(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(1) }
    : 'no living enemies'
};
