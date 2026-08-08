// Where does aimAtEnemy actually point, and is that point reachable?
g.player.spawnProtect = 1e9;
const engaged = h.engageNearestEnemy(9);
h.freezeAI(true);
await h.wait(0.3);

const t = h.nearestEnemy();
if (!t) return { error: 'no enemy' };

const Vec = g.player.eye.constructor;
const joints = t.rig?.joints;
const chest = joints?.[2];
const aimed = h.aimAtEnemy();
await h.wait(0.1);

// Is the line from the eye to the chest clear of world geometry?
const eye = g.player.eye.clone();
const dir = new Vec().subVectors(chest, eye);
const dist = dir.length();
dir.normalize();
const blocked = g.world.bvh.raycast(eye, dir, dist - 0.2);

const hpBefore = t.health;
g.weapon.ammo = g.weapon.spec.magSize;
h.fire(true);
for (let i = 0; i < 10; i++) { await h.wait(0.06); h.aimAtEnemy(); }
h.fire(false);
await h.wait(0.3);

return {
  engaged, aimed,
  hasRig: !!joints, jointCount: joints?.length ?? 0,
  root: t.position.toArray().map((v) => +v.toFixed(2)),
  chest: chest ? chest.toArray().map((v) => +v.toFixed(2)) : null,
  eye: eye.toArray().map((v) => +v.toFixed(2)),
  distToChest: +dist.toFixed(2),
  lineBlocked: blocked.hit ? +blocked.t.toFixed(2) : false,
  shotsFired: g.combat.shotsFired,
  healthBefore: +hpBefore.toFixed(1),
  healthAfter: +t.health.toFixed(1),
  alive: t.alive
};
