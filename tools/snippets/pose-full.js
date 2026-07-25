// Lock the renderer to full resolution on the highest preset so a screenshot
// shows the real fidelity rather than whatever dynamic resolution settled on
// under headless ANGLE.
h.setQuality('ultra');
h.setSetting('dynres', false);
h.setSetting('renderScale', 1);
g.graph.setRenderScale?.(1);
await new Promise((r) => setTimeout(r, 500));
return { scale: g.graph.renderScale, width: g.graph.width, height: g.graph.height };
