const t = g.bootTimings ?? [];
return {
  totalMs: t.reduce((a, s) => a + s.ms, 0),
  stages: [...t].sort((a, b) => b.ms - a.ms)
};
