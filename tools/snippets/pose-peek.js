// Stand at a building corner and peek round it, for screenshots.
const g = window.__game;
const p = g.player;
const Vec = p.eye.constructor;

g.settings?.set?.('quality', 'ultra');
g.menu?.onSettingChanged?.('quality');

// Find a spot with open ground on the left and a wall on the right.
const dir = new Vec();
outer:
for (let tries = 0; tries < 60; tries++) {
  const spot = g.nav.randomPoint(g.rng, new Vec());
  if (!spot) continue;
  for (let a = 0; a < 32; a++) {
    const ang = (a / 32) * Math.PI * 2;
    dir.set(Math.sin(ang), 0, Math.cos(ang));
    const eye = new Vec(spot.x, spot.y + p.eyeHeight, spot.z);
    const hit = g.world.bvh.raycast(eye, dir, 3.5);
    if (!hit.hit || hit.t < 1.0 || hit.t > 2.2) continue;
    // opposite side must be open, so the peek has somewhere to go
    const back = new Vec(-dir.x, 0, -dir.z);
    const openSide = g.world.bvh.raycast(eye, back, 6);
    if (openSide.hit) continue;
    p.controller.position.copy(spot);
    p.controller.position.y += 0.1;
    p.controller.position.x += dir.x * (hit.t - 0.55);
    p.controller.position.z += dir.z * (hit.t - 0.55);
    p.yaw = Math.atan2(-dir.x, -dir.z) + Math.PI / 2; // wall off the right shoulder
    p.pitch = 0;
    break outer;
  }
}

window.__harness.key('KeyE', true);
await new Promise((r) => setTimeout(r, 1400));
