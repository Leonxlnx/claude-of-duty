// Every quality level: does it apply, and what does it cost?
h.setSetting('dynres', false);
const out = [];
for (let level = 1; level <= 10; level++) {
  h.setSetting('quality', level);
  await h.wait(0.8);
  const g2 = g.graph;
  out.push({
    level,
    presetScale: g.quality.renderScale,
    graphScale: +g2.renderScale.toFixed(2),
    targetPx: `${g2.width ?? '?'}x${g2.height ?? '?'}`,
    shadowRes: g.quality.shadowResolution,
    cascades: g2.shadows.cascadeCount,
    sharpen: +g2.compositePass.uniforms.uSharpen.value.toFixed(2),
    motionBlur: g.quality.motionBlur
  });
}
h.setSetting('quality', 3);
return out;
