# Handoff — Claude of Duty

Browser-native tactical FPS, Three.js r180 on WebGL2, Vite 7, Playwright.
One map (sunlit North African market district), solo player vs 6 AI, custom
everything: renderer, physics, navmesh, procedural audio, procedural map.
The original brief with all constraints and quality gates is `PROMPT.md`.
Repo: https://github.com/Leonxlnx/claude-of-duty (push to `main` after every
verified chunk — the user wants frequent pushes).

## Commands

- `npm run dev` — dev server on 5173 (user plays here; may already be running)
- `npm run build` — build to `dist/` (~2s)
- `npm run preview` — serves `dist/` on 4319 (**tests and tools expect this
  to be running**; check before debugging "connection refused")
- `npx playwright test --reporter=list` — full suite, ~6–10 min, 40 tests,
  green as of the last run
- `node tools/eval.mjs <snippet.js>` — evaluate a JS snippet against the
  running game (`g` = game, `h` = harness) and print the JSON result. Use
  this for any question about state. Snippets live in `tools/snippets/`.
- `node tools/shot.mjs <out.png> "?auto=1&dynres=0" <waitMs> "" <snippet>` —
  one screenshot with a pose snippet
- `node tools/gauntlet-shots.mjs shots/gauntlet/<round>` — boots once,
  captures the standard six poses (street/ads/plaza/alley/enemy/sky)

Set `$env:PORT=4319` for the tools (PowerShell). Headless rendering uses
SwiftShader: expect ~14% sim speed under load — that is why the harness has
`h.wait(seconds)` (simulated seconds, not wall clock). **Always use sim-time
waits in tests**, wall-clock waits are how half the old flakes happened.

## Method: the Gauntlet Loop (user explicitly wants this)

Iterate in rounds against a hard bar (AAA market-district FPS, per
`PROMPT.md`): capture `tools/gauntlet-shots.mjs`, read the images yourself
AND spawn independent critic subagents with fresh context, fix the biggest
gap, re-shoot, verify, push. Log each round in `WORKBENCH.md` (history of
rounds 0–2 is there). Critics can be wrong about *causes* (they judged a
broken-lighting build harshly on geometry) — always verify their findings
against the pixels yourself before building.

## State: what was just done (all pushed)

- **Movement**: acceleration model fixed (speeds actually reach their caps),
  slide on C out of a run, grenades on B (hold LMB to charge), solo scoring.
- **Spawns**: navmesh takes exact building footprints from the generator +
  a `spawnable` mask excluding the service strip behind the outer building
  rows. Nobody spawns indoors or behind the map. Tested.
- **Sky/light**: sun at 57° nearly white, cloud radiance neutral with a
  cluster mask (distinct cumulus), LUT warm push halved. The old rose tint
  is gone. A distant-skyline backdrop breaks the boundary-wall sightlines.
- **Weapon**: wrapped sun key + neutral shoulder fill in the viewmodel light
  rig (`world.glsl.js`, `uViewmodelLight` block) — receiver reads grey now,
  not navy. Optic stays centred while leaning (lean offset fades with ADS).
- **AI**: flees live grenades (tested), flinches off its firing solution
  when hit, decaying `stress` widens its fire under pressure.
- **Perf**: far shadow cascades alternate frames (~25% off the heaviest GPU
  pass); CPU profile healthy (render 1.4ms, AI 1.0ms on a mid machine).
- **HUD**: clusters glide in on deploy; menu footer restyled as keycaps.

## THE CURSOR TRAP (user's top pain, twice reported, treat as unresolved)

Symptom: on the user's Windows machine the visible mouse cursor ends up
confined to the top-left quarter of the screen around pointer-lock use.
Three layers were shipped, in order:

1. Symmetric unwind — keyboard lock + fullscreen released whenever pointer
   lock ends, and on `visibilitychange`/`blur` (`src/core/Input.js`).
2. `fullscreenOnPlay` now **defaults off** (settings storage bumped to v3 so
   the old stored `true` cannot survive). Ctrl+W is covered by a
   `beforeunload` confirm during a live match instead of Keyboard Lock.
3. `unadjustedMovement` (raw input) now **defaults off** — its Windows path
   is implicated in exactly this stale-clip bug on scaled displays.

The user had not yet confirmed the fix after layer 3. If it recurs with all
three in place: have them hard-refresh (Ctrl+Shift+R) first — an old tab
keeps old code — and confirm `localStorage['dust-corridor.settings.v3']`
exists with `fullscreenOnPlay:false, rawInput:false`. Next suspects: the
auto-relock on canvas `mousedown` in `src/main.js`, and DevTools-docked
geometry during dev. Unstick escape hatch for the user: Alt+Tab or F11 ×2.

## Open work, in priority order

1. **Enemy character presentation.** The round-1 critic called the enemy a
   featureless dark mannequin, but the shot framed no enemy — first build a
   reliable close-up pose (freeze an agent, teleport in front, then shoot),
   judge, then improve silhouette/gear/colour separation in
   `src/game/CharacterRig|Character.js` if confirmed. Enemies may genuinely
   need: clearer vest/helmet silhouette, 3–4 material colours, visible rifle.
2. **Round-3 environment pass.** Remaining known flats: the blue-grey market
   counter boxes in the lane, big uniform ground patches, rooftop clutter
   density. Re-shoot and judge — much of what critics flagged was actually
   the broken lighting.
3. **"Shooting into buildings more realistic"** (user ask, untouched):
   interior darkness response, dust/debris when rounds enter rooms,
   penetration through shutters/wood already exists in Combat — check its
   effects read well.
4. **Suppression from near misses** — stress currently rises only on hits
   and grenades; wire trace near-misses to `agent.stress` in Combat.
5. **HUD round 2**: kill feed styling, hit-marker pop, compass polish. The
   perf readout (top-left) leaks into screenshots; it is the `showFps`
   debug overlay — consider hiding it in gauntlet shots.
6. **Performance round 2** if the user still reports load: cloud pass is
   half-res already; next lever is AO resolution and the prepass at
   dynamic scale.

## Verification habits that caught real bugs here

- A throw inside `_render` silently aborts the frame and a dozen unrelated
  visual tests fail instead — the smoke test "no state throws" exists for
  this; keep it green.
- After geometry/nav changes run `tools/snippets/spawn-audit.js` via
  `eval.mjs` (60 respawn draws checked against footprints/margins/roofs).
- After sky/light changes look at `sky.png` AND `street.png` yourself; the
  SH ambient bake spreads any sky tint over the whole district.
- The user plays the dev server on 5173: `npm run build` does not update
  what they see; committing source does (Vite serves from disk). Tell them
  to hard-refresh after fixes.
