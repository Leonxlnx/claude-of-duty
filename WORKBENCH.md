# Gauntlet workbench

Live progress log for the improvement loop. Each round: capture screenshots,
put them in front of independent critics with fresh context, fix the biggest
gaps, re-shoot, push. Screenshots live under `shots/gauntlet/<round>/`.

The bar: the sunlit market-district FPS described in `PROMPT.md` — judged on
real pixels, not intentions.

---

## Round 0 — reported bugs (done)

- **Optic off-centre while peeking.** The lean kept shoving the weapon
  sideways at full aim. Now fades out with the aim blend; collimation test
  extended to assert while leaning.
- **Spawns inside / behind buildings.** The navmesh now takes the generator's
  exact building footprints (no more raycast guessing) and a `spawnable` mask
  excludes the service strip behind the outer building rows. 60/60 sampled
  redeploys and the opening wave land clean.
- **OS cursor trapped in the top-left quarter of the screen.** Chromium's
  pointer-lock cursor clip can go stale when lock and fullscreen are not torn
  down together. Lock teardown is now symmetric: keyboard lock and the
  fullscreen we entered are released whenever pointer lock ends.

## Round 1 — measurement + critics (in progress)

- Shadow pass interleaving: the two far cascades alternate frames — a quarter
  of the most expensive GPU pass back, invisible at those distances.
- CPU frame profile (mid-range machine): render 1.4 ms, AI 1.0 ms, world
  0.55 ms, everything else under 0.2 ms. 60 fps held while sprinting.
- Captured `shots/gauntlet/round1/`: street, ADS, plaza, alley, enemy, sky.
- Three independent critics (environment, weapon/HUD, characters) reviewing
  against the bar. Their top gaps drive the next builder pass.

## Round 1 — critic findings (done)

Three independent critics reviewed `shots/gauntlet/round1/`. Verdict: every
shot lost to the bar. Top gaps, in their order: a rose tint over the whole
frame, a weapon reading as one dark slab with no hands in sight, flat
facades/rooflines, and shapeless clouds with a hard seam.

## Round 2 — builder passes (done)

- **Midday light.** Sun raised from 41° to 57° and nearly white; cloud
  radiance rebuilt (neutral sun colour, modest phase, cluster mask so cumulus
  forms heaps with blue between); grade LUT's warm push halved. The rose tint
  and the cloud seam are gone — verified against `shots/gauntlet/round2/`.
- **Readable weapon.** A wrapped sun key now fills only where real sunlight
  cannot reach, and the over-shoulder fill uses the sky's luminance without
  its colour. The receiver reads grey with rail/receiver separation instead
  of navy silhouette; the support-arm sleeve is visible in frame.
- **Skyline.** Two hazed rings of rough blocks with rooftop bumps continue
  the town past the boundary walls, so sightlines no longer end in a bare
  plaster slab.
- **Cursor trap, third layer.** Fullscreen-on-play and raw input are both
  opt-in now, and the lock is released on focus loss.
- **AI realism.** Agents flee live grenades at a sprint (tested), flinch off
  their firing solution when hit, and carry a decaying stress value that
  widens their fire under pressure.
- **HUD.** Anchored clusters glide in on deploy; the controls footer became a
  proper keycap panel.

## Round 3 — enemy characters (done)

The round-1 critic called the enemy a featureless dark mannequin and could not
have known whether that was true, because the shot framed no enemy at all.
`tools/enemy-shots.mjs` fixes the evidence problem: it freezes the AI, plants an
agent on a fixed mark in the market lane, drives its rig by hand and photographs
it from a named set of framings. Three staging bugs had to go first, each of
which made the character look worse than it was:

- the subject faced away from the lens (the rig's forward is
  `(-sin yaw, 0, -cos yaw)`, and the framing used the un-negated delta)
- framings were measured from the world axes, so the subject was backlit and
  every kit colour crushed together — a monochrome *light*, read as a
  monochrome palette
- a fixed wall-clock settle was not enough rendered frames under a software
  rasteriser to clear the motion blur from the teleport onto the mark

With honest pixels the palette problem was real: team B's entries all sat within
0.14 of each other and `albedo = texture * tint`, so no amount of layered
geometry could survive it. Both teams now span roughly 4:1 from uniform to
carrier and split by hue as well as value — warm olive cloth against cold
near-black armour — because a midday exposure lifts a purely value-based split
until the vest sits a shade off the sleeves. Plus a team-coloured panel across
the carrier front and back, and a radio whip long enough to break the
head-and-shoulders rectangle.

