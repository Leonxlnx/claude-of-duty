# Browser-Native Three.js Tactical FPS

You are a senior real-time graphics engineer, gameplay programmer, technical artist, physics programmer, AI programmer, and procedural-audio designer. Build a **finished, highly polished browser-native first-person tactical shooter**, not a blockout, not a visual mockup, and not a shallow tech demo.

The attached reference video is the primary visual and gameplay target. Match its overall fidelity, framing, pace, weapon presence, lighting, dense urban environment, readable combat feedback, and cinematic post-processing, then improve the weak areas. The result must feel like a compact premium PC FPS somehow running directly in the browser.

Use original or properly licensed visual assets only. Match the reference’s quality and art direction without copying proprietary logos, branded UI, characters, or map geometry.

## 1. Non-negotiable technical constraints

- Runtime: **Three.js r180 / v0.180.0 on WebGL2**.
- Build tooling: **Vite 7**.
- Automated visual and performance checks: **Playwright**.
- `three` must be the **only runtime dependency**.
- No game engine.
- No physics library such as Rapier, Ammo, Cannon, Oimo, Havok, or Jolt.
- No animation middleware.
- No audio files, music files, sampled gunshots, sampled footsteps, or downloaded impulse responses.
- Do not use Three.js `examples/jsm/postprocessing` or `EffectComposer`. The post-processing pipeline must be custom.
- No React, Vue, Svelte, UI framework, ECS framework, or external state library. Use TypeScript or modern JavaScript plus DOM/CSS for menus and HUD.
- No runtime network requests. The production build must run offline after loading.
- Final deployment must be effectively self-contained: `index.html` plus one bundled JavaScript payload. Original meshes, texture data, shaders, worklet code, and generated resources may be embedded into the bundle or generated at startup.
- The game must launch reliably with `npm install && npm run dev`, build with `npm run build`, and expose a Playwright test/profiling command.

## 2. Finished experience to build

Create a complete offline **team-deathmatch-style FPS match** on one exceptionally detailed map. Keep the scope focused and make every part feel finished.

Core match:

- Player team versus AI-controlled enemy team.
- Suggested setup: 4v4 or 5v5, ten-minute match, first team to 30 eliminations.
- Immediate spawn into a sunlit dense urban combat district.
- Player begins with a detailed modern carbine, 30-round magazine, reserve ammunition, one tactical throwable, and one explosive throwable represented as fictional game items.
- Controls: walk, sprint, crouch, jump, short mantle, aim down sights, fire, reload, weapon inspect, throw item, pause, and respawn.
- Mouse input must feel raw and responsive under Pointer Lock. Add configurable sensitivity, FOV, ADS multiplier, invert-Y, and keybinds.
- Movement should be fast and responsive but grounded, with acceleration, deceleration, slope response, step handling, crouch transitions, landing compression, and subtle camera inertia.
- Combat must support body hits, limb hits, headshots, armor-neutral fictional damage values, hit markers, directional damage feedback, kill confirmation, score updates, death, ragdoll, and respawn.
- No gore, dismemberment, or graphic injury. Keep reactions impactful but clean and game-like.
- Include a start screen, compact settings panel, pause menu, loading/progress state, match-end screen, and restart option. These must look like part of the game, not a default web page.

## 3. Exact visual target and map art direction

The map should read instantly like the reference: a bright, war-worn North African or eastern Mediterranean market district under hard midday sunlight. It must feel hand-authored even if generated procedurally.

### Map structure

Build one compact map approximately 120–180 meters across with strong FPS flow:

- A long central market street that creates the same powerful forward sightline shown in the reference.
- Two narrower side alleys for flanking.
- A partially covered market lane with stalls, awnings, tables, crates, and sandbag positions.
- A broken courtyard or small plaza near a monumental concrete or stone archway.
- Several shallow building interiors and window cut-throughs.
- A few accessible balconies or low rooftop positions, but do not turn the map into vertical chaos.
- Readable spawn zones with multiple safe exits.
- Alternating long-range, medium-range, and close-range engagement spaces.
- Strong cover rhythm: low walls, concrete road barriers, carts, vehicles, sandbags, barrels, door frames, and building corners.
- No empty open field and no maze of identical corridors.

Use a fixed world seed for consistent benchmarking. Micro-detail placement, ambient particles, small debris motion, audio variation, and cosmetic prop variants may use deterministic seeded variation.

