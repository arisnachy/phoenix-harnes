---
name: phoenix-game-studio
description: Build or improve playable 2D/2.5D/3D video games in PHOENIX using Kira and La Forja; research references, original art, character and boss animation, level design, physics, audio, game QA, and deliver a real running artifact. Use for "haz un juego tipo Contra", game characters, enemies, bosses, sprites, platformer, shooter, 2D/3D levels, soundtracks, or broken game mechanics.
---

# PHOENIX GAME STUDIO · La Forja

This skill is an executable workflow, not a statement that a game already exists. On game requests **Kira must complete the artifact**, verify it with the available runtime, show it in the conversation when possible, and report remaining gaps. Never claim that rendering, audio, AI, screenshots, or actual gameplay passed unless observed.

## 1. Research before art

- If the user references a game such as Contra, search for publicly available original gameplay footage and screenshots (not just its cover): protagonist proportions, animations/poses, run/jump/shoot/aim, enemy taxonomy, boss telegraphs and phases, parallax, scrolling, encounter pacing, HUD, explosion timing, soundtrack and sound effects.
- Record concrete source URLs and observations in a short reference table. Distinguish researched facts from design choices. Web search failure must not be represented as research completed; continue with explicit uncertainty.
- Abstract **mechanics** and art direction from these references. Do not copy copyrighted character designs, tiles, audio, maps, logos, names, or unlicensed sprites. New games must have original identities.
- Choose one unified art bible BEFORE generating batches of assets: canvas resolution, palette, outline, pixel density, shading, animation fps, silhouettes, collision bounds, camera scale, layers, material cues, lighting and audio style.
- Asset sourcing: use self-generated original art or verified CC0/compatible licenses. Track provenance/attribution per file. Do not assume a search result permits reuse.

## 2. Bounded specialist work in the same Kira conversation

Kira owns the approved objective, handles research and integration, and launches at most THREE actual workers concurrently:
1. **Art / motion**: original protagonist, enemy families, spritesheets with matching frames, animations, VFX, design coherence and atlas export.
2. **Combat / level**: physics, aim/fire, jump feel, platform coordinates, player/enemy finite-state machines, collision, boss phases, encounter pacing, camera.
3. **Audio / QA**: score and cues, actual audio playback on user gesture, visual/motion inspections, interaction tests, frame-time checks and bug reports.

A worker's message is not proof of tool execution. Require actual outputs, file paths, integration commit or observed playback/screenshot as appropriate. Reuse finished assets, avoid duplicated investigation, and stop workers once the acceptance gate is satisfied. No endless follow-up audit or HARDNESS loop after Kira closes.

## 3. Production contracts (mandatory for run-and-gun)

- **Protagonist**: consistent silhouette, texture/rig/spritesheet, idle/run/jump/fall/shoot/hurt/death states, readable timings and transitions, jump physics, aiming while airborne, landing anticipation and recoil. Draw actual temporal frames (not a static sprite translated across the screen). If an advanced engine is available prefer animation blending where needed.
- **Enemies**: distinct roles, silhouettes and states (move/attack/hurt/death), navigation, anticipation, reactions, finite health and collision, rate-limited spawning and avoid unfair offscreen shooting.
- **Boss**: at least two observable phases with attack telegraphs, weak points, different patterns, HP indicator and death sequence. Attack patterns must have an avoidable path.
- **Scenario**: sky/background/midground/foreground layers with 0..1 parallax scroll factors, playable tile/geometry/platform data, safe checkpoints and collision, responsive camera, contrast/readability. Don't use one giant picture as the level.
- **Audio**: score plan, jump/shoot/hit/explosion/boss cues, user-gesture unlock for browser audio, mute, independent volume/priority where practical, no undefined external URL. Verify speakers/headphones only with actual audio probes; code inspection alone cannot confirm perceived audio quality.
- **Visual polish**: particles, muzzle flash, hit flash, dust, lighting/weather only where they improve feedback; do not obscure hitboxes or controls.
- **Optimization**: delta/fixed timestep, disposal of animation loops, input on focus, mobile fallback where requested, bounded entities and particles. Prefer offline assets stored locally and predictable free tools.

## 4. Phoenix artifact delivery

- Default for immediate **in-chat playable 2D**: a completely self-contained HTML/Canvas/WebAudio artifact with MIME `application/vnd.phoenix.game+html`; support plain `text/html` if the tool does not advertise the new MIME. PHOENIX runs executable HTML in a restricted iframe: **no external JS/CSS, no CDN, no fetch or network-loaded textures**. Inline code and data/blob assets only. Third-party Phaser or other engine dependencies must be bundled locally/inlined before preview, never hotlinked.
- For Godot or 3D projects, deliver runnable files plus the appropriate Phoenix artifact type; no claim that a native Godot project runs directly as HTML.
- The first vertical slice is **one polished playable level, one hero, two/three enemy varieties, one multi-phase boss, sound**. Build more levels only after the slice passes.
- Include a `<script id="phoenix-game-manifest" type="application/json">` block (escaped JSON) inside the artifact HTML. Contract:
  ```json
  {
    "schemaVersion": 1,
    "title": "Original Game Title",
    "genre": "run-and-gun",
    "references": [{"title":"researched footage", "url":"https://..."}],
    "player": {
      "states": ["idle","run","jump","fall","shoot","hurt","death"],
      "animations": {"idle":4,"run":8,"jump":2,"fall":2,"shoot":3,"hurt":2,"death":6}
    },
    "enemies": [{"id":"scout","states":["move","attack","hurt","death"]}],
    "bosses": [{"id":"boss-01","phases":["approach","barrage"]}],
    "level": {
      "layers":[{"id":"sky","scrollFactor":0},{"id":"trees","scrollFactor":0.4},{"id":"front","scrollFactor":0.8}],
      "platforms":[{"x":0,"y":400,"width":900}]
    },
    "controls":{"move":"Arrows/A-D","jump":"Space","shoot":"J"},
    "audio":{"cues":["jump","shoot","hit","explosion","boss"],"music":"original loop"},
    "sources":[{"path":"index.html","license":"original"}]
  }
  ```
  Do not fake these fields: every listed state/phase/cue/layer must have corresponding implemented behavior.

## 5. Verification and stop conditions

1. Run the game, not merely review source. Inspect at least one gameplay screenshot plus a short animation sequence. Verify visible changes between idle/run/jump/fall/shoot/hurt, actual enemy attack/death and both boss phases.
2. Exercise keyboard and optional touch controls, collision/fall/landing, scrolling, combat, restart, mute; inspect console errors. For automated browser tests use actual browser events and captured frames, not synthetic "passed" text. Use real engine/WebAudio output if validating playback.
3. Run deterministic code/schema checks and scene/resource license checks. Record any test that could not be run (especially Windows playback) as **unverified**.
4. Repair only broken requirements with bounded passes (2 per failed gate) and report any residual blockers; no silent low-quality fallback. For a fully completed artifact, Kira stops HARDNESS and workers: never reopen autonomous evaluation after the acceptance gate.
5. Deliver: playable artifact or project path; brief screenshot/animation evidence; controls; list of proven tests, unverified aspects, third-party attribution, exact SHA if published.

Starter/reference: `examples/game-studio/jungle-echo.html`. It is an original **technical baseline**, not licensed Contra artwork or a claim of final-quality art. Always improve the art according to the requested style.
