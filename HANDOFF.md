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
- `npx playwright test --reporter=list` — full suite, ~6–10 min, 40 tests.
  Last run: 38 passed, 2 failed. "a traced shot damages the thing it is
  pointed at" is a flake (passes on re-run; the aimed-at enemy moves).
  **"crouching out of a sprint carries speed and drops the head" fails
  repeatably since the spawnable-mask change** — the random spawn now lands
  somewhere the test's four-heading run-up cannot reach sliding pace
  (gate: sprint key held + speed > walk×0.9). The slide mechanic itself was
  verified working today; fix the TEST (teleport to a long clear stretch,
  e.g. the market lane, before the run-up — `tools/snippets/slide-probe.js`
  is a ready-made probe for exactly this). First task for whoever picks up.
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

## THE CURSOR TRAP — measured, and there is now an OS-side release

**The mechanism is confirmed, with numbers.** On this machine the physical
desktop is **1920x1200** and the display scaling is **125%**, so the *logical*
desktop is **1536x960**. A cursor clip written in logical coordinates and
applied against the physical desktop confines the cursor to the top-left
1536x960 of the screen — which is exactly the symptom, and exactly the region
reported. Verified by planting that rectangle with `ClipCursor` and watching
the cursor behave as described.

No web page can release it: the clip belongs to the browser process, not to the
document. So the release lives outside the game:

- `tools/unstick-cursor.cmd` — double-click to release it right now.
- `tools/unstick-cursor.cmd watch` (or `cursor-guard.ps1 -Watch`) — leaves a
  guard running that releases it whenever it reappears. The guard only fires on
  this specific signature (anchored at the desktop origin, sized to the desktop
  divided by the DPI factor, within 3 px) so a real fullscreen game confining
  the cursor to a monitor is left alone.

Both tested: planting a 1536x960 clip and running the guard released it and
restored the full 1920x1200.

### Root cause inside the game (layer 4)

**The bug was in this repo, not only in Chromium.** `Game._bindEvents` assigned
its lock-loss handler to `input.onLockChange`; `Input` only ever calls
`onPointerLockChange`. The auto-pause therefore never ran once. Consequences,
which match every symptom the user described:

- Escape ends the pointer lock. Without Keyboard Lock (which needs fullscreen,
  and fullscreen has been opt-in since layer 2) the browser consumes that
  keydown, so `onPauseRequested` never fires either. The match stayed in
  `playing` with no menu and no mouse handling.
- `src/main.js` had `canvas.mousedown -> input.requestLock()` guarded only on
  `state === 'playing'`. So the next click anywhere on the game took the mouse
  straight back. Give it back, click, gone again — indefinitely.
- `requestLock` decided success by awaiting the return of
  `requestPointerLock()`, which is `undefined` on older engines: `await
  undefined` is `true`, so a *refused* request reported success and the
  `_unwind()` safety net was dead code. Pointer Lock 2.0 specifies that a
  request made straight after the browser's own unlock gesture is refused —
  Escape-then-click is exactly that, so this path was being hit routinely.

Fixed and pushed: handler wired to the real name, implicit relock deleted (the
mouse is only taken from Deploy or Resume), acquisition determined from the
`pointerlockchange` / `pointerlockerror` events, `pointerlockerror` returns to
the pause menu, and leaving fullscreen by any route clears the flag and the
keyboard lock. Guarded by the smoke test "losing pointer lock pauses, and a
click does not take the mouse back", which exits a real lock — verified to fail
against the old property name.

**Check the port before believing any bug report.** On 2026-08-08 the user was
still hitting the trap after all of this shipped, because **port 5173 was
serving a different project entirely** ("Codex Logo Animation") — this game's
dev server was not running, so the tab they were playing had been loaded from a
server that no longer existed and kept running its old bundle in memory
forever. No fix could ever reach it. Verify with:

```bash
curl -s http://localhost:5173/ | head -5
```

Known-good URLs, both verified to carry the fixes: `http://localhost:4319/`
(preview, serves `dist/` — rebuild with `npm run build`) and
`http://localhost:5174/` (dev server, started with
`npm run dev -- --port 5174 --strictPort false` because 5173 was taken). The
start screen now prints a build stamp and the mouse settings in the footer, so
which build is on screen is readable rather than guessed.

If a trapped OS cursor still survives *after* the match has paused itself and
the build stamp is current, that is the Chromium-side clip and the layers below
are what address it.

### Layer 5 — no fullscreen, and a keyboard way out

The game never calls `requestFullscreen` any more and `fullscreenOnPlay` is
gone from settings. In fullscreen Chromium's cursor clip is the whole screen,
so a stale one pins the cursor into a quarter of the *desktop*; windowed, the
worst case is a quarter of a window. Keyboard Lock was the only reason for it
and `beforeunload` replaced that. The pause menu is also keyboard-operable now
(Enter resumes, Q abandons) so a confined cursor can never lock a player into a
match they cannot leave.

### The three earlier layers (all still in place)

1. Symmetric unwind — keyboard lock + fullscreen released whenever pointer
   lock ends, and on `visibilitychange`/`blur` (`src/core/Input.js`).
2. `fullscreenOnPlay` now **defaults off** (settings storage bumped to v3 so
   the old stored `true` cannot survive). Ctrl+W is covered by a
   `beforeunload` confirm during a live match instead of Keyboard Lock.
3. `unadjustedMovement` (raw input) now **defaults off** — its Windows path
   is implicated in exactly this stale-clip bug on scaled displays.

If it recurs with layer 4 in place *and* the match does pause itself, confirm
`localStorage['dust-corridor.settings.v3']` has `fullscreenOnPlay:false,
rawInput:false`, then suspect DevTools-docked geometry during dev. Unstick
escape hatch for the user: Alt+Tab or F11 ×2.

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
