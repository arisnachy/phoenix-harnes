# PHOENIX Game Studio — offline playable examples

English | [中文](README.zh.md)

These **original, offline** examples establish reusable game mechanics, not a promise of perfect commercial art, finished sound design or automatic support for every engine.

## Run

Open either `jungle-echo.html` or `lumen-circuit.html` in a modern browser, or publish its complete HTML content using MIME `application/vnd.phoenix.game+html` in PHOENIX. The in-chat preview uses an isolated iframe with inline scripts and no network/CDN dependencies.

- **Jungle Echo** (run-and-gun): A/D or arrows move; Space/up/W jump; J/K fire; I aims diagonally up; O aims diagonally down; M toggles sound; touch buttons and restart are available.
- **Lumen Circuit** (puzzle): click/tap a tile to rotate it; arrow keys move keyboard focus; Enter/Space rotate the selected tile; use New Game to restart.
- Both use WebAudio only after a user gesture and allow sound to be disabled.

## Reusable foundation

- `game-kit.js` contains analytical two-bone inverse kinematics, coordinated legs and arms, hands aligned with weapon aiming, directional targeting, animation frame math, parallax and a bounded enemy decision primitive. `jungle-echo.html` inlines it so the preview does not fetch external files.
- The game artifact audit supports genre-specific `gameType` profiles (run-and-gun, platformer, top-down action, racing, puzzle, strategy, RPG, rhythm, simulation, 3D and custom) and does not require a boss or gun in puzzle and racing games.
- The examples exercise two actual game loops: shooter combat and a puzzle connectivity/rotation ruleset. Profiles for other genres validate structure but do not create their gameplay automatically.

## Complete-cast production plan

Before creating any art for an illustrated run-and-gun, run `node examples/game-studio/plan-game-assets.mjs jungle-echo.manifest.json game-plan.json`. It produces a **pending** task for the hero, every declared enemy type, each boss phase, all parallax layers, weapons, projectiles, powers, props, effects and sound cues. Kira/La Forja should create and actually integrate the resulting assets; the plan does not draw them.

For production run-and-gun, each `art.enemies[].id` and `art.bosses[].id` must match a real gameplay entity, have a distinct PNG sprite image, grid and animation states. Every boss phase must map to real frame indices in `phaseAnimations`. Each `level.layers[].id` needs a matching illustrated `art.backgrounds[].id`; additionally supply `art.weapons`, `art.projectiles`, `art.powers`, `art.props` and at least two illustrated `art.effects`. A PNG that is merely included in the artifact but never rendered fails the publication gate. Audio and visual polish are still verified separately in a running game.

### Reuse existing art and sound instead of regenerating unused presets

Pass the current packer-compatible `assets.json` as the optional third argument to the planner:

    node examples/game-studio/plan-game-assets.mjs manifest.json plan.json assets.json

The planner verifies on-disk PNG/WAV/OGG/MP3 signatures, matches the real game manifest art IDs and sound cue IDs, and reports `reusable-needs-integration`, `existingAssets.unbound`, and `existingAssets.invalid`. Reuse valid files rather than regenerate them. Existing files are **not** automatically part of the running game: bind them to actual drawing/animation or audio events. The packer rejects assets with no detectable runtime draw/play route, while manifest-driven dynamic renderers still require art validation and actual playtesting. Generate, bind, and test in small increments.

## Godot native Game Studio (automatic on demand)

For complex action / 2.5D / 3D games, Phoenix now has a **real** Godot starter
and CLI bootstrap, plus a separate HTML5 chat delivery path.

```sh
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs route --genre "beat-em-up" --delivery desktop --quality production
node examples/game-studio/godot/bootstrap.mjs doctor
node examples/game-studio/godot/bootstrap.mjs setup --project "PATH/TO/NEW/GAME" --allow-install
node examples/game-studio/godot/bootstrap.mjs verify --project "PATH/TO/NEW/GAME"
```

- Detects an existing Godot 4 executable first; otherwise, with the user's
  installation authorization, invokes allowlisted WinGet/Homebrew/Flatpak
  install and verifies the real executable. Windows WinGet package locations
  work even if the current terminal PATH has not refreshed.
- Creates the source project from `examples/game-studio/godot/starter` **only in
  a new game directory**. Never overwrites existing Godot scenes and art.
- Verifies an actual Godot `--headless --import`, `res://tests/smoke.gd`, and
  120-frame headless run, not just a version string or a static JSON manifest.
- The Godot starter has basic interactive hero/boss combat states but is an
  **art/audio prototype**; Kira must replace geometric drawings with approved
  actor atlases, bosses, effects, scenery, recorded sounds and music, then run
  actual in-editor/capture/listening QA. No sampled voice/audio ships here.
- For complex **in-chat** games, Godot is the authoring tool while the playable
  Phoenix message remains a separate single-file HTML5/Canvas artifact.
  A Godot Web export's HTML alone lacks its JS/WASM/PCK dependencies.
