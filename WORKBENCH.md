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

## Round 3 — candidates

- Enemy character presentation (vest/helmet/rifle silhouette) — the round-1
  critic shot framed no enemy; needs a reliable close-up pose first.
- Market-lane counters and the flat blue-grey stall boxes.
- Suppression wired to near misses, not only to hits.