### Buildings

Every building must have believable construction and layered detail:

- Two- and three-story concrete, plaster, brick, and stucco structures with flat roofs and parapets.
- Sun-faded beige, chalky gray, dusty blue, pale peach, muted terracotta, and off-white facades.
- Worn plaster, exposed concrete, patched walls, cracks, chipped corners, discoloration, grime beneath windows, bullet marks, and repairs.
- Recessed doors, barred windows, metal shutters, wooden shutters, rough window frames, balconies, railings, drain pipes, small ledges, and roof access structures.
- Window air-conditioning units, satellite dishes, wall conduits, utility boxes, exterior lamps, vents, antennas, and water tanks.
- Sagging power and communication cables crossing streets between buildings.
- Laundry lines, cloth pieces, small flags or unbranded fabric, hanging rugs, and awnings that respond subtly to wind.
- A mix of open, dark, partially blocked, boarded, and reflective windows. Avoid repeating the same window pattern.
- Simple but convincing interior shells visible through openings: dark rooms, tiled walls, shelves, stairs, curtains, and bounce-lit dust.

Build a procedural facade grammar or modular assembly system so buildings are not identical. Use deterministic variation in widths, heights, window spacing, balcony presence, AC units, damage, color, roof clutter, and grime masks.

### Street and prop density

The ground must never feel sterile. Include hundreds of placed or instanced details:

- Broken asphalt, dust, sand accumulation, patched road sections, curbs, drain channels, cracked concrete, scattered pebbles, and small weeds.
- Concrete Jersey barriers, improvised concrete blocks, sandbag walls, wooden barricades, and metal fencing.
- Market stalls with rough timber or metal frames, fabric roofs, empty trays, baskets, boxes, sacks, pottery, and unbranded produce-like shapes.
- Wooden pallets, crates, plastic containers, metal drums, propane-style cylinders, tires, loose boards, rubble piles, bricks, paper, cloth, cans, and discarded household objects.
- Parked utility vehicles, small pickups, carts, and damaged street furniture. Vehicles can be static but must look integrated into the world.
- Palm trees, dry shrubs, balcony plants, wall vines, and scattered hardy vegetation.
- No obvious repeated prop rows. Vary rotation, scale, wear, material tint, and grouping using the fixed seed.
- Use instancing and texture atlases where sensible, but preserve enough individual variation to avoid a cloned look.

### Environmental motion

The world cannot be frozen:

- Cloth awnings and hanging fabric move with layered low-frequency wind.
- Overhead cables sway almost imperceptibly.
- Dust motes drift through bright shafts and shadowed interiors.
- Lightweight paper and leaves occasionally skitter across the road using simple physical impulses.
- Plants and palm fronds respond to wind.
- Muzzle pressure and nearby impacts may disturb dust and light debris.
- Distant heat haze should subtly distort geometry near sunlit ground.

## 4. Sky, atmosphere, lighting, and shadows

The sky is a major visual feature. Do not use a flat blue clear color or a low-resolution static skybox.

- Implement a procedural physical atmosphere with a bright sun disk, horizon haze, aerial perspective, and believable Rayleigh/Mie-style color behavior.
- Create large, soft, detailed cumulus cloud layers like the reference: bright white sunlit tops, soft gray interiors, varied scale, and slow movement.
- Clouds need parallax and depth. Use ray-marched volumetric clouds, layered procedural density volumes, or another convincing shader approach that remains performant.
- Generate a low-frequency cloud-shadow field that moves slowly over the map and subtly changes exterior lighting.
- Set the scene in late morning or midday: strong directional sun, crisp but naturally softened shadows, bright sky fill, and deep readable shade beneath awnings and balconies.
- Generate environment lighting or spherical-harmonic sky irradiance from the procedural sky rather than using a downloaded HDRI.
- Add distance haze and localized dust without washing out the entire image.
- Maintain realistic exposure transitions when moving between open sunlight and shaded interiors.
- Avoid orange cinematic grading, excessive fog, crushed blacks, blown-out white walls, and fake lens flare spam.

## 5. Materials and geometry quality

Use physically based materials with carefully controlled roughness and normal response.

