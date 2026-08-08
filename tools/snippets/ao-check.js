// Does the AO buffer actually reach the image?
// Toggling it must change the frame. If it does not, the pass is running and
// being thrown away, which is a binding bug rather than a weak setting.
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const y = g.world.groundAt(0.4, z);
g.hud.setVisible(false);
h.setSetting('dynres', false);
h.teleport(0.4, y + 0.1, z);
g.playerTarget.sync();
h.aimAt(0.4, y + 1.2, z - 12);

const meanOf = async () => {
  await h.wait(2.0);
  const { data } = await h.capture(160, 90);
  let s = 0;
  for (let i = 0; i < data.length; i += 4) {
    s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return s / (data.length / 4);
};

const cp = g.graph.combinePass?.uniforms;
const before = cp?.uAOStrength?.value;

h.setSetting('quality', 8);
const withAO = await meanOf();
if (cp?.uAOStrength) cp.uAOStrength.value = 0;
const withoutAO = await meanOf();
if (cp?.uAOStrength) cp.uAOStrength.value = before;

// And read the AO target directly: a working pass is not all-white.
let aoStats = null;
try {
  g.graph.debugView = 3;   // 'ao'
  await h.wait(1.2);
  const { data } = await h.capture(120, 68);
  let min = 255, max = 0, sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); sum += data[i]; n++; }
  aoStats = { min, max, mean: Math.round(sum / n) };
  g.graph.debugView = 0;
} catch (e) { aoStats = String(e); }

return {
  aoStrengthUniform: before,
  meanWithAO: +withAO.toFixed(2),
  meanWithoutAO: +withoutAO.toFixed(2),
  delta: +(withoutAO - withAO).toFixed(2),
  aoBufferRed: aoStats
};
