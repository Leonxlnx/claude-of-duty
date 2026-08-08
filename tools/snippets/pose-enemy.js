// Stage one enemy for a close-up and hold it there.
//
// The gauntlet's old "enemy" pose teleported behind whichever agent was
// nearest and aimed at it — by the time the frame settled two seconds later the
// agent had run off and the shot framed an empty street, which is how a critic
// ended up calling the character a featureless mannequin without ever seeing
// one. This freezes the AI outright, plants a chosen agent on a fixed mark in
// the market lane, and drives its rig by hand so the pose is repeatable.
//
// Read the framing from `window.__poseEnemy` (set by the capture tool):
//   { distance, height, angle, stance, aiming, team }

const cfg = Object.assign(
  {
    distance: 3.2, height: 1.05, angle: 0.6, stance: 'stand', aiming: true,
    team: null,
    // Radians to turn the subject away from the lens. Aiming straight down the
    // barrel at the camera foreshortens the carbine into a pipe; a framing that
    // is meant to judge the weapon needs the subject side-on to it.
    faceOffset: 0
  },
  window.__poseEnemy || {}
);

const MARK = { x: -0.5, z: -2 };   // market lane, open sky, sun from the side
const EYE = 1.62;

const enemy = g.director.characters.find(
  (c) => c.alive && (cfg.team ? c.team === cfg.team : c.team !== g.player.team)
) || g.director.characters[0];
const agent = g.director.agents.find((a) => a.character === enemy);

const groundY = g.world.groundAt(MARK.x, MARK.z);
enemy.position.set(MARK.x, groundY, MARK.z);
enemy.velocity.set(0, 0, 0);
if (agent) {
  agent.controller.position.copy(enemy.position);
  agent.controller.velocity.set(0, 0, 0);
}

// The camera sits at `angle` around the mark; the enemy faces the camera so the
// front of the kit is what gets judged.
//
// `angle` is measured from the sun rather than from the world axes, so a
// framing is lit the same way whatever the time of day: 0 puts the sun
// directly behind the lens. Judging kit colours on a backlit subject is how
// you conclude that a palette is monochrome when it is the light that is.
const sun = g.graph.sky.sunDirection;
const sunAzimuth = Math.atan2(sun.x, sun.z);
const angle = sunAzimuth + cfg.angle;
const camX = MARK.x + Math.sin(angle) * cfg.distance;
const camZ = MARK.z + Math.cos(angle) * cfg.distance;
const camY = g.world.groundAt(camX, camZ) + 0.1;
// The rig's forward is (-sin yaw, 0, -cos yaw), so facing the camera is the
// negated delta — with the delta itself the subject turns its back on the lens.
const faceYaw = Math.atan2(-(camX - MARK.x), -(camZ - MARK.z)) + cfg.faceOffset;

const control = { yaw: faceYaw, pitch: -0.05, stance: cfg.stance, aiming: cfg.aiming };

// Let the rig walk into the pose rather than snapping: the arms are sprung and
// a single step leaves the weapon halfway to the shoulder.
for (let i = 0; i < 90; i++) enemy.update(1 / 60, control);

// Everything else stops where it is, and this one keeps being re-posed each
// frame so nothing drifts while the exposure and TAA settle.
g.director.update = () => { enemy.update(1 / 60, control); };

g.player.spawnProtect = 1e9;
h.teleport(camX, camY, camZ);
g.playerTarget.sync();

// Aim from where the camera is about to be, not through `h.aimAt`: that reads
// `player.eye`, which is only rewritten at render time and so still holds the
// position from before the teleport. Aiming off a stale eye is exactly how the
// subject ends up at the edge of the frame or out of it altogether.
const dx = MARK.x - camX;
const dy = (groundY + cfg.height) - (camY + EYE);
const dz = MARK.z - camZ;
g.player.yaw = Math.atan2(-dx, -dz);
g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz) || 1e-6);

// The weapon is not what is being judged, and `Game` re-asserts this every
// frame from `player.alive`, so take the property away from it.
if (!g.viewModel.root.__pinnedHidden) {
  Object.defineProperty(g.viewModel.root, 'visible', {
    get: () => false, set: () => {}, configurable: true
  });
  g.viewModel.root.__pinnedHidden = true;
}

return {
  mark: MARK, team: enemy.team, camera: [+camX.toFixed(2), +camZ.toFixed(2)],
  yaw: +g.player.yaw.toFixed(2), pitch: +g.player.pitch.toFixed(2), stance: cfg.stance
};
