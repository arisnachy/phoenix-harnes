---
name: phoenix-game-studio
description: Build or improve playable 2D/2.5D/3D video games in PHOENIX using Kira and La Forja; research references, original art, character and boss animation, level design, physics, audio, game QA, and deliver a real running artifact. Use for "haz un juego tipo Contra", game characters, enemies, bosses, sprites, platformer, shooter, 2D/3D levels, soundtracks, or broken game mechanics.
---

# PHOENIX GAME STUDIO · La Forja

This skill is an executable workflow, not a statement that a game already exists. For an in-chat playable game request, the output gate is an executable self-contained game artifact published with the real `phoenix_game` model tool into the conversation (`application/vnd.phoenix.game+html`), not image/png; a sprite sheet is an intermediate resource and is never task completion. Before any "tools unavailable" conclusion, inspect the real currently exposed game-development skill, available files/shell, team spawn, and game-HTML artifact publisher. `examples/game-studio/jungle-echo.html` is a shipped, already working offline *starting point* to extend when feasible; never misrepresent it as the newly requested polished game. If La Forja was explicitly requested, try a real spawn_teammate and verify the invocation. Do not claim full Game Studio is inaccessible because one image/asset pipeline fails. Maintain the last genuine user's language in Kira/teammate updates and after independent review. If no supported playable publisher really exists after verification, disclose the exact missing capability and keep a runnable deliverable in a supported accessible format where feasible. On game requests **Kira must complete the artifact**, verify it with the available runtime, show it in the conversation when possible, and report remaining gaps. Never claim that rendering, audio, AI, screenshots, or actual gameplay passed unless observed.

## Godot AI v4 MCP · uso real del editor por Kira

**Aplica en juegos Godot, después de elegir engine=godot con el router**. El antiguo `mcp-godot-game-dev` es una entrada genérica y puede seguir desactivada: NO concluyas que Godot AI está conectado solo porque Godot aparece instalado. Para obtener edición de escenas en vivo utiliza el servidor autenticado **Godot AI**, namespace `godot-ai`, que el propio editor configura como cliente **DeepSeek Harness** en `$DSH_HOME/cordis.patch.yml`. Phoenix usa `@phoenix-ai/dsh-mcp-client`, mientras que el instalador oficial escribe `@deepseek-ai/dsh-mcp-client`; el adaptador de Phoenix convierte únicamente ese alias, preservando comandos, args, puertos y capabilities generados por Godot.

**Ruta de preparación, nunca en el arranque general de Phoenix:**

1. `game-tools.mjs doctor --target godot` y `game-tools.mjs doctor --target uv`. Godot AI **v4 exige Godot 4.7+**, no basta la comprobación genérica de Godot 4.x. Si no están listos, `game-tools.mjs ensure --target godot|uv --allow-install` solamente con autorización para instalar. Godot 4.5 y complemento v3 de la Asset Library que compartió el usuario no son el mismo protocolo: no afirmes compatibilidad sin migración verificada. Si el paquete instala una versión insuficiente, no declares listo.
2. `godot-ai-addon.mjs plan --project "RUTA_PROYECTO"`. En proyectos nuevos y autorizados: `godot-ai-addon.mjs install --project "RUTA_PROYECTO" --allow-install`; utiliza el ZIP de la release oficial **v4.3.0** con SHA-256 fijado, validación de rutas de ZIP y extracción aislada. **Nunca sobrescribas** `addons/godot_ai` ni la migración `addons/.godot_ai_update`; en instalaciones anteriores usa Update/Migrate del dock oficial.
3. Abre el proyecto en **Godot 4.7+**, activa Godot AI en `Project Settings > Plugins` y, en el dock Godot AI, selecciona **DeepSeek Harness > Configure**. Este paso requiere editor vivo; no basta crear `plugin.cfg`. La versión 4 expone **`godot-ai attach` autenticado por stdio**, no URL HTTP simple ni tokens manuales. El dock configura versión y puertos. No inventes flags de `uvx`, puertos o capabilities.
4. Ejecuta `godot-ai-bridge.mjs doctor --project "RUTA_PROYECTO"` y, tras revisar el registro de la conexión emitido por el dock, `godot-ai-bridge.mjs sync --allow-config-edit`. El adaptador modifica únicamente `name: '@deepseek-ai/dsh-mcp-client'` del registro `mcp-godot-ai`, reemplazándolo por `@phoenix-ai/dsh-mcp-client`; falla cerrado ante duplicados, forma inválida o HTTP sin autenticación. Si el dock actualiza o reconfigura su entrada, ejecuta sync nuevamente. Reinicia/reconecta el HOST de Phoenix para cargar el registro MCP; no rehagas el `uvx` ni dupliques servidores.
5. **Prueba MCP real**: ejecuta `editor_state`, `scene_get_hierarchy` y `logs_read` del namespace **godot-ai**. Si hay varias sesiones, usa `session_activate` con el proyecto correcto. Comprueba que el servidor y el proyecto son los esperados antes de escribir. Si falla, reporta `no-connected-editor` y diagnostica la configuración sin declararlo conectado.