Verified in `shots/enemy/round3/`: the carbine reads in profile, the uniform
separates from the armour, the helmet has a brim, the team colour carries.
Still open — the carrier does not separate on the sunlit side, and the face is
a dark void under the helmet.

## Round 4 — environment, with two critics (done)

Two independent critics with fresh context reviewed `shots/gauntlet/round3/`.
They converged, and both put the same thing first: **the market counters are
bare planks — nowhere in three shots is anything for sale.** That matched the
standing list, so it was built.

Verifying their findings against the pixels first was what kept two of them
from becoming wasted work:

- "no parapets, no roof furniture" — **wrong about the cause.** Both already
  existed. The fault was that almost none of the clutter cleared the 0.55–1.1 m
  parapet from street level, so the roofline still cut the sky flat. The fix
  was height, not new geometry.
- "the ground is one flat colour with a blur mask" — **right.** One
  low-frequency noise over the whole district reads as a cloud layer.

Shipped: goods scaled to counter length and placed in slots so they cannot
clump at one end, plus bundles and pots hung from the top rail to fill the void
between counter and awning; roof tanks on legs, taller stair boxes, dishes and
3.2–5.6 m masts; ground tint at three scales with two packed wheel ruts either
side of the road crown. Compare `round3/street.png` with `round4/street.png`.

Two capture-rig faults fixed in the same pass, both of which had been
corrupting the loop itself: `h.teleport` now brings the eye with it (`eye` is a
render-time interpolation, so every pose was aimed from where the camera used
to be, and the framing depended on the previous shot — rounds were not
comparable), and the HUD is hidden for captures.

## Round 5 — bounce light, weathering, canopies (done)

Ground-bounce ambient (the barriers read as concrete instead of blue-grey
slabs); splash zone, drip staining and blown-render in the world shader, which
weathers the whole district at once; canopies with varied height, span, sag and
post material, hung at 2.45–2.95 m so the shade belongs to the stall under it.

Two traps: `patch` is a reserved word in GLSL, and a backtick in a comment
inside the shader's template literal ends the string. **A shader that fails to
link still produces a plausible-looking screenshot** — build and run the smoke
test before believing a capture.

## Rounds 6–7 — two measuring critics (done)

These critics sampled actual pixel values, which made their claims checkable.
Three were real and are fixed: chromatic aberration had a constant term so the
frame centre got separation too (window grilles read as saturated red/blue
candy stripes); there was no output dither anywhere, so the sky quantised into
40–60 px plateaus; and the sky's multiple-scattering Mie share had no phase
function, putting a salmon sunset band right around the horizon.

A fourth — "AO is multiplying the direct term", argued from measurements — was
**wrong**. Line 36 of the composite multiplies AO into the ambient only. Two
rounds running, a confident critic finding has been a misdiagnosis; check
before building.

Round 6 also fixed what round 5's bounce exposed: ground normals point up and
so received no bounce, leaving shaded ground under pure Rayleigh sky — the
alley floor came out **teal**. Sky irradiance is now pulled 40% toward its own
luminance with a slight warm bias.

## Round 8 — exposure (done)

The change both critics named, and the tonemapper was not the cause: AgX
already has the shoulder. The **metering** keyed the average frame luminance to
18% grey, and in a sunlit desert street the average *is* the sunlit ground, so
the sand was mapped to middle grey by construction.

Keyed at 0.38 after measuring three candidates with `exposure-probe.js`:

| | round 7 | key 0.38 | key 0.46 |
|---|---|---|---|
| sunlit ground | 118 | **141** | 150 |
| 99th percentile | 196 | **209** | 217 |
| frame below lum 40 | ~15% | **0.5%** | 0.1% |

0.46 hits the critics' stated target and overshoots in the frame — the sky goes
milky and the shade under the awnings loses its density. Judged on the pixels,
not only the numbers, which is the whole method.

## Round 9 — player-reported (done)

Motion blur tamed; times of day (dawn/morning/day/sunset/night) as whole
lighting states with their own EV bias; hit registration fixed; blood rebuilt
as three populations; explosion given a shockwave crack, a sub and debris; AI
difficulty wired to tactics rather than only to aim; weapon palette separated
into steel/polymer/FDE.

Still open on the weapon: a pale cylinder remains at the stock end (visible
bottom-right in `shots/gun/round2.png`) and the hands have no AO where they
meet the grip. The critics' full weapon note is in round 5-7 above.

## Round 10 — critics at quality 8 (partly done)

