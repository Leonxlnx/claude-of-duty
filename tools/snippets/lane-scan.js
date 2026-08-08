// Where in the market lane can a sprint actually build up? For each candidate
// start, the clear distance south (-Z) measured the way a body travels: three
// heights at both shoulders as well as the centre line.
const p = g.player;
const Vec = p.eye.constructor;
const bvh = g.world.bvh;
const R = 0.34;   // controller radius

const clearSouth = (x, y, z) => {
  const dir = new Vec(0, 0, -1);
  let d = 60;
  for (const side of [-R, 0, R]) {
    for (const hy of [0.35, 1.1, 1.7]) {
      const hit = bvh.raycast(new Vec(x + side, y + hy, z), dir, 60);
      if (hit.hit) d = Math.min(d, hit.t);
    }
  }
  return +d.toFixed(2);
};

const out = [];
for (let x = -6; x <= 6; x += 0.5) {
  for (let z = 4; z <= 22; z += 1) {
    if (!g.nav.isWalkableAt(x, z)) continue;
    const y = g.nav.heightAt(x, z) + 0.05;
    out.push({ x: +x.toFixed(1), z, south: clearSouth(x, y, z) });
  }
}
out.sort((a, b) => b.south - a.south);
return out.slice(0, 16);
