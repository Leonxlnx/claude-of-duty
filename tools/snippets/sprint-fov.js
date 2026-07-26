// Sprint should widen the world camera and hand it back, and aiming must
// still win outright over any sprint widening left in flight.
const read = () => ({ world: +g.camera.fov.toFixed(2), vm: +g.vmCamera.fov.toFixed(2) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

h.releaseAll();
await wait(800);
const idle = read();

h.key('KeyW', true);
h.key('ShiftLeft', true);
await wait(1500);
const sprinting = { ...read(), isSprinting: g.player.sprinting, speed: +g.player.speed2D.toFixed(2) };

h.releaseAll();
await wait(1200);
const settled = read();

h.key('KeyW', true);
h.key('ShiftLeft', true);
await wait(900);
h.ads(true);
await wait(1200);
const aiming = { ...read(), adsBlend: +g.player.adsBlend.toFixed(2) };
h.releaseAll();

return { idle, sprinting, settled, aiming };