First captures taken at a supersampled level — and the capture rig was lying
until this round: it called `setRenderScale(1)` after picking the quality
level, which threw the supersampling away, so every previous judgement about
sharpness was made against a level-4 image.

**The headline finding was wrong, for the third round running.** A critic
measured two sand pixels and concluded sun-to-shade contrast was 1.47:1 with no
colour separation — "the single change with the most impact" — and prescribed
cutting ambient by about a third. Measured properly across the whole ground
band (`tools/snippets/shade-ratio.js`): **2.84:1 in sRGB, 9.9:1 in linear**,
which is at or above the physically correct 5-8:1. Their two samples were an
unlucky pair. Following the advice would have crushed the shadows again and
undone the fix the *previous* critic correctly demanded. Check before building.

Acted on: chromatic aberration halved again and the offset hard-capped, because
at the old strength the extreme corner separated channels by over two pixels
and one-pixel geometry resolved as saturated orange and cyan rather than as a
fringe.

A second critic measured properly — Laplacian RMS, autocorrelation, per-channel
centroid separation — and was far more useful. Verified from its findings:

- **"SSAO contributes nothing, this is a binding failure."** Half right, and the
  half it got wrong matters. `tools/snippets/ao-check.js`: the AO buffer is
  bound and does vary (min 100), but its **mean is 251/255** — 98% unoccluded —
  and toggling `uAOStrength` moves the frame mean by **0.19 of 130**. So it is
  not a binding bug; AO only multiplies the ambient term, and in direct sun
  ambient is a small share of the pixel, so contact darkening cannot show. The
  fix is a contact term that also touches direct light, not a rewire.
- **"Textures carry no energy between 1 and 8 pixels."** Correct, and it agrees
  with the material-resolution work — but those captures were taken at 512px
  materials and 8x anisotropy *despite* being set to quality 8, because the
  arrays bake at boot from the stored level and the tool set quality after
  boot. Fixed: the capture now stores the level in an init script. **The round 9
  images are not a fair test of the crispness work.**
- **Chromatic aberration.** Measured 1.2-1.5px corner separation against a
  target of ≤0.4px. Halved and hard-capped.

Still open from this round, unverified — check each against the pixels first:
- Props with no cast or contact shadow (sandbag stacks, barrels) while stall
  posts in the same frame cast correctly. Suggests a caster-set exclusion.
- Bloom around the sun clipping the red channel into a flat plateau with a hard
  rim; likely the same root as the earlier "sun disc is 8x too large".
- The viewmodel is lit by a constant rig, not the scene — an 11% brightness
  swing across three radically different lighting contexts.
- Hard-edged rectangles of light inside shadow in `alley.png`. May well be
  legitimate gaps between awning quads; the critic could not see above frame.

## Round 11 — candidates, in the critics' order
- Walls have no relief — no normal map at mid scale, so a raking sun produces
  nothing. Same blob frequency at 2 m and at 40 m.
- The viewmodel is an untextured blockout in the strongest read position of
  every frame: white barrel (should be the darkest part), flat black slab, no
  edge wear, no AO in the hand/grip junction.
- Props float: awning posts cut off above the sand, hanging goods with no rope,
  palms as flat cardboard fans. Ray-cast pivots down at spawn and add a contact
  darkening decal.
- Both wide shots dead-end in a blank slab exactly where the composition funnels
  the eye. Needs a focal object — minaret, arched gate, wreck.

**Method notes earned the hard way, for whoever runs the next round:**

- Verify every critic finding against the pixels before building. Two rounds
  running, a confident, measurement-backed finding was a misdiagnosis
  ("no parapets or roof furniture" — both existed; "AO multiplies the direct
  term" — it does not, see `COMBINE_FRAG` line 36).
- Build and run the smoke test *before* believing a capture. A shader that
  fails to link still renders a plausible-looking screenshot.
- Check the framing rig before blaming the art. Three separate staging bugs —
  subject facing away, framings measured off the world axes so everything was
  backlit, wall-clock settling too short to clear motion blur — each made the
  work look worse than it was.

- The flat blue-grey barrier slabs in the street still have no material
  identity — they could be plastic, metal or stone.
- Facades are large areas of flat colour: no plaster patching, no water
  staining under sills and balcony drains, no exposed block.
- Nothing meets the ground: every wall/floor seam is a razor-clean line with
  no splash zone, dirt fillet or chipped kerb.
- Awnings are rigid flat quads at a uniform height — no sag, no fray, and the
  canopy sits high enough above the counters to read as a hollow void.
