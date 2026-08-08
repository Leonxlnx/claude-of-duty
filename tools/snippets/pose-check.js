// What state is the game actually in while the enemy poses are being shot?
const before = { state: g.state, locked: g.input.locked };
window.__poseEnemy = { distance: 3.0, height: 1.05, angle: 0.7 };
const src = window.__poseSrc;
await new Function('g', 'h', `return (async () => { ${src} })();`)(g, h);
await new Promise((r) => setTimeout(r, 2600));
return {
  before,
  after: { state: g.state, locked: g.input.locked, menuVisible: g.menu.visible },
  time: +g.time.toFixed(2),
  playerPos: g.player.controller.position.toArray().map((v) => +v.toFixed(2)),
  enemyPos: g.director.characters[0].position.toArray().map((v) => +v.toFixed(2))
};
