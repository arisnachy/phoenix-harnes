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

## Reusable articulated rigs + authored art (new)

The offline engines [2D](animation-engine.js) and [3D](animation-engine-3d.js), [rigged sprite bridge](rigged-art.js), [API and visual-art constraints](ANIMATION_ENGINE.md) and [playable mechanical demo](articulated-arena.html) are included. `PhoenixRiggedArt.actor` connects a decoded, original PNG atlas to a skeletal rig or a full-body flipbook clip; `actor.draw` renders the actual image, not substitute rectangles. For production shooters the complete art, per-entity animation, parallax and sound inventory in `packages/hardness/adapters/src/game-art.ts` is mandatory. No source test can certify that art looks professionally finished.