**Secuencia real de creación y QA:**

- Preparar `GAME_PLAN.md` y `art-bible` con referencias del género, atlas reales aprobados para héroe, tres enemigos y jefe, escenas y audio original/licenciado. Kira debe crear/integrar todos esos recursos en la escena; herramientas MCP no crean espontáneamente una dirección artística.
- Usar `scene_manage`/`scene_open`, `node_create`, `script_create`/`script_attach`, `animation_create`/`animation_manage`, `input_map_manage`, `camera_manage`, `filesystem_manage` y `batch_execute` según convenga. Probar que `AnimatedSprite2D`/`AnimationPlayer` efectivamente consumen atlas aprobados; sin sprites no usar `Sprite2D` de rectángulos como arte final.
- Ejecutar `test_run`, `project_run`, `game_manage` para entradas y movimientos, `editor_screenshot` con modo `game` y `logs_read`. Inspeccionar físicamente capturas reales contra arte de referencia y comprobar sonido con escucha humana cuando sea posible. Reiterar correcciones reales de combate, jefes, escenario y mezcla hasta superar el gate. Un estado MCP connected o `test_run success` **no** acredita calidad audiovisual, ni convierte automáticamente un proyecto Godot en HTML único jugable en Phoenix.
- Mantener seguridad: servidor en loopback autenticado, no copiar ni imprimir capabilities locales; no usar endpoint HTTP sin autenticación, no instalar plugins de fuentes ambiguas, no modificar escenas ajenas sin contexto ni autorizar por defecto programas en una máquina ajena. La telemetría del complemento puede deshabilitarse con `GODOT_AI_DISABLE_TELEMETRY=true`.

Para la documentación del servidor consulta **https://github.com/hi-godot/godot-ai** y el catálogo `docs/TOOLS.md`. La release fijada y el SHA provienen del repositorio oficial; el instalador de Phoenix NO afirma funcionamiento hasta verificar una sesión MCP y gameplay.

## Selección real del motor y herramientas (antes del primer preset)

**No presupongas Canvas ni Godot.** Decide por género y destino del resultado. Primero ejecuta el router determinista y presenta el plan:

```sh
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs route --genre "beat-em-up" --delivery desktop --quality production
```

- **Entrega Windows/macOS/Linux con combate 2D/2.5D complejo, animación de personajes y escenarios profesionales:** usa Godot 4 con proyecto nativo reproducible, escenas `AnimatedSprite2D`/`AnimationPlayer`, `TileMapLayer`, `Camera2D`, cuerpos físicos, enemigos que navegan por profundidad, música y efectos importados. Usa **Tiled** para mapas, atlases y propiedades de colisión; **FFmpeg** para convertir/codificar audio. En 3D usa también **Blender** para rigging/modelos. No generes sprites con rectángulos si se pidió arte representacional.
- **Entrega jugable *dentro del chat* Phoenix:** `phoenix_game` requiere HTML autocontenido; por tanto, usa motor HTML5/Canvas con PNG/audio embebidos y sprites del pipeline artístico, no un falso `index.html` Godot. Si además se produce proyecto Godot, entrega el proyecto/export aparte y prueba ambos. Los exports web Godot requieren WASM/PCK/JS, plantillas concordantes y servidor; no se insertan directamente en `phoenix_game` ni se presentan como único HTML.
- **Puzles y arcades pequeños:** evita descargar un motor pesado; HTML5/Canvas puede ser el motor final y aún requerirá arte/sonido según el usuario.

