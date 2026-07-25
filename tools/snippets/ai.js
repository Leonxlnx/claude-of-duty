const h = window.__harness;
h.start();
await new Promise((r) => setTimeout(r, 1500));
h.engageNearestEnemy(11);
await new Promise((r) => setTimeout(r, 5000));

const d = g.director;
const near = d.agents
  .filter((a) => a.alive)
  .map((a) => ({
    team: a.team,
    state: a.state,
    dist: Math.round(a.controller.position.distanceTo(g.player.eye)),
    hasTarget: !!a.target,
    shots: a.shotsFired,
    aware: Math.round((a.awareness ?? 0) * 100) / 100,
    path: a.path ? a.path.length : -1
  }))
  .sort((x, y) => x.dist - y.dist)
  .slice(0, 6);

return {
  playerTeam: g.player.team,
  playerAlive: g.player.alive,
  playerHealth: Math.round(g.player.health),
  playerTargetTeam: g.playerTarget?.team,
  playerTargetAlive: g.playerTarget?.alive,
  registered: d.characters.length,
  near
};