- Surfaces need separate macro, meso, and micro scales: large color variation, medium cracks/stains, and fine roughness/normal detail.
- Generate or embed original texture atlases for plaster, concrete, brick, metal, wood, cloth, road, glass, sandbags, and weapon materials.
- Add triplanar or world-space detail where needed to prevent obvious UV stretching.
- Blend edge wear, dust accumulation, water streaks, grime, and impact decals through masks rather than baking every variation into geometry.
- Glass should have subtle reflections, dirt, and interior darkness without becoming mirror-like.
- Metals need correct roughness differences: painted steel, bare worn edges, anodized weapon parts, dull barrels, and oxidized fixtures.
- Avoid low-poly silhouettes on foreground props and the weapon. Use LODs for distant geometry.
- Use bevels or bevel-like normal treatment on hard edges so lighting catches geometry convincingly.

## 6. First-person weapon and hands

The first-person weapon is always visible and must be one of the most polished elements.

Create an original modern M4-style carbine with:

- A detailed receiver, handguard, top rail, barrel, flash hider, magazine well, trigger guard, charging handle, controls, screws, seams, optic mount, and compact tube-style red-dot optic.
- Distinct anodized metal, parkerized steel, polymer, rubber, glass, and lightly worn edge materials.
- Small believable wear on high-contact edges, fingerprints or smudging on the optic, and fine roughness variation.
- A modeled magazine with visible rounds only where appropriate during reload, but no unnecessary internal simulation.
- Original tactical gloves and sleeves with folds, stitching, reinforced knuckles, and correct hand contact on the grip and fore-end.
- No floating hands, intersecting fingers, disconnected wrists, or weapon clipping through walls.

### Viewmodel rendering

- Use a dedicated viewmodel layer or camera with a carefully chosen viewmodel FOV while preserving world-space lighting.
- The weapon must receive sunlight, sky fill, muzzle-flash light, self-shadowing, and environmental color.
- Prevent near-plane clipping and ugly intersection while still letting the weapon react when pressed close to walls.
- Provide velocity data for weapon motion so TAA and motion blur handle it correctly.
- Use a reactive mask around muzzle flash, smoke, optic reticle, and fast-moving parts to prevent ghost trails.

### Procedural weapon animation

Do not rely on Three.js animation clips as the primary system. Build procedural, spring-driven layers:

- Idle breathing with subtle hand and weapon movement.
- Walk and sprint bob with footstep-synchronized vertical, lateral, and roll components.
- Inertial weapon lag when turning or changing movement direction.
- Aim-down-sights transition with precise optic alignment and no snapping.
- Recoil impulse, camera kick, weapon rotation, rearward translation, hand compression, and smooth recovery.
- Recoil should accumulate during automatic fire but never become a perfectly repeating animation.
- Short FOV kick and camera impulse on firing, kept tasteful.
- Sprint pose, landing compression, jump inertia, crouch transition, and wall-proximity lowering.
- Tactical reload when rounds remain and an empty reload with the appropriate bolt/charging action.
- Magazine release, magazine extraction, new magazine insertion, hand repositioning, bolt action, and mechanical settle.
- Inspect animation that reveals the weapon detail without blocking gameplay.

### Optic

The optic must not be a red dot painted onto a texture:

- Render a true collimated red-dot-style reticle that remains visually aligned with the target as the eye moves.
- Include lens tint, subtle internal reflections, edge occlusion, parallax behavior, and brightness adaptation.
- ADS must reduce weapon sway and align the sight naturally while preserving slight breathing movement.

## 7. Gunplay and combat feedback

Make shooting feel more powerful and precise than the reference while remaining readable.

### Weapon behavior

- Full-auto and semi-auto modes.
- Immediate, low-latency trigger response.
- Deterministic base recoil pattern with subtle seeded variance, movement penalties, and recovery.
- Tight first-shot accuracy, increasing dispersion during sustained fire, and improved stability while crouched or ADS.
- Use fast projectile traces or a hybrid hitscan/ballistic representation suitable for the map scale.
- Perform collision against the static BVH and dynamic rigid bodies.
- Support material-based penetration through thin wood, sheet metal, and damaged plaster, with rapidly reduced damage and altered impact effects. Keep values fictional and game-oriented.
- Support shallow-angle ricochet from hard surfaces when visually appropriate.
- Add occasional visible tracers rather than tracing every shot.

### Firing visuals

Every shot should create a layered event:

- Very short white-hot muzzle core.
- Orange flame lobes with randomized shape.
- Fast expanding hot-gas distortion.
- Small dynamic point light that illuminates the weapon, hands, nearby walls, smoke, and props.
- Brief barrel smoke and a longer thin smoke trail during sustained fire.
- Bolt movement and ejected casing timed to the shot.
- Physically simulated casings with spin, bounce, surface-dependent pings, sleeping, and a strict lifetime/pool cap.
- Subtle weapon heat buildup after sustained fire, affecting smoke frequency and slight barrel shimmer.

### Bullet impacts

Use surface-specific impact systems:

- Concrete and plaster: pale dust puff, small chips, dark center mark, and short-lived fragments.
- Brick: reddish dust and fragments.
- Metal: sparks, sharp flash, ringing sound, and possible ricochet streak.
- Wood: splinters and dry dust.
- Glass: cracks or small break regions where supported, shards kept non-graphic and performance-capped.
- Fabric and sandbags: soft fibers or dust with muted impact.
- Dirt: granular spray and darker disturbed patch.
- Add persistent bullet decals with pooling and distance-based fading. Avoid hundreds of unbounded objects.

### Hit and kill feedback

- Small central crosshair while hip-firing.
- Compact hit marker with different feedback for normal hit, armor-like reduced hit if used, headshot, and elimination.
- Directional damage arc around the reticle.
- Centered kill banner similar in hierarchy to the reference: `ENEMY ELIMINATED`, XP beneath it, and `HEADSHOT` when appropriate.
- Small top-right kill feed with team colors and simple weapon icons.
- Keep all UI original and avoid copying exact typography or symbols from an existing game.

## 8. Player health and screen response

- Health begins at 100.
- Damage briefly shifts exposure, adds a directional red edge flash, adds camera impulse, and attenuates high-frequency audio.
- At critical health, progressively desaturate the scene, darken and redden the edges, narrow perceived focus, and increase breathing/heartbeat-style synthesized audio. Keep the center readable.
- Do not leave the player functional at zero health. At zero, transition cleanly into a short non-graphic death view or camera fall, activate ragdoll, then respawn after a brief delay.
- Optional delayed health regeneration may begin after several seconds without damage, clearly communicated through HUD recovery.
- Motion blur, chromatic separation, vignette, and camera shake must be subtle and individually adjustable or disableable.

## 9. Enemies, procedural animation, and AI

Enemy bots must feel like combatants, not moving targets.

### Character presentation

- Original modern tactical character silhouettes with layered clothing, vest, pouches, gloves, boots, helmet or headgear variants, and an original carbine.
- Use several cosmetic variants with different muted colors and gear combinations.
- Clear team readability through restrained arm bands, gear accents, silhouette, and HUD markers rather than neon full-body colors.
- Characters cast and receive high-quality shadows and use LODs at distance.

### Procedural animation system

Build animation on top of a custom character rig rather than relying only on canned clips:

- Procedural stride cycle driven by velocity and grounded state.
- Foot locking and foot IK on uneven ground.
- Pelvis compensation and slope alignment.
- Upper-body aim IK toward the target.
- Hand IK to keep the weapon grip stable.
- Leaning, crouching, corner peeking, sprinting, stopping, turning in place, recoil, reload, and hit flinch layers.
- Blend from active animation into a PBD ragdoll on death, preserving momentum and impact direction.
- Keep reactions physical but non-graphic.

### Navigation and tactical AI

Write the navigation and behavior systems in-house:

- Generate a walkable nav representation from level geometry or author a lightweight custom navmesh/grid.
- Use A* or equivalent pathfinding plus local steering and collision avoidance.
- Precompute or generate cover candidates from map geometry.
- Score cover based on distance, line of sight, exposure, target angle, ally occupancy, escape routes, and recent danger.
- Vision uses field of view, distance, contrast/time-to-detect approximation, and BVH line-of-sight raycasts.
- Hearing consumes gameplay sound events. Loud unsuppressed shots, close impacts, footsteps, and thrown items produce investigate locations with uncertainty.
- Bots should patrol, move to contact, investigate, take cover, peek, fire controlled bursts, suppress, flank, reposition, push weakened targets, retreat from exposed positions, and search after losing sight.
- Teammates share approximate enemy positions with a delay rather than perfect instantaneous knowledge.
- Bots must not track the player through walls.
- Add believable reaction time, aim acquisition, target-leading error, recoil, burst timing, and stress. Difficulty should change reaction, planning, and accuracy without turning bots into aimbots.
- Prevent spawn camping through spawn scoring, line-of-sight tests, minimum enemy distance, and alternate exits.
- Use a director to keep encounters active without spawning enemies directly in view.

