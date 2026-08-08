// Frame cost per quality level, under a real combat load.
h.setSetting('dynres', false);
g.player.spawnProtect = 1e9;

const sample = (seconds) => new Promise((resolve) => {
  const rows = [];
  const prev = g.onFrame;
  const start = performance.now();
  g.onFrame = (dt, cpu) => {
    rows.push({ ms: dt * 1000, cpu });
    if (performance.now() - start > seconds * 1000) {
      g.onFrame = prev;
      const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
      const cpu = rows.map((r) => r.cpu).sort((a, b) => a - b);
      resolve({
        frames: rows.length,
        p50: +ms[ms.length >> 1].toFixed(1),
        p95: +ms[Math.floor(ms.length * 0.95)].toFixed(1),
        cpu50: +cpu[cpu.length >> 1].toFixed(1)
      });
    }
  };
});

const out = [];
for (const level of (window.__levels || [1, 3, 4, 6, 8, 10])) {
  h.setSetting('quality', level);
  await h.wait(1.0);
  const s = await sample(2.5);
  out.push({
    level,
    scale: g.quality.renderScale,
    shadow: g.quality.shadowResolution,
    ...s,
    drawCalls: g.frameStats.drawCalls,
    tris: Math.round(g.frameStats.triangles / 1000) + 'k'
  });
}
h.setSetting('quality', 3);
return out;
