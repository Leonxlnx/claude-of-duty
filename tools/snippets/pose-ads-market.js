const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const x = 0.4;
const y = g.world.groundAt(x, z) + 0.1;
h.teleport(x, y, z);
g.playerTarget.sync();
h.aimAt(x, y + 1.7, z - 40);
h.ads(true);
// The ADS pose is spring driven, so it needs real frames to settle before the
// shot is taken rather than being sampled mid-raise.
await new Promise((r) => setTimeout(r, 1200));
return { ads: g.player.wantsAds, blend: g.viewModel.adsBlend };
