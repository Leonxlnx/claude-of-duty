// What values does a sunlit street actually resolve to?
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const y = g.world.groundAt(0.4, z);
h.setQuality('ultra');
h.setSetting('dynres', false);
g.hud.setVisible(false);
h.teleport(0.4, y + 0.1, z);
g.playerTarget.sync();
h.aimAt(0.4, y + 1.55, z - 40);
await h.wait(1.5);

const shot = await h.capture(160, 90);   // resolves on the next presented frame
const px = shot.data;
const lum = [];
for (let i = 0; i < px.length; i += 4) {
  lum.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
}
lum.sort((a, b) => a - b);
const q = (p) => Math.round(lum[Math.floor(lum.length * p)]);

// The lower-centre of the frame is the sunlit road surface.
let sun = 0, n = 0;
for (let row = 55; row < 75; row++) {
  for (let col = 30; col < 90; col++) {
    const i = (row * 160 + col) * 4;
    sun += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    n++;
  }
}

return {
  sunlitGround: Math.round(sun / n),
  p01: q(0.01), p50: q(0.5), p95: q(0.95), p99: q(0.99),
  max: Math.round(lum[lum.length - 1]),
  belowLum40: +((lum.filter((v) => v < 40).length / lum.length) * 100).toFixed(1)
};
