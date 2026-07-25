const a = g.world.spawns.A[0], b = g.world.spawns.B[0];
const t0 = performance.now();
const out = g.nav.findPath(a.x, a.z, b.x, b.z, []);
const ms = performance.now() - t0;
let longest = 0;
if (out) {
  for (let i = 1; i < out.length; i++) {
    longest = Math.max(longest, Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z));
  }
}
return {
  ms: Math.round(ms * 100) / 100,
  found: !!out,
  points: out ? out.length : 0,
  longestHop: Math.round(longest * 100) / 100,
  straightLine: Math.round(Math.hypot(b.x - a.x, b.z - a.z)),
  nav: g.nav.stats(),
  spawnsA: g.world.spawns.A.length,
  spawnsB: g.world.spawns.B.length
};
