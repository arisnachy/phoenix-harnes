/** Task-specific quality requirements layered on HARDNESS completion. */

const MAX_REQUIREMENTS = 32

const GENERAL_REQUIREMENTS = [
  'The final result is complete, internally consistent, and usable without unfinished placeholders, scaffolds, mocks, or partial substitutes.',
  'Every critical behavior or conclusion is supported by reproducible evidence, deterministic verification, or independently inspectable output.',
  'Relevant failure modes, assumptions, edge cases, and limitations are checked rather than silently ignored.',
  'Every explicit mandatory acceptance criterion is mapped to concrete evidence that exercises that criterion; a green aggregate suite alone never closes an untested requirement.',
] as const

const SOFTWARE_REQUIREMENTS = [
  'Critical software behavior is covered by executable tests, type checks, or equivalent deterministic verification.',
  'Error handling, recovery paths, and important failure conditions are exercised and shown to behave robustly.',
  'Public error contracts are verified at the observable boundary: error/exception type plus every required message field, identifier, collection, or diagnostic detail.',
  'When scale, performance, memory, latency, depth, concurrency, or large cardinalities are material, bounded measurements and implementation inspection rule out avoidable superlinear time or space growth rather than merely showing one large input completes.',
  'Security boundaries, permissions, unsafe inputs, credentials, and externally controlled data are handled without avoidable exposure or unsafe defaults.',
] as const

const UI_REQUIREMENTS = [
  'Visual output is inspected in a rendered form or screenshot at the relevant viewport rather than inferred from source code alone.',
  'The interface remains coherent and usable across relevant responsive sizes without overlap, clipping, or inaccessible controls.',
  'Accessibility basics relevant to the surface, including semantics, keyboard use, readable contrast, and understandable labels, are verified.',
] as const

const RESEARCH_REQUIREMENTS = [
  'Material factual claims are traceable to appropriate sources, citations, or directly inspectable evidence.',
  'Unsupported claims, source contradictions, uncertainty, and material factual gaps are identified rather than presented as established fact.',
  'The reasoning and document structure are complete enough that a reviewer can follow how the evidence supports the conclusions.',
  'When current public primary sources are reachable, verify consequential facts by opening original pages or documents, not just reading third-party search snippets; never fabricate browsing success or a citation.',
  'Differentiate study design, sample size, publication date, evidence strength, conflicts of interest, and limitations when these materially affect interpretation.',
  'Do not repeat substantially identical searches or delegate duplicate source reviews after evidence is sufficient; report unavailable access and the remaining uncertainty explicitly.',
] as const

const DATA_REQUIREMENTS = [
  'The analysis is reproducible from identified inputs, transformations, assumptions, and calculations.',
  'Inputs, intermediate results, and outputs receive validation, sanity checks, or cross-checks appropriate to the analysis.',
  'Material data limitations, missingness, uncertainty, and interpretation risks are surfaced in the final result.',
] as const

const AUTOMATION_REQUIREMENTS = [
  'The automation or integration is verified end-to-end at its real boundary, including authentication and external hand-offs where available.',
  'Retries, idempotency, interruption, duplicate execution, and restart behavior are handled where the operation can be repeated or resumed.',
  'Credentials, authorization state, user data, and external inputs are kept within the intended security and permission boundaries.',
] as const

