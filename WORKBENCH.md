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

## Round 2 — planned

- Builder pass from critic findings: buildings, sky, street detail.
- AI realism pass: fire discipline, reaction to being shot at, use of
  windows/doorways.
- HUD smoothness pass.