## 10. Physics written from scratch

Use a fixed physics time step, recommended 120 Hz, with render interpolation.

### Static collision

- Merge or reference the level’s collision triangle soup.
- Build a binned surface-area-heuristic BVH.
- Support fast raycasts, segment casts, sphere casts, capsule sweeps, closest-point queries, and overlap queries.
- Use this same BVH for player movement, bullets, AI visibility, audio occlusion, and environmental probing.

### Character controller

Implement a robust swept-capsule controller:

- Continuous sweep and slide against triangles.
- Stable depenetration.
- Step offset and stair handling.
- Ground snapping without magnetic behavior.
- Slope limit and controlled sliding on steep surfaces.
- Crouch clearance checks.
- Moving-platform support if any moving geometry is added.
- No tunneling, wall climbing, corner sticking, stair jitter, or falling through thin geometry.

### Dynamic rigid bodies

Implement a sequential impulse solver with:

- Broadphase spatial hashing or sweep-and-prune.
- Sphere, box, capsule, and limited convex support as needed.
- Contact manifolds, restitution, static/dynamic friction, warm starting, sleeping, and island solving.
- Continuous collision detection for fast casings, thrown objects, and selected debris.
- Stable stacks for crates and barrels.
- Reactive props such as cans, small boxes, bottles, boards, hanging signs, and loose rubble.
- Strict pooling and sleep policies to keep performance predictable.

### Ragdolls

Implement PBD or XPBD ragdolls with:

- Distance constraints.
- Cone limits.
- Twist limits.
- Joint damping.
- Iterative collision against the static BVH and important dynamic bodies.
- Momentum transfer from the final hit.
- Automatic sleeping and cleanup after a controlled lifetime.

## 11. Fully procedural Web Audio system

There must be **zero audio files**. Synthesize every sound live through the Web Audio API. Create inline `AudioWorklet` code through a bundled string/Blob if worklets are used.

### Audio architecture

- Separate buses for weapons, impacts, footsteps, characters, environment, UI, reverb, and master output.
- Per-bus gain, EQ, compression, and optional ducking.
- Final soft limiter to prevent clipping during combat.
- Deterministic seeded randomization so tests are reproducible while repeated events still vary.
- Sample-accurate scheduling based on `AudioContext.currentTime` rather than frame timing.
- Graceful AudioContext unlock on the initial click without delaying input or showing browser-default controls.

### Synthesis toolkit

Build reusable procedural primitives:

- White, pink, and brown noise generators.
- Sine, triangle, saw, square, pulse, and custom periodic oscillators.
- ADSR and multi-stage envelopes.
- Biquad filter chains.
- Waveshaper distortion and saturation.
- Frequency and amplitude modulation.
- Short resonators/modal filters for metal, wood, glass, and shell casings.
- Procedurally generated convolution-reverb impulse responses.
- Parameterized transient, thump, crack, scrape, rattle, ring, hiss, and boom generators.

### Gunshot synthesis

A gunshot must be layered, scheduled, and spatialized as a single coherent event:

- Ultra-short mechanical/transient click.
- Low-frequency receiver/body thump.
- Bright supersonic-style crack.
- Mid-band explosive noise burst.
- Filtered high-frequency tail.
- Separate bolt and mechanism layer.
- Optional nearby environmental reflection taps.
- Round-robin parameter sets plus subtle seeded pitch, envelope, filter, and timing variation so automatic fire never sounds looped.
- Sustained fire should add mechanical rhythm, growing smoke/hiss, occasional casing clusters, and slight dynamic compression without becoming muddy.

### Distance, propagation, and spatialization

- Use `PannerNode` HRTF spatialization for world sounds.
- Apply distance-dependent spectral behavior, not only volume attenuation.
- Near shots emphasize crack, transient, and mechanical detail.
- Distant shots lose high frequencies, gain a broader low rolling report, and receive more environment send.
- Delay the arrival of distant sounds based on approximate speed of sound.
- Create near-miss bullet whizzes/cracks when traces pass close to the listener.
- Raycast between listener and source through the physics BVH. Use obstruction count/material approximation to drive low-pass filtering, attenuation, and reduced direct sound.
- Estimate reverb/open-space character by probing rays around the source and listener. Choose or generate an IR based on openness, nearby wall distance, ceiling presence, and corridor shape.
- Add simple early reflections from dominant nearby surfaces when affordable.

