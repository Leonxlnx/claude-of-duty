const nav = g.nav;
const Vec = g.player.eye.constructor;
const up = new Vec(0, 1, 0);
const buildings = g.world.buildings;
const pb = g.world.playBounds;

const inFootprint = (p) => buildings.some(
  (b) => p.x > b.x0 - 0.4 && p.x < b.x1 + 0.4 && p.z > b.z0 - 0.4 && p.z < b.z1 + 0.4
);
const outsidePlay = (p) => p.x < pb.x0 || p.x > pb.x1 || p.z < pb.z0 || p.z > pb.z1;
const roofed = (p) => g.world.bvh.raycast(new Vec(p.x, p.y + 1.2, p.z), up, 5.5).hit;

let walkable = 0, spawnable = 0;
for (let i = 0; i < nav.walkable.length; i++) {
  if (nav.walkable[i]) walkable++;
  if (nav.spawnable[i]) spawnable++;
}

let bad = 0, checked = 0;
const badOnes = [];
for (let n = 0; n < 60; n++) {
  const p = g._pickRespawn();
  if (!p) continue;
  checked++;
  const why = [];
  if (inFootprint(p)) why.push('footprint');
  if (outsidePlay(p)) why.push('margin');
  if (roofed(p)) why.push('roofed');
  if (why.length) { bad++; badOnes.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), why }); }
}

const agentsBad = g.director.agents
  .map((a) => a.controller.position)
  .filter((p) => inFootprint(p) || outsidePlay(p) || roofed(p)).length;

return { walkable, spawnable, checked, bad, badOnes: badOnes.slice(0, 5), agents: g.director.agents.length, agentsBad };
