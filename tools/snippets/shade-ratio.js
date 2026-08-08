// Sun-to-shade contrast on the same ground material.
//
// Real midday sun to open shade is 5-8:1 in linear. Post-tonemap on identical
// albedo it should still read around 3:1; anything near 1.5:1 means the frame
// has no sunlight in it, whatever the sky looks like.
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const y = g.world.groundAt(0.4, z);
g.hud.setVisible(false);
h.setSetting('dynres', false);
h.teleport(0.4, y + 0.1, z);
g.playerTarget.sync();
h.aimAt(0.4, y + 1.55, z - 40);
await h.wait(2.5);

const shot = await h.capture(160, 90);
const px = shot.data;
const lum = [];
for (let i = 0; i < px.length; i += 4) {
  lum.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
}
// Ground only: the lower half of the frame is street, sunlit and shadowed.
const ground = [];
for (let row = 50; row < 88; row++) {
  for (let col = 0; col < 160; col++) {
    const i = (row * 160 + col) * 4;
    ground.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
  }
}
ground.sort((a, b) => a - b);
const q = (arr, p) => arr[Math.floor(arr.length * p)];

// Linearised, because a ratio of sRGB values understates the real one.
const lin = (v) => Math.pow(v / 255, 2.2);
const shade = q(ground, 0.15);
const sun = q(ground, 0.90);

return {
  groundShade: Math.round(shade),
  groundSun: Math.round(sun),
  ratioSRGB: +(sun / Math.max(shade, 1)).toFixed(2),
  ratioLinear: +(lin(sun) / Math.max(lin(shade), 1e-4)).toFixed(2),
  frameP01: Math.round(q(lum.slice().sort((a, b) => a - b), 0.01)),
  frameMean: Math.round(lum.reduce((a, b) => a + b, 0) / lum.length)
};
