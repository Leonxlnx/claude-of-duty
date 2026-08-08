// Frame pacing while standing, walking and turning fast, plus what the
// dynamic-resolution controller does during each.
const samples = [];
const record = (label, seconds) => new Promise((resolve) => {
  const start = performance.now();
  const prev = g.onFrame;
  const rows = [];
  g.onFrame = (dt, cpu) => {
    rows.push({ ms: dt * 1000, cpu, scale: g.graph.renderScale });
    if (performance.now() - start > seconds * 1000) {
      g.onFrame = prev;
      const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
      const scales = [...new Set(rows.map((r) => +r.scale.toFixed(2)))];
      samples.push({
        label, frames: rows.length,
        p50: +ms[ms.length >> 1].toFixed(1),
        p95: +ms[Math.floor(ms.length * 0.95)].toFixed(1),
        worst: +ms[ms.length - 1].toFixed(1),
        jitter: +(ms[Math.floor(ms.length * 0.95)] - ms[ms.length >> 1]).toFixed(1),
        renderScales: scales
      });
      resolve();
    }
  };
});

g.player.spawnProtect = 1e9;
h.releaseAll();
await h.wait(0.6);

await record('standing', 3);

h.key('KeyW', true);
await record('walking', 3);

h.key('ShiftLeft', true);
await record('sprinting', 3);
h.releaseAll();

// Fast look, the way a player flicks left and right.
let spin = 0;
const spinTimer = setInterval(() => { spin += 1; h.look(spin % 2 ? 90 : -90, 0); }, 16);
await record('turning-fast', 3);
clearInterval(spinTimer);

return {
  samples,
  dynres: g.graph.dynamicResolution ?? null,
  quality: g.quality?.name ?? null
};
