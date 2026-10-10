---
name: phoenix-game-studio
description: Build or improve playable 2D/2.5D/3D video games in PHOENIX using Kira and La Forja; research references, original art, character and boss animation, level design, physics, audio, game QA, and deliver a real running artifact. Use for "haz un juego tipo Contra", game characters, enemies, bosses, sprites, platformer, shooter, 2D/3D levels, soundtracks, or broken game mechanics.
---

# PHOENIX GAME STUDIO · La Forja

## Motor nuevo de animación articulada y enlace con el arte (obligatorio)

**Kira debe leer** `examples/game-studio/ANIMATION_ENGINE.md` antes de crear personajes animados o aceptar un sprite del protagonista. Están implementados:

- `examples/game-studio/animation-engine.js` — motor jerárquico 2D para huesos, cinemática directa/inversa CCD, restricciones, transiciones, keyframes, animaciones superpuestas, accesorios y atlas por estado.
- `examples/game-studio/animation-engine-3d.js` — matemáticas de esqueletos 3D, cuaterniones, IK, mezcla de poses y asignación a huesos existentes. Un videojuego 3D terminado **requiere además** mallas con pesos, deformación y un motor render/física real; esto no es un sustituto de Godot/Three/Unreal/Unity.
- `examples/game-studio/rigged-art.js` — puente REAL entre atlas PNG original, los huesos y la ejecución del juego. Elegir `animationMode:"flipbook"` para sprites cuerpo entero o `"skeletal"` con `art.parts[boneId].states` y pivotes cuando se quiere animación articulada por piezas. Si faltan piezas, el puente falla: **jamás remplazar personajes por rectángulos de Canvas**.
- `examples/game-studio/articulated-arena.html` — integración técnica jugable y offline, NO arte final. No publicar su estilo geométrico como videojuego profesional.

**Patrón obligatorio de integración:**

```js
const heroImage = document.getElementById('hero-art'); // PNG embebido y realmente cargado
const heroActor = PhoenixRiggedArt.actor({
  engine: PhoenixArticulation, image: heroImage, art: manifest.art.hero,
  rig: realCharacterRig, clips: realCharacterClips, initial: 'idle'
});
function update(dt) { heroActor.play(currentState, { fade: 0.14 }); heroActor.update(dt); }
function render(ctx) { heroActor.draw(ctx, player.x, player.y, player.facing); }
```

La biblioteca debe estar **inline** con el motor dentro del HTML `phoenix_game`, nunca usar CDN ni links a archivos del repo en el visor aislado. `art.hero.imageId` debe existir como `<img hidden id="hero-art" src="data:image/png;base64,...">`. Para esqueletos 2D, segmentar el atlas en piezas coherentes, asignarlas a todos los huesos visibles y sincronizar armas/efectos con `actor.socket(...)`; para sprites frame-by-frame, no fingir que existe articulación completa. El validador `game-art.ts` reconoce PNG dibujado mediante `heroActor.draw`, pero esa comprobación de código **no demuestra** calidad artística.

**GATE VISUAL para juegos similares a Contra/Metal Slug:** no aprobar si el protagonista es un bloque, los enemigos son el mismo rectángulo recoloreado, el bosque son triángulos repetidos, las armas no están vinculadas al personaje o los sprites aprobados solo están en un PNG sin entrar en la partida. Validar con capturas reales del menú, juego en movimiento, ataque, salto, varios enemigos, jefe, derrota y victoria. Entregar la versión profesional solamente cuando TODOS los PNG originales por entidad/escenario/objeto y las animaciones estén integrados, el gameplay funcione y el audio se pruebe. Si se devuelve un prototipo, mostrar explícitamente **NO TERMINADO** y no dar la tarea como completada. La Forja máximo 3 agentes; detenerse al terminar o ante bloqueo real sin bucles.



This skill is an executable workflow, not a statement that a game already exists. For an in-chat playable game request, the output gate is an executable self-contained game artifact published with the real `phoenix_game` model tool into the conversation (`application/vnd.phoenix.game+html`), not image/png; a sprite sheet is an intermediate resource and is never task completion. Before any "tools unavailable" conclusion, inspect the real currently exposed game-development skill, available files/shell, team spawn, and game-HTML artifact publisher. `examples/game-studio/jungle-echo.html` is a shipped, already working offline *starting point* to extend when feasible; never misrepresent it as the newly requested polished game. If La Forja was explicitly requested, try a real spawn_teammate and verify the invocation. Do not claim full Game Studio is inaccessible because one image/asset pipeline fails. Maintain the last genuine user's language in Kira/teammate updates and after independent review. If no supported playable publisher really exists after verification, disclose the exact missing capability and keep a runnable deliverable in a supported accessible format where feasible. On game requests **Kira must complete the artifact**, verify it with the available runtime, show it in the conversation when possible, and report remaining gaps. Never claim that rendering, audio, AI, screenshots, or actual gameplay passed unless observed.

This skill is an executable workflow, not a statement that a game already exists. For an in-chat playable game request, the output gate is an executable self-contained game artifact published with the real `phoenix_game` model tool into the conversation (`application/vnd.phoenix.game+html`), not image/png; a sprite sheet is an intermediate resource and is never task completion. Before any "tools unavailable" conclusion, inspect the real currently exposed game-development skill, available files/shell, team spawn, and game-HTML artifact publisher. `examples/game-studio/jungle-echo.html` is a shipped, already working offline *starting point* to extend when feasible; never misrepresent it as the newly requested polished game. If La Forja was explicitly requested, try a real spawn_teammate and verify the invocation. Do not claim full Game Studio is inaccessible because one image/asset pipeline fails. Maintain the last genuine user's language in Kira/teammate updates and after independent review. If no supported playable publisher really exists after verification, disclose the exact missing capability and keep a runnable deliverable in a supported accessible format where feasible. On game requests **Kira must complete the artifact**, verify it with the available runtime, show it in the conversation when possible, and report remaining gaps. Never claim that rendering, audio, AI, screenshots, or actual gameplay passed unless observed.