**Aprovisionamiento automático bajo demanda:** después del routing, por cada herramienta en `tools` ejecuta `doctor --target NOMBRE`. Si falta, ejecuta `ensure --target NOMBRE --allow-install` **solo si la misión autorizó instalar software**; en ausencia de autorización consulta y espera. El `ensure` está limitado a gestores oficiales y destinos aprobados (Godot, Blender, Tiled, FFmpeg). No ejecutes `ensure` al arrancar Phoenix ni en una misión que no crea juegos. Verifica después con `doctor`; si winget instala una herramienta pero no aparece hasta reiniciar el terminal, conserva el estado NO LISTO, identifica la ruta `PHOENIX_GODOT_BIN`, `PHOENIX_BLENDER_BIN`, `PHOENIX_TILED_BIN` o `PHOENIX_FFMPEG_BIN` y revalida. Nunca supongas que el equipo del usuario ya está configurado ni declares instalado algo que no comprobaste. La autorización general del usuario debe persistir solo a través del mecanismo seguro de preferencias de Phoenix que esté realmente disponible; no fabriques consentimiento.

**Puerta previa a producción artística:** mantén una `art-bible` única (siluetas diferenciadas del héroe/enemigos/jefe, paleta, escala, perspectiva, estados, fondos y mezcla sonora). Ejecuta el plan de assets, produce y valida **cada** atlas/tileset/audio antes de importarlo al motor; comprueba coordenadas, transparencia, `AnimationPlayer` o `AnimatedSprite2D`, eventos de sonido y capturas de gameplay. Un Godot instalado o un `project.godot` creado no significa que un buen juego exista. Prueba movimiento real del protagonista/enemigos y ataques del jefe, no solo importación sin errores.

## Ruta obligatoria para juegos tipo Double Dragon / beat-em-up

**Nunca** uses el starter de disparos `jungle-echo.html` como sustituto del combate cuerpo a cuerpo. La plantilla inicial de CONTRATO es `examples/game-studio/street-brawler.manifest.json` y la base lógica reutilizable es `examples/game-studio/brawler-kit.js` (junto con `game-kit.js` para el dibujo de atlas). Ambos son herramientas intermedias: ni la plantilla ni el kit son un juego terminado.

1. **Referencia real antes de generar:** consulta 2–4 capturas, vídeos o fichas del juego citado (Double Dragon, Final Fight, Streets of Rage) y anota en `GAME_PLAN.md` cámara, escala, paleta, perspectiva 2.5D, animaciones, variedad de enemigos, ataques, escenarios, ritmo, música y FX. Conserva URL y fecha; si no tienes web, declara esa limitación en vez de fingir investigación. Inspírate en las mecánicas, **sin reproducir sprites, personajes, niveles o banda sonora con copyright**.
2. **Diseños completos primero:** prepara una biblia de arte y sprites PNG compatibles **para héroe, al menos 3 enemigos de distinta silueta, jefe con 2 fases y 2 ataques diferenciados**, dos zonas ilustradas, mínimo 3 planos de escenario, armas recogibles, objetos rompibles, sombras y partículas. Para cada actor exige `idle/run/jump/punch/kick/grab/hurt/death` o los estados aplicables; golpes y agarres necesitan más de un frame visible. Los presets aprobados deben convertirse en atlas transparentes con coordenadas reales, conectados a `imageId` y dibujados en el juego, no solo mostrados en el chat.
3. **Combate ejecutable:** movimiento continuo en X e Y de profundidad (belt-scrolling), colisiones por proximidad y profundidad, combos encadenados, hitstop/knockback, agarres y lanzamientos, IA que rodea y ataca con ventanas visibles, jefe que persigue, anticipa y cambia patrón/animación al perder vida. Conecta las entradas a funciones reales de `PhoenixBrawlerKit`; reproduce la captura de gameplay completa con cámara desplazándose.
4. **Sonido original de verdad:** tema en bucle, ambiente, puñetazo, patada, impacto, agarre, jefe, pickups y, si procede, voces originales/licenciadas; cada evento llama al reproductor adecuado tras el gesto de desbloqueo. Para decir `art.mode="production"`, exige `audio.mode="sampled-production"` con `<audio id="phoenix-audio-..."> ` cuyos bytes válidos estén embebidos, y prueba que se oyen. No utilices un tono de oscilador como si fuese banda sonora o un golpe profesional.
5. **Puertas reales antes de entregar:** ejecuta `node examples/game-studio/plan-game-assets.mjs manifest.json plan.json`, termina cada recurso pendiente, embebe imágenes y audio, comprueba `pnpm exec vitest run examples/game-studio/tests` y `pnpm exec tsx examples/game-studio/prepare-game.ts ...`, juega en navegador y observa escenas comparables con capturas: idle/run, combo, agarre, cada enemigo, dos ataques y dos fases del jefe, desplazamiento por zonas, audio de acciones/música y pausa/reinicio. Informe de lag/collisions/errores. Una validación de metadatos no demuestra ninguna de estas pruebas.
6. **Publicación honesta:** si no hay recursos finales realmente integrados, `art.mode="prototype"` y entrega **prototipo incompleto**. No afirmes acabado profesional, ni detengas la misión por haber publicado un HTML con barras de vida o dos muñecos de bloques. Prioriza una sección pequeña pero totalmente acabada antes de ampliar fases.


