---
name: phoenix-game-studio
description: Build or improve playable 2D/2.5D/3D video games in PHOENIX using Kira and La Forja; research references, original art, character and boss animation, level design, physics, audio, game QA, and deliver a real running artifact. Use for "haz un juego tipo Contra", game characters, enemies, bosses, sprites, platformer, shooter, 2D/3D levels, soundtracks, or broken game mechanics.
---

# PHOENIX GAME STUDIO · La Forja

This skill is an executable workflow, not a statement that a game already exists. For an in-chat playable game request, the output gate is an executable self-contained game artifact published with the real `phoenix_game` model tool into the conversation (`application/vnd.phoenix.game+html`), not image/png; a sprite sheet is an intermediate resource and is never task completion. Before any "tools unavailable" conclusion, inspect the real currently exposed game-development skill, available files/shell, team spawn, and game-HTML artifact publisher. `examples/game-studio/jungle-echo.html` is a shipped, already working offline *starting point* to extend when feasible; never misrepresent it as the newly requested polished game. If La Forja was explicitly requested, try a real spawn_teammate and verify the invocation. Do not claim full Game Studio is inaccessible because one image/asset pipeline fails. Maintain the last genuine user's language in Kira/teammate updates and after independent review. If no supported playable publisher really exists after verification, disclose the exact missing capability and keep a runnable deliverable in a supported accessible format where feasible. On game requests **Kira must complete the artifact**, verify it with the available runtime, show it in the conversation when possible, and report remaining gaps. Never claim that rendering, audio, AI, screenshots, or actual gameplay passed unless observed.


## 0. Default high-fidelity production pipeline

For **finished or high-quality game** requests, **Kira must use `productionTier: "polished"`** in the HTML game manifest, never silently emit a prototype and call it finished. Read [premium asset pipeline](references/premium-asset-pipeline.md) before designing or publishing. The HTML publisher and the UI audit now reject missing production roles/screens/audio and missing referenced runtime identifiers when the premium tier is selected. This is a *source integrity* check, not a measure of beauty or gameplay. Existing examples without the tier are technical prototypes.

When the user says "game like X", verify actual gameplay reference footage/screenshots and compare gameplay loops, art, characters, enemies, boss, weapons, story beats, title sequence, HUD, animation and soundtrack. Research first, design a new original game with its own artistic identity next. A game with a nice hero illustration but missing designed enemies, props, maps, UI and SFX is **incomplete**; do not publish it as a finished premium game.

Mandatory order: references -> style/story/audio bible -> cast/environment/weapon/UI asset register -> independently produced assets -> rig/atlas/import -> **bind every resource to in-game rendering and real gameplay** -> QA screenshots/audio/playthrough -> publish and stop. Keep original art and licensed provenance; never copy proprietary game assets. When a production backend isn't available, report the actual blocker and honestly label the runnable fallback as prototype.


## Phoenix Articulation Engine — mandatory capability discovery

For **articulated characters, enemies, creatures, bosses, weapons and cutscenes**, first read `examples/game-studio/ANIMATION_ENGINE.md`. The reusable offline source-controlled runtimes are:

- `examples/game-studio/animation-engine.js` = multi-bone **2D hierarchy/FK/CCD-IK**, per-joint constraints, keyframed clips, layered/masked animations, transitions, frame events, spring recoil, sprite skins and sockets. Use **real authored sprite assets/atlas pieces** and test that they render as body parts, not just collision shapes.
- `examples/game-studio/animation-engine-3d.js` = **3D quaternions/FK/CCD-IK**, hinge limits, blending, socket transforms, retarget bone mapping, Three.js-like bone adapter. It is a **math/controller core**, not skinned-mesh renderer, GLB importer or replacement for native Blender/Godot/Unity/Unreal armatures and animation controllers. Use the selected 3D engine for vertex weights, deformation, facial rigs, physics and animation graphs.
- `examples/game-studio/articulated-arena.html` = a complete **offline playable technical example** with embedded engine, hero+enemy rigs, aim IK, attached weapon and boss phases. Copy its *integration pattern*, not its visual style or prototype-quality art.

Kira must route each genre to its animation needs: platformers use root movement/jump/contact; fighters use synchronized attacks, hit reactions and cancel windows; shooters use aim layers/recoil/weapon sockets; RPGs use directional locomotion, interaction and NPC gestures; 3D games use **actual skinned meshes** and appropriate runtime engine. Puzzle/racing/strategy games use rigs only when an articulated actor actually needs animation. Collect gameplay frame captures and audio evidence before claiming professional polish. Preserve the existing Game Studio publication manifest and offline iframe constraints. **Never generate only a pose atlas without wiring it to active in-game actors.**

## 1. Research before art

- If the user references a game such as Contra, search for publicly available original gameplay footage and screenshots (not just its cover): protagonist proportions, animations/poses, run/jump/shoot/aim, enemy taxonomy, boss telegraphs and phases, parallax, scrolling, encounter pacing, HUD, explosion timing, soundtrack and sound effects.
- Record concrete source URLs and observations in a short reference table. Distinguish researched facts from design choices. Web search failure must not be represented as research completed; continue with explicit uncertainty.
- Abstract **mechanics** and art direction from these references. Do not copy copyrighted character designs, tiles, audio, maps, logos, names, or unlicensed sprites. New games must have original identities.
- Choose one unified art bible BEFORE generating batches of assets: canvas resolution, palette, outline, pixel density, shading, animation fps, silhouettes, collision bounds, camera scale, layers, material cues, lighting and audio style.
- Asset sourcing: use self-generated original art or verified CC0/compatible licenses. Track provenance/attribution per file. Do not assume a search result permits reuse.

