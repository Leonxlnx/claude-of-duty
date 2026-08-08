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

## Round 5 — candidates

- The flat blue-grey barrier slabs in the street still have no material
  identity — they could be plastic, metal or stone.
- Facades are large areas of flat colour: no plaster patching, no water
  staining under sills and balcony drains, no exposed block.
- Nothing meets the ground: every wall/floor seam is a razor-clean line with
  no splash zone, dirt fillet or chipped kerb.
- Awnings are rigid flat quads at a uniform height — no sag, no fray, and the
  canopy sits high enough above the counters to read as a hollow void.
