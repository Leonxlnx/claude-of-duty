// The market lane shot again, but leaning out, so the two can be compared.
const lane = g.world.map?.marketLane ?? [-18, 18];
const z = (lane[0] + lane[1]) * 0.5;
const x = 0.4;
const y = g.world.groundAt(x, z) + 0.1;
h.teleport(x, y, z);
g.playerTarget.sync();
h.aimAt(x, y + 1.6, z - 30);

h.key('KeyE', true);
await new Promise((r) => setTimeout(r, 1500));
return { z, lane };