- Godot AI is optional: on Godot 4.7+ use the pinned addon and the authenticated
  dock-created MCP bridge; the setup command does **not** falsely declare a
  Godot AI editor connected just because the native engine works.

## Reusable animated gameplay + sampled audio (October 2026)

The shooter reference now includes an interactive magic pulse (L, cooldown), short-range whip attack (H), moving/telegraphing multi-phase boss AI with aimed bolts, fan volleys and ground waves, extra audiovisual combat feedback and a soundtrack with percussion. This remains an **illustrated-art prototype**, not a commercial-grade soundtrack or professional voices.

- In `game-kit.js`, call `drawSpriteState(ctx, image, atlas, state, seconds, x, y, width, height, face)` to render **actual different frames** from an embedded sprite atlas. The function returns false for a missing or invalid animation; a concept picture by itself does not count. `advanceBoss(boss, player, dt, fire)` emits real projectiles only after a visible windup; `activateAbility(actor, seconds, cooldown)` limits power spam.
- The Jungle Echo runtime reads `art.hero`, `art.enemies[]`, `art.bosses[].phaseAnimations`, `art.backgrounds[]`, `art.weapons[]`, `art.projectiles[]`, `art.powers[]`, `art.props[]`, `art.effects[]`. When those assets exist it draws embedded PNGs in place of fallback shapes; preserve the actual identifiers and frame dimensions. For final art, remove all prototype fallbacks and verify each frame against the approved design.
- The local bundler accepts a combined `assets.json` with `images` and `audio` lists. Give recorded cue IDs of the form `phoenix-audio-shoot`, `phoenix-audio-whip`, `phoenix-audio-power`, `phoenix-audio-boss`, `phoenix-audio-music`, and `phoenix-audio-voice-victory` when the respective original/licensed WAV/OGG/MP3 files exist. Run `node examples/game-studio/embed-game-assets.mjs game.html assets.json packed.html`. Every sound is embedded as a data URI for offline playback. Browser sound begins only after user interaction; M toggles mute.
- No professional sample library or recorded human voice is bundled with the demo. Procedural sound is a fallback only. To meet a request for high-quality voices/gunshots/whips, Kira must produce or import the actual authorized source audio, map every cue to its gameplay event, and hear it in a browser before calling the game complete.
- Verify with `pnpm exec vitest run examples/game-studio/tests packages/hardness/adapters/tests/game-art.spec.ts`, then run the produced HTML in a real browser. Structural tests cannot establish visual or auditory quality.

## Publisher manifest and art assets

Game Studio uses the **real** `phoenix_game` model tool to publish playable self-contained HTML in the Phoenix chat. Its `phoenix-game-manifest` JSON must truthfully describe the shipped game; a missing manifest is a **structural error**, not proof that JavaScript failed to start. A blank view must be diagnosed using the game runtime and browser console.

- Reference metadata files: `jungle-echo.manifest.json` (shooter) and `lumen-circuit.manifest.json` (puzzle). They describe real example implementations; do not copy a shooter manifest into a racing or puzzle game.
- For sprites, prepare a local `images.json` like `{"images":[{"id":"hero-art","path":"assets/hero-atlas.png"},{"id":"jungle-bg","path":"assets/jungle.png"}]}` and run `node examples/game-studio/embed-game-assets.mjs input.html images.json with-assets.html`. PNG bytes are embedded before gameplay code in the offline HTML.
- Use `pnpm exec tsx examples/game-studio/prepare-game.ts with-assets.html manifest.json publishable.html` for structural preflight and one correct embedded manifest. The tool rejects mismatched/duplicated metadata and does not invent missing behavior.
- Illustrated character games explicitly declare `art.mode`: `prototype` when sprites/animation are not ready, or `production` when the approved hero and background PNGs are embedded. Production art declares `art.designReference`, `art.hero.imageId`, `frameWidth`, `frameHeight`, frame indices for idle/run/jump/fall/shoot/hurt/death, and `art.backgrounds[].imageId`. The game tool rejects art files that are missing, unrelated to the runtime or never used by `drawImage`.
- A high-quality concept portrait does **not** count as an animated playable hero. Cut actual transparent sprite atlas frames, bind them to animation states, execute the game and compare screenshots from running/aiming/shooting against the approved character design.

## Verification and limits

- Deterministic JavaScript frame and input smokes exercise the supplied source code, including directional character motion and puzzle interactions.
- Source or metadata checks **do not constitute** visual QA, animation comparisons or audible playback tests. Verify any new game using real browser/device screenshots, animation recordings, audio listening, input and performance measurements.
- Procedural character shapes, oscillator audio and simple opponent decisions are technical references, not a substitute for consistent authored sprite atlases, detailed scenery, multi-layer sound mixes, licensed or original character art and polished gameplay balancing.
- Kira's `.agents/skills/phoenix-game-studio/SKILL.md` describes genre routing, actual source research, specialist collaboration, animation and assets, game QA and stopping conditions.