## Genre router — never force every game into a shooter

Select a concrete gameplay loop before drawing assets. The manifest may declare `gameType`: `run-and-gun`, `platformer`, `top-down-action`, `racing`, `puzzle`, `strategy`, `rpg`, `rhythm`, `simulation`, `3d`, or `custom`. Genre-specific preflight checks are implemented in `packages/client/ui-conversation/src/client/chat/game-studio-quality.ts`. `custom` must declare `mechanics`. A genre label does **not** create the gameplay logic automatically.

- **Platformer/action**: movement tuning, collision, coyote time and jump buffering if required, authored animation cycles, attack anticipation and camera motion.
- **Racing**: steering/braking physics, lap/track geometry, collision, opponents, camera dynamics and engine audio, not forced bullets or jump animations.
- **Puzzle/strategy**: deterministic rules, undo/restart, solvable or generated levels with verified solutions, keyboard/touch interaction, clear win/lose logic, adversarial tests.
- **RPG/adventure**: stateful inventory, dialogue, quests, persistence, combat only when designed, controllable NPCs and safe save/load.
- **Rhythm/music**: event timestamps tied to audio clock, latency calibration and input scoring; WebAudio playback must be tested after a user gesture.
- **3D/simulation**: scene graph and 3D assets, rig/animation controllers, camera, lights, physics/collisions and disposal; use WebGL-compatible inlined/bundled resources for chat and deliver native project files if necessary. Do not pretend Canvas 2D is a 3D engine.
- When the requirement spans several genres or engines, build one **playable genre-specific vertical slice** first, measure it, then generalize a reusable system.

## Character and asset production — coordinate the full body

For a polished original character, build a character turnaround/model sheet in the chosen art style, then derive independently visible action poses. The standard is joint continuity, consistent anatomy/proportions, anchored feet, coordinated torso balance, hands contacting the gun/tool, barrel direction matching projectile velocity, arm recoil, transition anticipation and clear silhouettes at gameplay scale. Audit walk cycles frame by frame, including alternating foot contact and swing, rather than accepting moving rectangles.

- Choose **sprite atlas** for frame-by-frame pixel/hand-painted 2D or **2-bone skeletal IK** for flexible articulated motion. Mix these only with explicit skinning/masks, aligned pivots, depth ordering and visible quality checks.
- Use original art generation or licensed assets when image capabilities are available; isolate transparent backgrounds, preserve proportions between every frame, define source atlas coordinates and anchor points, and optimize texture memory. A prompt to an image model is **not** proof that the sprite sheet is consistent.
- Include idle, movement, airborne, attack, hurt, death and genre-specific interaction where relevant. Provide directions (horizontal/vertical/diagonal or eight-way where requested), equipment-hand attachment, synchronized hitboxes and state transitions. For a 3D rig, validate bone hierarchy, inverse kinematics constraints, retargeting and root motion.
- **Game-kit reference:** `examples/game-studio/game-kit.js` exposes zero-dependency two-bone IK, articulated figure drawing, directional aim, deterministic animation frames, parallax mapping and a simple enemy decision primitive. Embed this script into a self-contained HTML artifact. It is a functional base, **not** high-resolution original art or advanced navigation AI.
- Author original sound effects/music or use correctly licensed sources; tie audio to actual action events, manage volume, overlap, mute and user-gesture unlock. Procedural oscillator tones are temporary game audio, not a substitute for professional composed and mixed music.

## Cross-genre evidence and limits

The source-controlled examples demonstrate **two different genres**: `jungle-echo.html` (run-and-gun with 2-bone limb animation, diagonal aiming, parallax, enemy telegraphs and procedural WebAudio) and `lumen-circuit.html` (interactive puzzle with connection checking, pointer and keyboard controls). Test the actual game requested — an example passing does not prove all genres work. The deterministic manifest audit checks only JSON structure and packaging; it does not see rendered quality, correctness of asset transitions, or heard audio. For delivery collect real browser screenshots/video or engine frame captures, animation state and directional tests, AI behavior tests, audio evidence and hardware-specific performance before stating production quality.

## 2. Bounded specialist work in the same Kira conversation

Kira owns the approved objective, handles research and integration, and launches at most THREE actual workers concurrently:
1. **Art / motion**: original protagonist, enemy families, spritesheets with matching frames, animations, VFX, design coherence and atlas export.
2. **Combat / level**: physics, aim/fire, jump feel, platform coordinates, player/enemy finite-state machines, collision, boss phases, encounter pacing, camera.
3. **Audio / QA**: score and cues, actual audio playback on user gesture, visual/motion inspections, interaction tests, frame-time checks and bug reports.

A worker's message is not proof of tool execution. Require actual outputs, file paths, integration commit or observed playback/screenshot as appropriate. Reuse finished assets, avoid duplicated investigation, and stop workers once the acceptance gate is satisfied. No endless follow-up audit or HARDNESS loop after Kira closes.

## 3. Production contracts (mandatory for run-and-gun; adapt to other genres)

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
