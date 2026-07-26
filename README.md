# Dust Corridor

A browser-native first-person tactical shooter. One map, one match, no server:
a team deathmatch fought through a sunlit North African market district against
procedurally animated AI.

Everything you see is generated at runtime. There is no `.glb`, no `.hdr`, no
`.png`, and no `.wav` anywhere in the repository. The map, its materials, the
sky, the weapon, the soldiers, and every sound in the game are produced by code
when the page loads.

```bash
npm install
npm run dev            # http://localhost:5173
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build on port 4319 |
| `npm run test:install` | One-time Playwright browser download |
| `npm test` | Full Playwright suite against the production build |
| `npm run profile` | Performance specs only, prints a frame-time report |

`npm test` builds and previews the app itself, so it needs no server running.
It writes `test-results/performance.json` with frame-time percentiles.

## Controls

`W A S D` move · `Shift` sprint · `Ctrl` crouch · `Space` jump ·
`Q` / `E` peek left and right · **Left mouse** fire · **Right mouse** aim ·
`R` reload · `B` fire mode · `F` inspect · `Tab` scoreboard · `Esc` pause ·
`` ` `` cycle render debug views.

Peeking slides the head — and with it the muzzle — off the body so you can
clear a corner without walking your hitbox into the open. It stops short of
whatever you lean into, so you cannot peek, or shoot, through a wall.

Dying redeploys you somewhere else entirely: candidate positions are drawn
from the whole navmesh and scored on enemy distance and line of sight, so no
two lives start in the same doorway. `Space` skips the remaining wait.

All bindings are remappable in Settings.

## Constraints this build holds to

- `three@0.180.0` is the only runtime dependency. Nothing else ships.
- No engine, no physics library, no animation middleware, no UI framework.
- No `EffectComposer`; the frame is scheduled by hand.
- No audio files. Every sound is synthesised through the Web Audio API.
- No network requests after load. `dist/` is three files and runs from `file://`.

The last two are enforced by tests, not by convention — see
`tests/gameplay.spec.js`.

## How it is put together

### Rendering — `src/render`

A hand-scheduled WebGL2 frame:

1. **Cascaded shadow maps**, four cascades, fitted to the view frustum, plus a
   separate tight cascade for the viewmodel so the weapon self-shadows.
2. **Fused MRT pass** writing direct light, ambient light, packed
   normal/roughness, and screen-space velocity in one geometry pass.
3. **Sky and ray-marched clouds** fill wherever nothing was drawn, at half
   resolution, and the same sky function is projected into an SH9 probe for
   ambient. Cloud shadows drift across the ground from the same field.
4. **GTAO**, then decals and particles.
5. **TAA** with velocity reprojection and neighbourhood clamping.
6. **Tile-dilated motion blur**, a **Karis bloom pyramid**, GPU **exposure
   metering** with adaptation, a procedural **3D grading LUT**, and an **AgX**
   composite.

