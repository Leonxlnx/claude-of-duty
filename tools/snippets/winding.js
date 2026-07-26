// Signed volume of a closed mesh is positive when its triangles wind
// counter-clockwise seen from outside, which is what GL treats as front facing.
// Negative means the mesh is inside out and every visible face is being culled.
const report = [];
const check = (root, label) => {
  root.traverse((o) => {
    const geo = o.geometry;
    if (!geo || !geo.attributes.position || !geo.index) return;
    const p = geo.attributes.position.array;
    const nrm = geo.attributes.normal.array;
    const idx = geo.index.array;
    let vol = 0, agree = 0, disagree = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      vol += (
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
      ) / 6;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const d = (e1[1] * e2[2] - e1[2] * e2[1]) * nrm[a]
        + (e1[2] * e2[0] - e1[0] * e2[2]) * nrm[a + 1]
        + (e1[0] * e2[1] - e1[1] * e2[0]) * nrm[a + 2];
      if (d > 0) agree++; else if (d < 0) disagree++;
    }
    report.push({
      mesh: `${label}:${geo.name || o.name || '?'}`,
      tris: idx.length / 3,
      volume: Math.round(vol),
      normalsMatchWinding: `${agree}/${agree + disagree}`
    });
  });
};
check(g.world.scene, 'world');
check(g.viewModel.root, 'vm');
const seen = new Set();
return report.filter((r) => r.tris > 0 && !seen.has(r.mesh) && seen.add(r.mesh));
