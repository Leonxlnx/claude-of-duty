// Did the world build and is it drawing?
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const y = g.world.groundAt(0.4, z);
h.teleport(0.4, y + 0.1, z);
g.playerTarget.sync();
h.aimAt(0.4, y + 1.55, z - 40);
await h.wait(0.4);

return {
  state: g.state,
  playerPos: g.player.controller.position.toArray().map((v) => +v.toFixed(2)),
  eye: g.player.eye.toArray().map((v) => +v.toFixed(2)),
  groundAt: +y.toFixed(3),
  yaw: +g.player.yaw.toFixed(2),
  pitch: +g.player.pitch.toFixed(2),
  triangles: g.frameStats.triangles,
  drawCalls: g.frameStats.drawCalls,
  worldBatches: g.world.batches?.length ?? null,
  programs: g.renderer.info.programs?.length ?? null,
  glError: g.renderer.getContext().getError()
};