`` ` `` cycles nine debug views — normals, velocity, AO, depth, the direct and
ambient buffers, bloom, cascade splits — which is how most of the lighting in
this build was calibrated.

### Materials — `src/world/MaterialLibrary.js`

Twenty surfaces are generated into three `sampler2DArray` textures (albedo,
normal, ORM) by a fragment shader at load, each authored tileable. Plaster and
concrete carry relief all the way down to sand aggregate, because a wall whose
normal map is flat reads as painted cardboard the moment the sun hits it.

The world shader samples them through **stochastic tiling** on a triangle
lattice: every cell gets its own random UV offset, which destroys the
periodicity, and the barycentric weight of each cell falls to zero on the
opposite edge, so a sample always fades out before its own offset jumps.
Weights are then sharpened so most pixels stay dominated by one tile — a flat
three-way blend averages away the contrast the texture was authored with.
Without any of this, a single tile stretched across a twenty metre facade
reads as wallpaper; with a lattice that does not fade correctly it reads as
hard rectangular patches, which is worse.

On top of that the shader adds world-space macro variation, dust that settles
on up-facing surfaces, and wear that darkens edges.

### Physics — `src/physics`

- **SAH BVH** over the merged static world, built once at load.
- **Swept-capsule character controller** with step-up, ground snapping, slope
  limits, and a depenetration pass.
- **Sequential-impulse rigid bodies** for shell casings and dropped magazines.
- **Position-based ragdolls** that blend out of the animated pose on death.

### AI — `src/ai`

A walkability grid is baked by testing the agent's actual standing volume
against the BVH at every cell, then reduced to its largest connected region so
nobody spawns on an island. A\* over that grid, string-pulled and resampled into
short legs the steering can react to.

Agents run a state machine over patrol, advance, flank, engage, suppress, seek
cover, reload and investigate, driven by vision cones with an awareness ramp,
sound propagation from gunfire, and a cover map scored for firing positions.

### Audio — `src/audio/AudioEngine.js`

Gunshots are a noise burst through a resonant body filter with a mechanical
transient, tails convolved against a synthesised impulse response whose length
tracks how enclosed the shooter is. Impacts are per-material. Footsteps, cloth,
handling, and UI are all synthesised. Everything is positioned with
`PannerNode` and occlusion-tested against the BVH.

### Weapon — `src/weapons`

The carbine is built from primitives with real landmarks: bore line, ejection
port, sight window, muzzle. It is animated by springs rather than clips —
sway, bob, inertia, ADS, recoil, reload, inspect — so it responds to input
instead of playing at you.

The red dot is genuinely collimated. The shader measures the angle between the
eye ray through each fragment and the sight's optical axis, so the dot sits
where the gun points regardless of where your eye is behind the glass, and
drifts across the window exactly like the real thing.

The weapon is lit by its own rig: the sun keeps a floor on it and a soft fill
comes from over the player's shoulder, both scaled by the sky so they track the
scene. This is a deliberate cheat. A dark receiver carried through a shaded
alley is physically almost black against a sunlit street, which is correct and
completely unreadable, and no player's eye does that with an object 40cm from
their face.

## Testing

`tests/` covers four areas, all against the production build:

- **smoke** — boot, menu, world bake, match lifecycle, a non-blank frame.
- **gameplay** — movement, collision, gunplay, damage, kills, killfeed,
  ragdolls, respawn, AI acquisition and pathfinding, audio and offline
  integrity.
- **visual** — exposure range, sky colour, shadow presence, TAA convergence,
  viewmodel framing, sight alignment. Property assertions, not golden images:
  a temporally accumulated procedural renderer will never match byte for byte.
- **performance** — frame pacing under combat load, quality presets scaling the
  work they configure, dynamic resolution recovering the budget, and GPU
  resources staying flat through a long fight.

Frames are read back inside the render loop rather than by screenshotting the
canvas — the game does not pay for `preserveDrawingBuffer`, so a 2D copy of the
canvas comes back black.

`window.__harness` (`src/core/Harness.js`) is the seam the suite drives: it
injects input, teleports and aims the player, snapshots state, and profiles
frames. It is installed at boot and referenced by nothing in the game itself.

## Performance

Targets 60 fps at 1080p on a mid-range discrete GPU. Four quality presets
scale render scale, shadow resolution and cascade count, AO samples, cloud
march steps, particle density, decal budget and rigid-body cap. Dynamic
resolution holds the frame budget when a fight gets busy.

The numbers `npm test` prints come from headless Chromium on ANGLE, which is
several times slower than real hardware — read them for stability and for the
relative cost of the presets, not as absolute frame rates.

## Layout

```
src/
  ai/         navigation grid, A*, agents, director
  audio/      procedural Web Audio engine
  combat/     ballistics, penetration, impacts, tracers
  core/       loop, input, settings, seeded RNG, springs, test harness
  fx/         particles, decals, instanced batches
  game/       game orchestration, player, characters, rig, match
  physics/    BVH, character controller, rigid bodies, ragdolls
  render/     render graph, shadows, sky, shaders, grading
  ui/         HUD, menus, loading
  weapons/    weapon logic, viewmodel, procedural geometry
  world/      map generator, buildings, props, materials, cloth
tests/        Playwright specs
tools/        screenshot, probe and poke utilities for development
```

`tools/shot.mjs` takes a screenshot of the dev server, optionally after running
a setup snippet in the page — `node tools/shot.mjs out.png "?auto=1" 4000 ""
tools/snippets/pose-ads.js`. `tools/poke.mjs` evaluates a snippet against a
booted game and prints the result. Both were how the visuals in this build were
iterated on.
