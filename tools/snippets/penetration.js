// Shoot a penetrable surface and count what comes out the far side.
const before = g.combat.particles.count;
const Vec = g.player.eye.constructor;
const bvh = g.world.bvh;

// Sweep headings from the player and take the first surface in range.
const eye = g.player.eye.clone();
let found = null;
for (let a = 0; a < 64 && !found; a++) {
  const ang = (a / 64) * Math.PI * 2;
  const dir = new Vec(-Math.sin(ang), 0, -Math.cos(ang));
  const hit = bvh.raycast(eye, dir, 30);
  if (!hit.hit) continue;
  found = { ang, t: +hit.t.toFixed(2), surface: hit.surface };
}
if (!found) return { error: 'nothing within 30m' };

g.player.yaw = found.ang;
g.player.pitch = 0;
g.weapon.ammo = g.weapon.spec.magSize;

const spawned = [];
for (let i = 0; i < 4; i++) {
  const c0 = g.combat.particles.count;
  g.combat.fireBullet({
    origin: g.player.eye.clone(),
    direction: new Vec(-Math.sin(found.ang), 0, -Math.cos(found.ang)),
    owner: null, damage: 34, firstPerson: true
  });
  spawned.push(g.combat.particles.count - c0);
  await h.wait(0.05);
}

return { target: found, particlesBefore: before, spawnedPerShot: spawned };