### Other procedural sounds

Synthesize all of these without samples:

- Surface-dependent footsteps for asphalt, concrete, wood, metal, rubble, dirt, and interior tile.
- Cloth movement, gear rattle, landing impact, jump, crouch, and mantle sounds.
- Magazine handling, button clicks, bolt action, empty trigger, and weapon inspect movements.
- Surface-dependent bullet impacts and ricochets.
- Shell casing bounces with pitch tied to size, velocity, and contacted material.
- Wind moving through streets and around corners.
- Low distant city rumble.
- Loose cable hum, fabric flaps, palm leaves, occasional debris movement, and restrained bird/insect-like ambience generated procedurally.
- UI hover, click, score, hit marker, headshot, elimination, match start, and match end sounds.
- Critical-health breathing, low heartbeat-style pulse, and muffling, all restrained enough not to annoy the player.

## 12. Custom WebGL2 rendering pipeline

Do not use `EffectComposer`. Write and own the render graph.

Suggested frame order:

1. Stable cascaded sun-shadow pass.
2. MRT depth/normal/velocity/material prepass.
3. Main opaque HDR forward or forward-plus PBR pass.
4. Decals and selected transparent geometry.
5. Particles, muzzle flash, tracers, smoke, heat distortion, and viewmodel.
6. GTAO with temporal accumulation and denoising.
7. TAA.
8. Tile-dilated motion blur.
9. Karis bloom pyramid.
10. GPU exposure metering.
11. Procedural 33×33×33 color-grade LUT and AgX-style final composite.
12. HUD and menu composite at native display resolution.

### HDR and main lighting

- Render scene color to floating-point HDR targets, preferably RGBA16F where supported.
- Use physically based direct sun, sky irradiance, local muzzle lighting, emissive effects, and restrained reflection approximation.
- Support normal maps, metalness, roughness, ambient occlusion, emissive, decals, and material IDs.
- Use clustered or tiled light assignment if local light count requires it.

### Cascaded shadow maps

- Use multiple sun cascades stored in a `sampler2DArray`.
- Four cascades are recommended for the compact map.
- Stabilize cascades using texel snapping to reduce shimmer.
- Use practical split weighting and cascade blending.
- Include slope/normal bias control and a quality filter such as optimized PCF.
- Preserve sharp contact shadows nearby while allowing softer distance shadows.
- Dynamic characters, the weapon where appropriate, vegetation, props, and moving cloth must integrate correctly.
- Add contact-shadow or screen-space refinement only where it genuinely improves grounding.

### MRT prepass

At minimum capture:

- Linear depth.
- Compact view-space or world-space normal encoding.
- Per-pixel velocity for camera, rigid objects, characters, procedural animation, and weapon.
- Reactive/transparency classification or another mask needed by TAA.
- Optional roughness/material class if useful for later passes.

### GTAO

- Implement horizon-based or GTAO-style ambient occlusion from depth and normals.
- Use a rotating sampling pattern, depth-aware bilateral denoise, temporal reprojection, and neighborhood clamping.
- Preserve small contact detail beneath props and around wall intersections without turning corners black.
- Reduce AO on moving/unstable pixels through velocity and reactive masks.

### TAA

- Use Halton or similarly well-distributed camera jitter.
- Reproject with the velocity buffer.
- Clamp history in YCoCg using neighborhood min/max or variance clipping.
- Detect disocclusion from depth/normal mismatch.
- Use reactive masks for muzzle flash, particles, smoke, transparencies, animated foliage, optic reticle, and rapidly changing emissive pixels.
- Avoid ghost trails on the weapon, enemies, tracers, and thin cables.

### Motion blur

- Derive blur from the velocity buffer.
- Compute tile-max velocity and dilate to neighboring tiles.
- Use depth-aware sampling to reduce foreground/background bleeding.
- Keep normal movement crisp. Stronger blur should appear mainly during fast turns, sprinting, recoil, and peripheral damage response.
- Provide an off/low/high setting.

### Bloom

- Use a Karis-average downsample pyramid with several levels.
- Bloom only genuinely bright HDR pixels such as sky highlights, muzzle flash, sparks, and bright reflections.
- Do not put a glowing haze around every wall and UI element.