const GAME_REQUIREMENTS = [
  'The game is judged against current high-quality references in the same genre, platform, camera style, and art direction; a functional prototype, template look, or generic indie presentation is not an acceptable final quality bar.',
  'For a requested in-chat playable game, delivery requires the actual executable integrated game artifact and real gameplay acceptance evidence; a PNG, sprite sheet, design plan, or prose report can only be an intermediate, and a single image-generation receipt cannot close the mission. Verify available game skills, runtime, team and artifact-publishing tools before claiming the environment cannot build or play the game.',
  'When improving an existing game, capture the current runnable build as a baseline before material changes and compare it with a fresh candidate capture at a comparable scene, viewport, camera scale, and gameplay state. A request to make the game better cannot pass with no visible material improvement or with regressions in readability, actor identity, environment richness, UI integration, animation, feedback, or performance.',
  'Production asset work is tool-first when suitable tools are available: use real raster generation such as image_generation, pixel-art or tileset tooling such as Aseprite/Tiled, Blender or engine-native asset pipelines for 3D, and an appropriate audio pipeline. DOM/CSS/SVG/canvas primitives may implement rendering infrastructure but are not a substitute for final character, enemy, NPC, environment, portrait, texture, or effects art.',
  'When game creation or visual-quality work is in scope, asset-first scouting is concrete work, not prose: unless the user explicitly requires original assets, inspect multiple real candidate packs with web/browser/connector evidence, compare style and animation coverage, verify the exact source/license, then import the strongest coherent pack or generate only what is materially missing. Persist asset-manifest.json or asset-sourcing.json with provenance for external and generated assets.',
  'For top-down adventure/RPG presentation, the playable world must dominate the viewport and read as a composed game scene. A large persistent dashboard/sidebar that crowds the playfield, a sparse repeated-tile field, or tiny block-like actors fails completion unless the requested genre/reference explicitly justifies that presentation.',
  'Retro and top-down presentation must use a deliberate game-native visual language. SaaS/dashboard cards, oversized pills, generic browser grids, glassmorphism, or unrelated web-app chrome fail completion when they visually dominate the playfield unless the user explicitly requested that hybrid style.',
  'Graphics and art direction are cohesive and production-grade: lighting, composition, materials or pixel treatment, color, VFX, readability, UI, and scene density form one deliberate visual language rather than a collection of placeholders or mismatched assets.',
  'Characters have a clear visual identity, readable silhouettes, coherent proportions and materials, expressive animation, and presentation quality appropriate to the target style; generic mannequins, default rigs, or unfinished animation do not satisfy completion.',
  'Every visible gameplay actor—player, enemy, boss, NPC, ally, merchant, or creature—uses a deliberate production asset rather than exposing collision/debug primitives. Rectangles, boxes, circles, capsules, emoji, text glyphs, single flat blocks, default mannequins, or primitive meshes fail completion unless an explicitly requested abstract art direction makes that form intentional and visually evidenced.',
  'For 2D or pixel-art actors, completion requires role-readable silhouettes, coherent pixel density/palette/scale, clean transparency, and animation-state coverage appropriate to the role: locomotion in every relevant direction plus attack or telegraph, hurt, death, or interaction states where applicable. Collision geometry remains separate from rendered art.',
  'Visual evidence must inspect the current player plus representative enemy and NPC/interactive actors at normal gameplay scale and close enough to judge sprite/model detail; if any actor still reads as a placeholder, box-with-eyes, indistinct block, or unanimated prototype, the game remains incomplete.',
  'Environments provide atmosphere, depth, landmarks, environmental storytelling, navigational clarity, intentional lighting and set dressing, terrain transitions, structures where appropriate, and enough prop/vegetation variety and scene density to avoid sparse fields of repeated trees, rocks, or template-derived dressing.',
  'The cast follows a coherent character bible across the player, enemies, bosses, NPCs, allies, and merchants: silhouettes, proportions, palette/material language, role-specific details, and animation stay consistent while secondary actors remain visually distinct rather than simple recolors or placeholder variants.',
  'When the request includes an intro, opening, title sequence, menu, or cutscene, completion requires a production-quality boot/title/menu/intro flow with coherent art/audio, skippable behavior when appropriate, and a verified transition into actual gameplay rather than a placeholder text screen or direct drop into the level.',
  'Sound is a first-class quality surface: music, ambience, effects, UI feedback, spatial treatment where relevant, synchronization, loudness balance, loops, and transitions are reviewed in actual play rather than treated as optional polish.',
  'Gameplay feel is verified in a real runnable build or emulator: input response, movement, camera, collision, combat or interaction feedback, pacing, transitions, failure states, and moment-to-moment clarity must feel polished rather than merely function.',
  'Animation, particles, shaders, camera work, feedback, and other presentation effects support impact without sacrificing legibility or performance; the game meets its target frame-time, memory, loading, and platform constraints with measured evidence.',
  'Completion requires both technical evidence and audiovisual/play evidence from an executed game or ROM. Screenshots alone do not prove gameplay quality, and passing unit/build tests alone do not prove art, sound, animation, or feel quality.',
] as const

function requestText(need: unknown): string {
  try { return JSON.stringify(need).toLocaleLowerCase() } catch { return String(need).toLocaleLowerCase() }
}

function gameRequestText(need: unknown): string {
  if (need !== null && typeof need === 'object' && !Array.isArray(need)) {
    const record = need as Record<string, unknown>
    if (record.need !== undefined) return gameRequestText(record.need)
    if (typeof record.description === 'string') {
      return `${typeof record.kind === 'string' ? record.kind : ''} ${record.description}`.toLocaleLowerCase()
    }
  }
  return requestText(need)
}

function matches(value: string, pattern: RegExp): boolean { return pattern.test(value) }

// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const GAME_ACTION = /\b(?:create|build|make|develop|design|implement|program|improve|polish|fix|playable|crear|crea|haz|construir|desarrollar|desarrolla|diseñar|diseña|hacer|mejora|mejorar|programa|jugable)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Match the requested educational output before its game topic.
const GAME_EDUCATIONAL_OUTPUT = /\b(?:create|write|prepare|build|make|design|crea|crear|escribe|prepara|haz|diseña)\s+(?:(?!based\b|from\b|using\b|with\b|that\b|which\b|con\b|desde\b)[\p{L}\p{N}-]+\s+){0,5}(?:lesson|essay|article|lecture|tutorial|report|lecci[oó]n|ensayo|art[ií]culo|informe)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const GAME_EDUCATION = /\b(?:explain|teach|lesson|history|biology|essay|article|report|sales|revenue|explica|enseña|lecci[oó]n|historia|biolog[ií]a|ventas|informe)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the non-game target matcher auditable as one regex literal.
const GAME_NON_PLAYABLE_TARGET = /\b(?:dashboard|poster|diagram|illustration|logo|photograph|infographic|p[oó]ster|diagrama|ilustraci[oó]n)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const GAME_DOMAIN = /\b(?:game|games|gaming|juego|juegos|videogame|video-game|videojuego|videojuegos|unreal|unity|godot|pixel\s*art|rom|homebrew|platformer|metroidvania|rpg|shooter|gameplay)\b/u
const GAME_PLATFORM = /\b(?:ps1|psx|playstation|sega|nes|snes|genesis|mega\s*drive|master\s*system|game\s*gear|game\s*boy)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const GAME_GENRE = /\b(?:gta|sonic|zelda|mario|minecraft|doom|adventure|aventura|arcade|racing|racer|strategy|sports|rhythm|roguelike|roguelite|simulation|simulator|survival|fighting|puzzle|board|snake|pong|tetris|2048|chess|checkers|sudoku|breakout|arkanoid|minesweeper|ajedrez|damas|buscaminas)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const ABSTRACT_GAME = /\b(?:snake|pong|tetris|2048|chess|checkers|sudoku|breakout|arkanoid|minesweeper|ajedrez|damas|buscaminas|puzzle|puzle|rompecabezas|board\s+game|juego\s+de\s+mesa|geometric|geom[eé]tric[oa]|abstract|abstract[oa])\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const REPRESENTATIONAL_GAME = /\b(?:rpg|role[ -]playing|open[ -]world|mundo\s+abierto|npc|realistic|photorealistic|gta|zelda|mario|sonic|adventure|aventura|dungeon|platformer|metroidvania)\b/u
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-intent matcher auditable as one regex literal.
const REQUESTED_GAME_ASSETS = /\b(?:(?:external|original|custom|generated|licensed|downloaded|imported|animated|illustrated|hand-painted|extern[oa]s?|originales?|personalizad[oa]s?)\s+(?:\w+\s+){0,3}(?:assets?|sprites?|textures?|models?|characters?|backgrounds?|art|music|soundtrack|recursos|personajes?|fondos?|arte)|(?:assets?|sprites?|recursos|personajes?|fondos?|arte)\s+(?:extern[oa]s?|originales?|personalizad[oa]s?)|(?:character|background|personaje|fondo)\s+(?:sprites?|assets?|art|arte)|(?:import|download|generate|importa|descarga|genera)\s+(?:\w+\s+){0,3}(?:assets?|sprites?|textures?|models?))\b/u

/**
 * Identify game-development work from the capability request without requiring
 * one specific engine or platform name.
 * @param need - Capability request or descriptive need.
 * @returns Whether game-specific quality requirements and review apply.
 */
export function isGameDevelopmentNeed(need: unknown): boolean {
  const text = gameRequestText(need)
  if (GAME_EDUCATIONAL_OUTPUT.test(text)) return false
  if (GAME_NON_PLAYABLE_TARGET.test(text) && !/\b(?:game|juego|playable|jugable|gameplay)\b/u.test(text)) return false
  if (GAME_EDUCATION.test(text) && !(GAME_ACTION.test(text) && GAME_DOMAIN.test(text))
    && !/\b(?:playable|jugable|gameplay|videojuego)\b/u.test(text)) return false
  return GAME_DOMAIN.test(text)
    || (GAME_PLATFORM.test(text) && (GAME_ACTION.test(text) || GAME_GENRE.test(text)))
    || ((GAME_ACTION.test(text) || REQUESTED_GAME_ASSETS.test(text)) && GAME_GENRE.test(text))
}

/** Identify a game whose intended actors and arena use abstract geometry.
 * @param need Requested game genre and art direction.
 * @returns Whether genre-native geometric presentation applies instead of representational world/cast requirements.
 */
export function isAbstractGameNeed(need: unknown): boolean {
  const text = gameRequestText(need)
  return isGameDevelopmentNeed(need) && ABSTRACT_GAME.test(text) && !REPRESENTATIONAL_GAME.test(text)
}

/** Identify explicit asset work within an otherwise abstract game.
 * @param need Requested genre, presentation and assets.
 * @returns Whether requested character/background or external/original assets require a production asset pipeline.
 */