## Preflight-first, not reject-first (Kira's first Game Studio action)

Before generating an HTML artifact or contacting the publisher, Kira must prepare a **truthful, genre-specific JSON manifest** for the actual game: `schemaVersion:1`, `title`, `genre`, `gameType`, `controls`, `level`, `audio` and only the player/enemy/boss/asset fields that correspond to implemented mechanics. Use `examples/game-studio/jungle-echo.manifest.json` or `lumen-circuit.manifest.json` as the *schema reference*, never as fake evidence of work. Track every requested component in the finite game-art production plan.

On the **first** call to `phoenix_game`, pass two separate inputs: `html` with the running standalone game and `manifest_json` containing the complete authored JSON **as a string**. The publisher deterministically inserts the exact required `<script id="phoenix-game-manifest" type="application/json">` before the close of `</body>`, and rechecks controls, level, audio and art. A manifest already embedded in HTML works unchanged; if correct JSON exists without the exact script `id`, the publisher repairs that wrapper. The publisher refuses contradictory or missing JSON and **never invents enemies, levels, controls or asset data**. There should never be a first upload rejected solely for forgetting the HTML manifest wrapper.

Do not waste another Kira/La Forja turn saying "Phoenix requires JSON; I will now add it": the tool schema and this skill already provide the contract. Fix missing actual fields *before* tool publication and show any genuine remaining failure clearly. Passing the structural gate is not proof of playtesting, visual quality or soundtrack.

## Mandatory complete cast and world — hero atlas is not a game

For representational action games, Kira must not stop after generating a single protagonist sheet. Before requesting artwork, finalize the real entity list (all protagonist states, **every enemy family**, an animated **boss with all phases**, weapons, projectile sprites, powers/pickups, scenery at each parallax depth, props/interactive obstacles, VFX and music/SFX). Execute `node examples/game-studio/plan-game-assets.mjs manifest.json plan.json` to create the finite production worklist; assign real deliverables to La Forja (motion/characters, gameplay/world, audio/QA), with at most three actual workers and one integration owner. A pending task or beautiful standalone PNG is NOT finished game evidence.

For `art.mode="production"` run-and-gun, the publisher requires `art.hero`; per-entity `art.enemies[]` and `art.bosses[]`, including real `phaseAnimations` for each phase; `art.backgrounds[]` matching all `level.layers[].id`; and `art.weapons[]`, `art.projectiles[]`, `art.powers[]`, `art.props[]`, `art.effects[]`. Each entry must identify a distinct, embedded original PNG and appear in actual Canvas drawing calls. Enemies and bosses need sprite-grid data and states, and boss phase frames must map to real atlas indices. Use stable art bible and matching sprite scales across the whole game. Integrate moving, jumping, aiming, shooting, enemy AI, boss phases, collisions, pickups, parallax and sound before delivery. A game missing categories cannot be called production complete even if the character reference art looks excellent; mark it as `prototype` and continue only until the requested acceptance gate is truly satisfied.

The gate is code-structural, not visual inspection: review screenshots of the **rendered protagonist, enemies, boss and world** alongside the approved art. Reject boxes, palettes, empty backgrounds and unused sheets when the user requested detailed art. If generation/import is blocked, report the real blocker and keep the incomplete status instead of faking results. Genre-specific games without combat should not get phantom bosses or weapons.

## Preset-to-play contract (enforced by Kira for every illustrated action game)