## Preflight-first, not reject-first (Kira's first Game Studio action)

Before generating an HTML artifact or contacting the publisher, Kira must prepare a **truthful, genre-specific JSON manifest** for the actual game: `schemaVersion:1`, `title`, `genre`, `gameType`, `controls`, `level`, `audio` and only the player/enemy/boss/asset fields that correspond to implemented mechanics. Use `examples/game-studio/jungle-echo.manifest.json` or `lumen-circuit.manifest.json` as the *schema reference*, never as fake evidence of work. Track every requested component in the finite game-art production plan.

On the **first** call to `phoenix_game`, pass two separate inputs: `html` with the running standalone game and `manifest_json` containing the complete authored JSON **as a string**. The publisher deterministically inserts the exact required `<script id="phoenix-game-manifest" type="application/json">` before the close of `</body>`, and rechecks controls, level, audio and art. A manifest already embedded in HTML works unchanged; if correct JSON exists without the exact script `id`, the publisher repairs that wrapper. The publisher refuses contradictory or missing JSON and **never invents enemies, levels, controls or asset data**. There should never be a first upload rejected solely for forgetting the HTML manifest wrapper.

Do not waste another Kira/La Forja turn saying "Phoenix requires JSON; I will now add it": the tool schema and this skill already provide the contract. Fix missing actual fields *before* tool publication and show any genuine remaining failure clearly. Passing the structural gate is not proof of playtesting, visual quality or soundtrack.

## Mandatory complete cast and world — hero atlas is not a game

For representational action games, Kira must not stop after generating a single protagonist sheet. Before requesting artwork, finalize the real entity list (all protagonist states, **every enemy family**, an animated **boss with all phases**, weapons, projectile sprites, powers/pickups, scenery at each parallax depth, props/interactive obstacles, VFX and music/SFX). Execute `node examples/game-studio/plan-game-assets.mjs manifest.json plan.json` to create the finite production worklist; assign real deliverables to La Forja (motion/characters, gameplay/world, audio/QA), with at most three actual workers and one integration owner. A pending task or beautiful standalone PNG is NOT finished game evidence.

For `art.mode="production"` run-and-gun, the publisher requires `art.hero`; per-entity `art.enemies[]` and `art.bosses[]`, including real `phaseAnimations` for each phase; `art.backgrounds[]` matching all `level.layers[].id`; and `art.weapons[]`, `art.projectiles[]`, `art.powers[]`, `art.props[]`, `art.effects[]`. Each entry must identify a distinct, embedded original PNG and appear in actual Canvas drawing calls. Enemies and bosses need sprite-grid data and states, and boss phase frames must map to real atlas indices. Use stable art bible and matching sprite scales across the whole game. Integrate moving, jumping, aiming, shooting, enemy AI, boss phases, collisions, pickups, parallax and sound before delivery. A game missing categories cannot be called production complete even if the character reference art looks excellent; mark it as `prototype` and continue only until the requested acceptance gate is truly satisfied.

The gate is code-structural, not visual inspection: review screenshots of the **rendered protagonist, enemies, boss and world** alongside the approved art. Reject boxes, palettes, empty backgrounds and unused sheets when the user requested detailed art. If generation/import is blocked, report the real blocker and keep the incomplete status instead of faking results. Genre-specific games without combat should not get phantom bosses or weapons.

## Mandatory first-pass game publishing handshake

Game Studio does not need Kira to discover the contract by repeated failed publication. Start from the **shipped genre-matching manifest example** in `examples/game-studio/jungle-echo.manifest.json` or `lumen-circuit.manifest.json`. Kira must create a truthful manifest from the actual game source, not invent bosses, sprites, events or levels to satisfy validation. The real publisher is the model tool `phoenix_game` (not `image_generation` and not `phoenix_canvas`), and it expects complete inlined HTML in the `html` argument. For local packaging use:

```bash
node examples/game-studio/embed-game-assets.mjs input.html images.json with-assets.html
pnpm exec tsx examples/game-studio/prepare-game.ts with-assets.html manifest.json publishable.html
```

The first command inserts the exact local PNG bytes as hidden `<img id="..."> data:image/png;base64` **before gameplay scripts**. The latter validates and adds one `<script id="phoenix-game-manifest" type="application/json">` if missing; it does not invent source content. When no images are required (board/puzzle) omit the first command. JSON is *structural metadata*, not a boot dependency; a blank view can instead mean a JavaScript exception, image load, blocked resource, CSP or invalid renderer. Distinguish those causes. Publish exactly once after preflight succeeds, then verify actual running gameplay and screenshot. Retry only the failing stage, bounded to two repairs.

For **representational characters**, generated concept art must become a rendered, animated sprite atlas. `phoenix_game` requires explicit `art.mode`: `production` with an actual embedded `art.hero` atlas, `designReference`, source-correct frame indices and `art.backgrounds` drawn with `drawImage`; or `prototype` with an explicit visible limitation. The contract catches unused images and fake metadata but cannot inspect visual identity, anatomical correctness or audio. Compare approved design to *real frame captures*; if the playable character still looks like an unrelated primitive, do not call the mission complete. Preserve the reference art supplied by the user without silently changing subject, proportions or outfit.

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