### Exposure and final composite

- Meter scene luminance on the GPU through a downsample or histogram-style approximation.
- Express adaptation in EV100-like terms with separate brighten and darken speeds.
- Protect the weapon and HUD from severe exposure pumping.
- Generate a 33³ grading LUT procedurally at startup and sample it in the final pass.
- Use an AgX-style tone-mapping/composite curve with controlled highlight rolloff, natural saturation, and preserved shadow detail.
- Add only restrained vignette, film grain, lens dirt, chromatic separation, and sharpening. Each must be subtle and adjustable.

## 13. Particles, smoke, and decals

- Build GPU-friendly pooled particle systems.
- Support dust, concrete chips, sparks, wood splinters, smoke puffs, barrel smoke, muzzle gas, drifting dust, leaves, paper, and glass fragments.
- Use depth softening and lighting response so particles belong in the scene.
- Smoke should evolve through expansion, curl/noise, dissipation, lighting, and wind, not just scale a single billboard.
- Heat distortion should sample the scene behind hot gas and remain localized.
- Decals must conform to geometry or use a robust projected approach, avoid z-fighting, and be pooled.
- Cap and recycle every temporary effect.

## 14. HUD and presentation

Match the reference’s compact, restrained hierarchy while using an original design.

- Top left: square tactical minimap with simplified building footprint, player arrow/FOV, teammates, and enemy pings only when revealed by gameplay rules.
- Top center: thin compass strip, team scores, match mode, and timer.
- Top right: compact kill feed.
- Bottom left: `HEALTH`, numeric value, and segmented horizontal bar.
- Bottom right: fire mode, weapon label, magazine count, reserve count, throwable icons, and a compact ammunition bar.
- Center: tiny hip-fire crosshair, hit marker, directional damage indicator, elimination banner, XP, and headshot label.
- HUD should be sharp at 16:9 and ultrawide, including the reference-like 2192×1080 ratio. Use safe-area anchoring, not stretched coordinates.
- Use subtle translucent panels, fine lines, clean condensed typography, restrained team colors, and smooth 100–200 ms transitions.
- Do not make the HUD look like a website dashboard.

## 15. Performance and scalability

The target is a stable **60 FPS at 1920×1080 and the reference’s ultrawide resolution** on a reasonably modern desktop GPU, with scalable settings for weaker hardware.

- Separate fixed simulation from rendering and interpolate transforms.
- Use object pooling for bullets, casings, particles, decals, ragdolls, and audio voices.
- Use instancing, texture atlases/arrays, merged static batches, LODs, frustum culling, distance culling, and BVH-based visibility where beneficial.
- Avoid shader recompilation during combat.
- Prewarm important materials and pipelines during loading.
- Use workers for expensive world generation or BVH construction if it materially reduces startup stalls.
- Add dynamic render scale with conservative bounds and hysteresis.
- Include low/medium/high/ultra quality presets for shadow resolution, AO samples, cloud steps, particle density, motion blur, bloom, and render scale.
- Keep menus and HUD at native display resolution even if 3D render scale changes.
- Handle resize, device-pixel ratio changes, fullscreen, focus loss, pointer-lock loss, and tab suspension cleanly.
- No recurring garbage-collection spikes caused by per-frame allocations.

## 16. Code architecture and engineering quality

Use clear, modular systems such as:

- `core/GameLoop`
- `core/Input`
- `core/SeededRandom`
- `render/RenderGraph`
- `render/ShadowSystem`
- `render/Prepass`
- `render/GTAO`
- `render/TAA`
- `render/MotionBlur`
- `render/Bloom`
- `render/Exposure`
- `render/Composite`
- `world/MapGenerator`
- `world/MaterialLibrary`
- `world/PropSystem`
- `physics/BVH`
- `physics/CharacterController`
- `physics/RigidWorld`
- `physics/Ragdoll`
- `game/Player`
- `game/Weapon`
- `game/DamageSystem`
- `ai/NavWorld`
- `ai/BotBrain`
- `audio/SynthEngine`
- `audio/SpatialAudio`
- `ui/HUD`
- `ui/Menu`

Requirements:

