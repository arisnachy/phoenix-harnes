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

## Verification and limits

- Deterministic JavaScript frame and input smokes exercise the supplied source code, including directional character motion and puzzle interactions.
- Source or metadata checks **do not constitute** visual QA, animation comparisons or audible playback tests. Verify any new game using real browser/device screenshots, animation recordings, audio listening, input and performance measurements.
- Procedural character shapes, oscillator audio and simple opponent decisions are technical references, not a substitute for consistent authored sprite atlases, detailed scenery, multi-layer sound mixes, licensed or original character art and polished gameplay balancing.
- Kira's `.agents/skills/phoenix-game-studio/SKILL.md` describes genre routing, actual source research, specialist collaboration, animation and assets, game QA and stopping conditions.


## Premium production contract

For new finished-game requests, Kira uses `productionTier: "polished"`, a required inventory of original/licensed art, characters/enemies/bosses, appropriate weapons, world, title/intro/pause/death/victory screens, story, soundtrack and event-bound SFX. Every `runtimeRef` needs an identifier in executable JavaScript outside manifest JSON, and enemy/boss IDs and animation states must match the runtime asset register. The `phoenix_game` publisher rejects an incomplete premium inventory; the UI preflight also reports specific deficits. See [premium asset pipeline](../../.agents/skills/phoenix-game-studio/references/premium-asset-pipeline.md).

**Important:** Existing Jungle Echo / Lumen Circuit are intentionally `prototype`-level technical baselines. An art inventory with function names can still be fake or ugly: only captured rendering, animation, gameplay and audio checks establish finish quality. A `polished` tier is not an automatic game generator or a quality certification.
