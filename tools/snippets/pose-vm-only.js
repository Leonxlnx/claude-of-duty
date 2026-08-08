// Photograph the viewmodel alone: world hidden, weapon mid-inspect so the
// whole model including whatever hangs off the bottom of the frame swings up
// into view.
h.setQuality('ultra');
g.graph.setRenderScale?.(1);
g.player.spawnProtect = 1e9;
g.world.scene.visible = false;
g.player.pitch = 0.35;
await h.tap('KeyF');
await new Promise((r) => setTimeout(r, 900));
return { inspecting: true };
