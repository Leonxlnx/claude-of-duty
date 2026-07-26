// Wrap the big per-frame systems and find which one eats the frame when the
// player starts moving. Times are milliseconds per rendered frame.
const p = g.player;
const marks = {};
const wrap = (obj, name, label) => {
  if (!obj || typeof obj[name] !== 'function' || obj[`__orig_${name}`]) return;
  const orig = obj[name].bind(obj);
  obj[`__orig_${name}`] = orig;
  marks[label] = 0;
  obj[name] = (...a) => {
    const t = performance.now();
    const r = orig(...a);
    marks[label] += performance.now() - t;
    return r;
  };
};

wrap(g.director, 'update', 'director');
wrap(g.combat, 'update', 'combat');
wrap(g.graph, 'render', 'render');
wrap(g.world, 'update', 'world');
wrap(g.nav, 'findPath', 'nav.findPath');
wrap(g.nav, 'findCover', 'nav.findCover');
wrap(g.player, 'update', 'player');
wrap(g.viewModel, 'update', 'viewmodel');

const sample = async (label, ms, keys) => {
  for (const k of Object.keys(marks)) marks[k] = 0;
  let frames = 0;
  const prev = g.onFrame;
  g.onFrame = () => { frames++; };
  for (const k of keys) h.key(k, true);
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  const wall = performance.now() - t0;
  g.onFrame = prev;
  h.releaseAll();
  const out = { label, wallMs: Math.round(wall), frames, fps: +(frames / (wall / 1000)).toFixed(1) };
  for (const [k, v] of Object.entries(marks)) out[k] = +(v / Math.max(frames, 1)).toFixed(2);
  out.pathCalls = g.nav.__calls ?? undefined;
  return out;
};

h.releaseAll();
await new Promise((r) => setTimeout(r, 800));

const idle = await sample('idle', 1500, []);
await new Promise((r) => setTimeout(r, 500));
const running = await sample('running', 3000, ['KeyW', 'ShiftLeft']);

return { idle, running };
