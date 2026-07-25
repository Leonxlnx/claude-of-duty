// Project every part of the weapon into screen space and report how much of
// the frame it covers, so an oversized or misplaced piece shows up as a number
// instead of something to squint at in a screenshot.
g.viewModel.root.updateMatrixWorld(true);
const cam = g.vmCamera;
cam.updateMatrixWorld(true);

const rows = [];
// Borrow a vector class off a live object rather than reaching for the three
// namespace, which the harness deliberately does not expose.
const v = new g.player.eye.constructor();
g.viewModel.root.traverse((o) => {
  if (!o.isMesh || !o.geometry) return;
  o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, anyFront = false;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
    o.localToWorld(v);
    v.project(cam);
    if (v.z < 1) anyFront = true;
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  if (!anyFront) return;
  const w = (Math.min(maxX, 1) - Math.max(minX, -1)) / 2;
  const hh = (Math.min(maxY, 1) - Math.max(minY, -1)) / 2;
  rows.push({
    name: o.name || o.geometry.name || 'mesh',
    tris: o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3,
    screenPct: Math.round(Math.max(0, w) * Math.max(0, hh) * 1000) / 10,
    ndc: [minX, minY, maxX, maxY].map((n) => Math.round(n * 100) / 100)
  });
});

rows.sort((a, b) => b.screenPct - a.screenPct);
return {
  vmFov: cam.fov,
  totalTris: rows.reduce((a, r) => a + r.tris, 0),
  parts: rows.slice(0, 14)
};