- Central seeded RNG; do not use uncontrolled `Math.random()` for gameplay-critical systems.
- Clear ownership of GPU resources and explicit disposal.
- No hidden global state where avoidable.
- No placeholder `TODO` branches in the shipped experience.
- Add debug views toggled by keys or query parameters for shadow cascades, normals, velocity, AO, BVH, nav representation, cover points, audio rays, and frame timings.
- Save settings locally.
- Include a concise README with controls, architecture, performance targets, and build commands.

## 17. Playwright visual and performance harness

Create deterministic automated checks that:

- Launch the production build at fixed viewport sizes, including 1920×1080 and 2192×1080.
- Start the game with a known seed.
- Move the player to predetermined camera positions.
- Capture screenshots of the spawn alley, central market, archway/plaza, ADS view, muzzle flash, impact effect, low-health state, and enemy encounter.
- Assert that the canvas is not blank and key HUD regions are present.
- Collect frame-time samples after warmup and report average, p95, and worst frame time.
- Report draw calls, triangle count, active particles, rigid bodies, audio voices, and GPU render scale where possible.
- Detect uncaught errors, WebGL context loss, failed shaders, missing resources, and NaN transforms.
- Keep screenshots deterministic enough for regression review while allowing tiny GPU differences.

## 18. Required quality gates

The project is not complete until all of these are true:

1. The first frame after loading already looks like a finished game, not a gray blockout.
2. The scene strongly resembles the attached reference’s sunlit dense market-street atmosphere.
3. The sky contains convincing moving cumulus clouds and physical sunlight.
4. Buildings show non-repeating facade detail, wear, utilities, windows, balconies, and rooftop clutter.
5. The street contains dense but believable cover and micro-props.
6. The weapon is detailed enough to withstand close inspection and remains correctly lit.
7. ADS alignment and the collimated optic work correctly.
8. Shooting has recoil, muzzle flash, light, smoke, casing ejection, tracers, impacts, decals, and layered sound.
9. Automatic fire never produces visibly or audibly identical repeated events.
10. Enemies navigate, seek cover, peek, flank, react to sound, shoot, reload, and lose sight correctly.
11. Bots never track the player through solid walls.
12. Character feet sit on the ground and hands remain attached to weapons.
13. Ragdolls are stable, non-graphic, and inherit momentum.
14. Low-health visuals are readable and recover or transition to death correctly.
15. HUD contains minimap, compass, score, timer, kill feed, health, ammunition, hit feedback, and elimination messaging.
16. Spatial audio, distance filtering, propagation delay, occlusion, and procedural reverb are clearly audible.
17. The custom CSM, MRT prepass, GTAO, TAA, motion blur, bloom, exposure, LUT, and AgX composite are genuinely implemented rather than named but bypassed.
18. TAA does not leave severe ghost trails on enemies, the weapon, particles, or thin geometry.
19. Shadows do not visibly crawl or shimmer during normal movement.
20. The game runs a complete match, ends, and restarts without a page refresh.
21. The production build performs no external runtime fetches.
22. No required audio or visual file is missing when the game is opened offline.
23. The game remains responsive after resize, fullscreen changes, pointer-lock loss, and tab refocus.
24. The visual benchmark and console-error tests pass.
25. There are no obvious placeholders, debug meshes, generic primitives, broken animations, or empty areas in the final presentation.

## 19. Explicitly forbidden shortcuts

Do not:

- Deliver only a renderer demo, gun range, static scene, or walking simulator.
- Use a flat plane with boxes as the final map.
- Use primitive capsules as visible final enemies.
- Use generic placeholder weapon geometry.
- Fake bots with scripted targets that do not navigate.
- Fake audio with silent nodes or downloaded samples.
- Claim an effect exists while rendering directly to the screen and bypassing it.
- Use a static image as the sky or background.
- Depend on CDN scripts or external asset URLs.
- Use an iframe or embed another game.
- Copy proprietary game assets, logos, UI, character models, or map files.
- Hide poor rendering under excessive motion blur, bloom, darkness, fog, or film grain.
- Leave loading races, black screens, broken pointer lock, or audio that never starts.
- Stop after implementing only the easiest systems. The result must be coherent and playable end to end.

## 20. Final execution instruction

Build the project, run it, test it, profile it, and refine it until the quality gates are met. Prioritize one dense, polished map and one excellent weapon over broad but shallow content. Do not respond with a design document or explain how it could be built. Produce the working project. At completion, provide only a concise summary of what was implemented, the controls, the build/test commands, and any genuinely remaining limitations.
