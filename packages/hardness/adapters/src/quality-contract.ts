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
  'When improving an existing game, capture the current runnable build as a baseline before material changes and compare it with a fresh candidate capture at a comparable scene, viewport, camera scale, and gameplay state. A request to make the game better cannot pass with no visible material improvement or with regressions in readability, actor identity, environment richness, UI integration, animation, feedback, or performance.',
  'Production asset work is tool-first when suitable tools are available: use real raster generation such as image_generation, pixel-art or tileset tooling such as Aseprite/Tiled, Blender or engine-native asset pipelines for 3D, and an appropriate audio pipeline. DOM/CSS/SVG/canvas primitives may implement rendering infrastructure but are not a substitute for final character, enemy, NPC, environment, portrait, texture, or effects art.',
  'Retro and top-down presentation must use a deliberate game-native visual language. SaaS/dashboard cards, oversized pills, generic browser grids, glassmorphism, or unrelated web-app chrome fail completion when they visually dominate the playfield unless the user explicitly requested that hybrid style.',
  'Graphics and art direction are cohesive and production-grade: lighting, composition, materials or pixel treatment, color, VFX, readability, UI, and scene density form one deliberate visual language rather than a collection of placeholders or mismatched assets.',
  'Characters have a clear visual identity, readable silhouettes, coherent proportions and materials, expressive animation, and presentation quality appropriate to the target style; generic mannequins, default rigs, or unfinished animation do not satisfy completion.',
  'Every visible gameplay actor—player, enemy, boss, NPC, ally, merchant, or creature—uses a deliberate production asset rather than exposing collision/debug primitives. Rectangles, boxes, circles, capsules, emoji, text glyphs, single flat blocks, default mannequins, or primitive meshes fail completion unless an explicitly requested abstract art direction makes that form intentional and visually evidenced.',
  'For 2D or pixel-art actors, completion requires role-readable silhouettes, coherent pixel density/palette/scale, clean transparency, and animation-state coverage appropriate to the role: locomotion in every relevant direction plus attack or telegraph, hurt, death, or interaction states where applicable. Collision geometry remains separate from rendered art.',
  'Visual evidence must inspect the current player plus representative enemy and NPC/interactive actors at normal gameplay scale and close enough to judge sprite/model detail; if any actor still reads as a placeholder, box-with-eyes, indistinct block, or unanimated prototype, the game remains incomplete.',
  'Environments provide atmosphere, depth, landmarks, environmental storytelling, navigational clarity, and intentional lighting and set dressing without looking empty, repetitive, or template-derived.',
  'Sound is a first-class quality surface: music, ambience, effects, UI feedback, spatial treatment where relevant, synchronization, loudness balance, loops, and transitions are reviewed in actual play rather than treated as optional polish.',
  'Gameplay feel is verified in a real runnable build or emulator: input response, movement, camera, collision, combat or interaction feedback, pacing, transitions, failure states, and moment-to-moment clarity must feel polished rather than merely function.',
  'Animation, particles, shaders, camera work, feedback, and other presentation effects support impact without sacrificing legibility or performance; the game meets its target frame-time, memory, loading, and platform constraints with measured evidence.',
  'Completion requires both technical evidence and audiovisual/play evidence from an executed game or ROM. Screenshots alone do not prove gameplay quality, and passing unit/build tests alone do not prove art, sound, animation, or feel quality.',
] as const

function requestText(need: unknown): string {
  try { return JSON.stringify(need).toLocaleLowerCase() } catch { return String(need).toLocaleLowerCase() }
}

function matches(value: string, pattern: RegExp): boolean { return pattern.test(value) }

/**
 * Identify game-development work from the capability request without requiring
 * one specific engine or platform name.
 * @param need - Capability request or descriptive need.
 * @returns Whether game-specific quality requirements and review apply.
 */
export function isGameDevelopmentNeed(need: unknown): boolean {
  return matches(requestText(need), /\b(?:game|games|gaming|juego|juegos|videogame|video-game|videojuego|videojuegos|unreal|unity|godot|blender|pixel\s*art|nes|snes|genesis|mega\s*drive|master\s*system|game\s*gear|game\s*boy|rom|homebrew|platformer|metroidvania|rpg|shooter|gameplay)\b/u)
}

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
  if (matches(text, /\b(?:research|report|document|paper|literature|evidence|review|study|citation|source)\b/u)) {
    requirements.push(...RESEARCH_REQUIREMENTS)
  }
  if (matches(text, /\b(?:analysis|analyze|analytics|data|dataset|spreadsheet|statistics|statistical|table|csv)\b/u)) {
    requirements.push(...DATA_REQUIREMENTS)
  }
  if (matches(text, /\b(?:automation|integration|connector|oauth|mcp|workflow|scheduler|scheduled|webhook|sync)\b/u)) {
    requirements.push(...AUTOMATION_REQUIREMENTS)
  }
  if (isGameDevelopmentNeed(need)) {
    requirements.push(...GAME_REQUIREMENTS)
  }

  return [...new Set(requirements)].slice(0, MAX_REQUIREMENTS)
}
