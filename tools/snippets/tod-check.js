// How bright does each time of day actually resolve?
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const y = g.world.groundAt(0.4, z);
g.hud.setVisible(false);
h.teleport(0.4, y + 0.1, z);
g.playerTarget.sync();
h.aimAt(0.4, y + 1.55, z - 40);

const out = {};
for (const tod of ['dawn', 'morning', 'day', 'sunset', 'night']) {
  h.setSetting('timeOfDay', tod);
  await h.wait(3.0);
  const shot = await h.capture(120, 68);
  const px = shot.data;
  let sum = 0;
  const lum = [];
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l; lum.push(l);
  }
  lum.sort((a, b) => a - b);
  out[tod] = {
    mean: Math.round(sum / lum.length),
    p95: Math.round(lum[Math.floor(lum.length * 0.95)]),
    sun: g.graph.sky.sunIntensity
  };
}
return out;