export function requestsGameAssets(need: unknown): boolean { return REQUESTED_GAME_ASSETS.test(gameRequestText(need)) }

/** Shared art review instructions for an abstract game without imposing a representational cast or world.
 * @param need Requested genre and asset scope.
 * @returns Genre-specific judge instructions with independent current-generation evidence gates.
 */
export function abstractGameReview(need: unknown): string {
  return 'This is abstract game-development work. Require three independent evidence gates from the current mutation generation: technical build/test/check evidence, visual capture inspected with read_image/screenshot, and executed gameplay/playtest evidence. None may substitute for another. '
    + 'Judge polished geometry, a compact designed arena or board, deliberate typography/palette, readable state, animation/feedback, integrated UI, procedural audio or suitable music/SFX, input response, rules, progression, failure/restart states, and measured performance in actual play. '
    + 'Compare against strong references in the intended board, puzzle or arcade genre. Geometric pieces and a compact playfield are final art when deliberately composed and visually evidenced. Require comparable baseline-before and candidate-after captures when improving existing work. '
    + (requestsGameAssets(need) ? 'The explicitly requested assets still require suitable production tooling, source/license checks for external assets and asset-manifest.json or asset-sourcing.json provenance. Require concrete scouting when external asset selection is in scope. ' : '')
}

const ABSTRACT_GAME_REQUIREMENTS = [
  'Judge the intended board, puzzle or arcade genre against strong current category references, with polished geometry, deliberate palette, typography, composition and readable game state; unpolished prototypes and unfinished placeholders fail completion.',
  'A compact designed arena or board is valid final work. Game-native UI, responsive layout, contrast and input affordances support the intended playfield without obscuring it.',
  'Procedural audio is valid final sound when intentional and reviewed in actual play: timing, loudness balance, loops, transitions and gameplay/UI feedback suit the genre.',
  'Verify rules, input response, gameplay feel, collision or piece interaction where relevant, scoring/progression, win/loss, pause/restart and meaningful edge cases through actual executed gameplay.',
  'Inspect animation, effects and visual feedback at normal play scale and measure relevant frame-time, memory, loading and platform constraints.',
  'When improving an existing game, require comparable baseline-before and candidate-after captures and reject material regressions or no visible improvement.',
  'Requested boot/title/menu/intro flows are polished, usable and verified through their transition into gameplay.',
  'Completion requires independent technical, visual-inspection and executed-play evidence from the current mutation generation; passing build/tests or screenshots alone cannot establish complete game quality.',
] as const

/**
 * Derive a bounded quality contract from a capability request. Generic
 * guarantees always remain; relevant domain requirements are appended.
 * @param need - Capability request, including its kind and descriptive fields.
 * @returns Bounded quality requirements the independent judge must evidence.
 */
export function qualityRequirementsForNeed(need: unknown): readonly string[] {
  const text = requestText(need)
  const requirements: string[] = [...GENERAL_REQUIREMENTS]

  if (matches(text, /\b(?:code|software|program|application|app|web|api|service|typescript|javascript|python|node|backend|frontend)\b/u)) {
    requirements.push(...SOFTWARE_REQUIREMENTS)
  }
  if (matches(text, /\b(?:ui|ux|visual|interface|dashboard|frontend|website|layout|responsive|design|presentation|slide)\b/u)) {
    requirements.push(...UI_REQUIREMENTS)
  }
  if (matches(text, /\b(?:research|report|document|paper|literature|evidence|review|study|citation|source)\b/u)
    || matches(text, /(?:^|[^\p{L}])(?:investigaci[oó]n|investigaciones|investiga(?:r)?|estudios?|evidencias?|fuentes?|citas?|art[ií]culos?|informes?|contrastar)(?=$|[^\p{L}])/u)) {
    requirements.push(...RESEARCH_REQUIREMENTS)
  }
  if (matches(text, /\b(?:analysis|analyze|analytics|data|dataset|spreadsheet|statistics|statistical|table|csv)\b/u)) {
    requirements.push(...DATA_REQUIREMENTS)
  }
  if (matches(text, /\b(?:automation|integration|connector|oauth|mcp|workflow|scheduler|scheduled|webhook|sync)\b/u)) {
    requirements.push(...AUTOMATION_REQUIREMENTS)
  }
  if (isGameDevelopmentNeed(need)) {
    if (isAbstractGameNeed(need)) {
      requirements.push(...ABSTRACT_GAME_REQUIREMENTS)
      if (requestsGameAssets(need)) requirements.push(GAME_REQUIREMENTS[2], GAME_REQUIREMENTS[3])
    } else requirements.push(...GAME_REQUIREMENTS)
  }

  return [...new Set(requirements)].slice(0, MAX_REQUIREMENTS)
}
