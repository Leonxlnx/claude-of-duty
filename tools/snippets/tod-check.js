// How dark does each time of day actually resolve, and what is the meter doing?
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const y = g.world.groundAt(0.4, z);
h.setQuality('ultra');
g.hud.setVisible(false);
h.teleport(0.4, y + 0.1, z);
g.playerTarget.sync();
h.aimAt(0.4, y + 1.55, z - 40);

const out = {};
for (const tod of ['day', 'sunset', 'night']) {
  h.setSetting('timeOfDay', tod);
  await h.wait(2.5);
  const shot = await h.capture(120, 68);
  const px = shot.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  }
  const ex = g.graph.exposurePass.uniforms;
  out[tod] = {
    meanLuma: Math.round(sum / (px.length / 4)),
    sunIntensity: g.graph.sky.sunIntensity,
    uCompensation: +ex.uCompensation.value.toFixed(2),
    uMinEV: +ex.uMinEV.value.toFixed(2),
    // The SH DC term is the ambient the whole district is lit by.
    ambientDC: g.graph.sky.sh[0].toArray().map((v) => +v.toFixed(4))
  };
}
return out;