**Presets are input resources, not a complete game.** After a user approves a protagonist, enemy, boss, effect or stage image, Kira MUST store its original exported PNG bytes, create transparent frame-atlas poses, and bind the image ID to an actual runtime actor. Use `examples/game-studio/embed-game-assets.mjs` before publishing. An isolated concept portrait or a metadata-only art object never passes acceptance. The same rule applies when generated art arrives from Canva, an image model, Figma, Godot or an MCP integration.

- **Default playable 2D foundation:** start from `examples/game-studio/jungle-echo.html` (prototype), reusing `examples/game-studio/game-kit.js` for real `drawSpriteState(ctx, image, atlas, state, seconds, ...)`, `advanceBoss(boss, hero, dt, fire)`, and `activateAbility(actor, elapsed, cooldown)`. Do not silently replace the approved sprite with `drawHumanoid`, rectangles or a generic drawing. Such fallback is acceptable only when explicitly marked `art.mode=prototype`; never report production art as finished.
- **Hero:** actually load `art.hero.imageId`, map real frame indices in `art.hero.animations`, route input/physics to the animation state (idle/run/jump/fall/attack/hurt/death plus requested magic/whip/other powers), and use the appropriate changing atlas frame every tick. Coordinate the hand, weapon, muzzle, projectile and hitbox; do not merely translate one still image.
- **Enemy and boss roster:** for each `enemies[].id` and `bosses[].id`, look up its distinct `art.enemies[]` or `art.bosses[]` atlas. Use boss `phaseAnimations` and actual `advanceBoss` AI, with movement, readable windup, attack emissions, projectile collision, alternate patterns, health thresholds and genuine death cleanup. A stationary HP rectangle with attacks only described in JSON is blocked.
- **Effects and scenery:** draw each `art.backgrounds[]` layer at its declared parallax ratio and integrate `art.weapons[]`, `art.projectiles[]`, `art.powers[]`, `art.props[]`, `art.effects[]` via runtime `drawImage` calls. Tie VFX to combat events; unused embedded assets FAIL.
- **Abilities are gameplay mechanics:** define input, resource/cooldown, anticipation, damage or effect, particle effect and concrete sound cue. Exercise each ability with input tests and runtime animation frames. Always include an attack-capable protagonist and two real boss attack patterns when the genre/request is combat-oriented.
- **Recorded sound and voices:** when the requested soundtrack and action effects have been authored and embedded, use \`audio.mode="sampled-production"\` in the published manifest; the Game Studio tool enforces actual embedded audio elements for every cue, music and declared voice and a playback route. Otherwise mark the audio as a prototype and tell the user what samples are still missing. For requested polished sound, prefer original, licensed WAV/OGG/MP3 cues and soundtrack. Embed bytes using an asset manifest such as `{"images":[{"id":"hero-art","path":"art/hero.png"}],"audio":[{"id":"phoenix-audio-shoot","path":"audio/shot.wav"},{"id":"phoenix-audio-whip","path":"audio/whip.wav"},{"id":"phoenix-audio-power","path":"audio/magic.ogg"},{"id":"phoenix-audio-boss","path":"audio/boss-hit.wav"},{"id":"phoenix-audio-music","path":"audio/battle-theme.ogg"},{"id":"phoenix-audio-voice-victory","path":"audio/victory.ogg"}]}`. Attach each corresponding cue to the in-game action, with play/pause, looping soundtrack and mute. Handle browser autoplay restrictions by unlocking audio only after a user interaction. **Never label an oscillator/beep as a professional gunshot, whip, orchestral score or human voice.** If original/authorized voice recordings were not created or imported, mark voices as not available and do not claim they exist.
- **Proof gate:** run `pnpm exec vitest run examples/game-studio/tests` and `pnpm exec tsx examples/game-studio/prepare-game.ts game.html manifest.json checked.html` (on actual generated files), then execute the playable game in the available browser. Inspect real frame captures of hero idle/run/attack, each enemy action, boss windup/attacks/phase transition/death, power effects, camera movement and sound-trigger timing. Structural preflight is not enough; actual visual and audible QA needs real capture/listening and evidence. Missing screenshots, missing sound playback, missing licensed samples or unavailable browser must be reported as **unverified**, never silently replaced by an invented success.
- **Kira completion rule:** no "finished" answer with hero-only image, frozen boss, no combat powers or silent action game when these were requested. Continue within the authorized bounded workflow to deliver a testable slice; when genuinely blocked, give the runnable partial artifact, state exactly which resources or capability are missing, and do not misrepresent it as finished. After the final status, stop HARDNESS and agents universally.

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
