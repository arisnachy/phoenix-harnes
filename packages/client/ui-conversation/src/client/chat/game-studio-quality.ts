/**
 * Phoenix Game Studio: deterministic structural audit for playable 2D game artifacts.
 * This is a preflight, NOT a substitute for running or visually inspecting the game.
 * It never executes user-authored HTML or trusts assertions of successful QA.
 */
export interface GameStudioAudit {
  readonly valid: boolean
  readonly issues: readonly string[]
  readonly warnings: readonly string[]
  readonly summary: string
}

type RecordValue = Readonly<Record<string, unknown>>

function object(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function namedSet(value: unknown, key = 'id'): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter(object).map(item => item[key]).filter(nonempty).map(s => s.toLowerCase()))
}

function stringSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter(nonempty).map(s => s.toLowerCase()) : [])
}

function missing(set: Set<string>, required: readonly string[], prefix: string, issues: string[]): void {
  for (const name of required) if (!set.has(name)) issues.push(prefix + ':' + name)
}

type GameProfile = 'run-and-gun' | 'platformer' | 'top-down-action' | 'racing' | 'puzzle' | 'strategy' | 'rpg' | 'rhythm' | 'simulation' | '3d' | 'custom'

function profileFor(manifest: RecordValue, warnings: string[], issues: string[]): GameProfile {
  const raw = nonempty(manifest.gameType) ? manifest.gameType : nonempty(manifest.genre) ? manifest.genre : 'custom'
  const value = raw.toLowerCase().trim()
  const explicit = nonempty(manifest.gameType)
  if (/run.and.gun|contra|shooter|shoot.em.up/u.test(value)) return 'run-and-gun'
  if (/platform|metroidvania/u.test(value)) return 'platformer'
  if (/top.down|twin.stick|arena.action/u.test(value)) return 'top-down-action'
  if (/rac(e|er|ing)|kart|driving/u.test(value)) return 'racing'
  if (/puzzle|match.3|logic|word.game/u.test(value)) return 'puzzle'
  if (/strategy|tower.defen|tactics|real.time.strategy/u.test(value)) return 'strategy'
  if (/\brpg\b|role.play|adventure/u.test(value)) return 'rpg'
  if (/rhythm|music.game/u.test(value)) return 'rhythm'
  if (/simulation|sandbox|management|builder/u.test(value)) return 'simulation'
  if (/\b3d\b|first.person|third.person|webgl/u.test(value)) return '3d'
  if (value === 'custom') return 'custom'
  if (explicit) issues.push('unsupported-game-type')
  else warnings.push('unknown-genre-use-explicit-game-type')
  return 'custom'
}

function animationStates(player: RecordValue | undefined, required: readonly string[], issues: string[]): void {
  if (player === undefined) { issues.push('missing-player'); return }
  missing(stringSet(player.states), required, 'player-state', issues)
  if (!object(player.animations)) { issues.push('missing-player-animations'); return }
  for (const state of required) {
    const frames = player.animations[state]
    if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 1 || frames > 240) {
      issues.push('animation-frames:' + state)
    }
  }
}

function enemiesAndBosses(manifest: RecordValue, requireEnemies: boolean, requireBoss: boolean, issues: string[]): void {
  if ((!Array.isArray(manifest.enemies) || manifest.enemies.length === 0) && requireEnemies) issues.push('missing-enemies')
  if (Array.isArray(manifest.enemies) && manifest.enemies.length > 0) {
    const ids = namedSet(manifest.enemies)
    if (ids.size !== manifest.enemies.length) issues.push('duplicate-or-unnamed-enemy')
    for (const enemy of manifest.enemies) {
      if (!object(enemy)) { issues.push('invalid-enemy'); continue }
      missing(stringSet(enemy.states), ['move', 'attack', 'hurt', 'death'], 'enemy-state', issues)
    }
  }
  if ((!Array.isArray(manifest.bosses) || manifest.bosses.length === 0) && requireBoss) issues.push('missing-boss')
  if (Array.isArray(manifest.bosses)) for (const boss of manifest.bosses) {
    if (!object(boss) || !nonempty(boss.id) || !Array.isArray(boss.phases)
      || boss.phases.length < 2 || boss.phases.some(phase => !nonempty(phase))) {
      issues.push('boss-requires-two-phases')
    }
  }
}


/**
 * Premium game packaging contract. Declarations are only a production inventory;
 * actual rendering, animation, sound and playtesting still require runtime evidence.
 * Existing prototype artifacts remain backwards-compatible.
 */
function auditPremiumProduction(manifest: RecordValue, profile: GameProfile, issues: string[], warnings: string[]): void {
  if (manifest.productionTier === undefined || manifest.productionTier === 'prototype') {
    if (['run-and-gun', 'platformer', 'top-down-action', 'rpg', '3d'].includes(profile)) {
      warnings.push('premium-asset-integration-not-audited')
    }
    return
  }
  if (manifest.productionTier !== 'polished') { issues.push('unsupported-production-tier'); return }
  const production = object(manifest.production) ? manifest.production : undefined
  if (production === undefined) { issues.push('missing-premium-production'); return }

  const art = object(production.artDirection) ? production.artDirection : undefined
  if (!art || !nonempty(art.style) || !Array.isArray(art.palette)
    || art.palette.filter(nonempty).length < 3 || !nonempty(art.camera)) {
    issues.push('missing-art-direction')
  }
  const story = object(production.story) ? production.story : undefined
  if (!story || !nonempty(story.premise) || !nonempty(story.goal) || !nonempty(story.ending)) {
    issues.push('missing-story-arc')
  }
  if (!Array.isArray(manifest.references) || manifest.references.length < 2
    || manifest.references.some(r => !object(r) || !nonempty(r.title)
      || !nonempty(r.url) || !/^https:\/\/\S+$/u.test(r.url))) {
    issues.push('premium-needs-two-researched-references')
  }

  const screens = Array.isArray(production.screens) ? production.screens : []
  const requiredScreens = ['title', 'intro', 'pause', 'game-over', 'victory']
  for (const id of requiredScreens) {
    if (!screens.some(s => object(s) && s.id === id && nonempty(s.runtimeRef))) {
      issues.push('missing-production-screen:' + id)
    }
  }
  const assets = Array.isArray(production.assets) ? production.assets : []
  const assetIds = namedSet(assets)
  if (assets.length === 0) issues.push('missing-production-assets')
  if (assetIds.size !== assets.length) issues.push('duplicate-or-unnamed-production-asset')
  for (const asset of assets) {
    if (!object(asset) || !nonempty(asset.id) || !nonempty(asset.role)
      || !nonempty(asset.runtimeRef) || !nonempty(asset.origin)
      || !['original', 'cc0', 'licensed'].includes(asset.origin.toLowerCase())) {
      issues.push('invalid-production-asset')
      continue
    }
    if (asset.origin === 'licensed'
      && (!nonempty(asset.license) || !nonempty(asset.sourceUrl)
        || !/^https:\/\/\S+$/u.test(asset.sourceUrl))) {
      issues.push('unlicensed-production-asset:' + asset.id)
    }
    if (['player', 'enemy', 'boss', 'npc'].includes(asset.role)
      && (!Array.isArray(asset.states) || asset.states.length === 0)) {
      issues.push('missing-asset-animation-states:' + asset.id)
    }
    if (asset.role === 'player' && object(manifest.player)) {
      missing(stringSet(asset.states), [...stringSet(manifest.player.states)],
        'unbound-player-animation:' + asset.id, issues)
    }
  }
  const rolePresent = (role: string): boolean => assets.some(a => object(a) && a.role === role)
  const requiredRoles = ['background', 'ui', 'music', 'sfx']
  if (['run-and-gun', 'platformer', 'top-down-action', 'rpg', '3d', 'racing'].includes(profile)) requiredRoles.push('player')
  if (profile === 'run-and-gun' || profile === 'top-down-action') requiredRoles.push('enemy', 'weapon')
  if (profile === 'run-and-gun') requiredRoles.push('boss', 'vfx')
  for (const role of requiredRoles) if (!rolePresent(role)) issues.push('missing-production-role:' + role)

  const matchActor = (actor: unknown, role: string): void => {
    if (!object(actor) || !nonempty(actor.id)) return
    const matching = assets.filter(asset => object(asset) && asset.role === role && asset.entityId === actor.id)
    if (matching.length === 0) issues.push('unbound-' + role + '-art:' + actor.id)
    else if (Array.isArray(actor.states)) {
      for (const a of matching) if (object(a)) {
        missing(stringSet(a.states), [...stringSet(actor.states)], 'unbound-' + role + '-animation:' + actor.id, issues)
      }
    }
  }
  if (Array.isArray(manifest.enemies)) for (const enemy of manifest.enemies) matchActor(enemy, 'enemy')
  if (Array.isArray(manifest.bosses)) for (const boss of manifest.bosses) matchActor(boss, 'boss')

  const audioBindings = Array.isArray(production.audioBindings) ? production.audioBindings : []
  const cues = object(manifest.audio) ? manifest.audio.cues : undefined
  if (Array.isArray(cues)) for (const cue of cues) {
    if (nonempty(cue) && !audioBindings.some(b => object(b) && b.cue === cue && nonempty(b.runtimeRef))) {
      issues.push('unbound-audio-cue:' + cue)
    }
  }
  if (!audioBindings.some(b => object(b) && b.cue === 'music' && nonempty(b.runtimeRef))) {
    issues.push('unbound-soundtrack')
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    issues.push('missing-premium-asset-provenance')
  }
  // A manifest cannot attest to itself that a screenshot, listening test, or playthrough occurred.
  warnings.push('premium-needs-observed-visual-audio-gameplay-qa')
}

function auditRuntimeBindings(html: string, manifest: unknown, issues: string[]): void {
  if (!object(manifest) || manifest.productionTier !== 'polished' || !object(manifest.production)) return
  // Exclude JSON manifests; counting text only inside metadata would incorrectly "prove" integration.
  const runtime = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter(m => !/\btype\s*=\s*["']application\/json["']/iu.test(m[1] ?? ''))
    .map(m => m[2] ?? '').join('\n')
  const production = manifest.production
  const refs: unknown[] = []
  for (const name of ['assets', 'screens', 'audioBindings']) {
    const entries = production[name]
    if (Array.isArray(entries)) for (const entry of entries) if (object(entry)) refs.push(entry.runtimeRef)
  }
  for (const ref of refs) {
    if (!nonempty(ref) || !/^[a-zA-Z_$][\w$]*$/u.test(ref)
      || !new RegExp('\\b' + ref.replace(/\$/gu, '\\
 * @param value - Untrusted game manifest supplied with the artifact.
 * @returns Structural issues and verification limits, not a gameplay verdict.
 */
export function auditGameManifest(value: unknown): GameStudioAudit {
  const issues: string[] = []
  const warnings: string[] = []
  if (!object(value)) return { valid: false, issues: ['manifest-not-object'], warnings, summary: 'Invalid game manifest' }
  if (value.schemaVersion !== 1) issues.push('unsupported-schema-version')
  if (!nonempty(value.title)) issues.push('missing-title')
  if (!nonempty(value.genre)) issues.push('missing-genre')
  const profile = profileFor(value, warnings, issues)
  const player = object(value.player) ? value.player : undefined
  const requiredMotion: Readonly<Partial<Record<GameProfile, readonly string[]>>> = {
    'run-and-gun': ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death'],
    platformer: ['idle', 'run', 'jump', 'fall'],
    'top-down-action': ['idle', 'move', 'attack', 'hurt', 'death'],
    racing: ['idle', 'drive', 'turn', 'crash'],
  }
  const motion = requiredMotion[profile]
  if (motion !== undefined) animationStates(player, motion, issues)
  else if (player !== undefined && (!Array.isArray(player.states) || player.states.length === 0)) warnings.push('player-states-not-declared')
  enemiesAndBosses(value, profile === 'run-and-gun' || profile === 'top-down-action', profile === 'run-and-gun', issues)
  if (!object(value.level)) issues.push('missing-level')
  else {
    const level = value.level
    const layers = level.layers
    const requiredLayers = profile === 'run-and-gun' ? 3 : profile === 'platformer' ? 2 : 1
    if (!Array.isArray(layers) || layers.length < requiredLayers) issues.push('level-requires-' + (requiredLayers === 3 ? 'parallax-layers' : 'scene-layers'))
    else if (layers.some(layer => !object(layer) || !nonempty(layer.id)
      || typeof layer.scrollFactor !== 'number' || !Number.isFinite(layer.scrollFactor)
      || layer.scrollFactor < 0 || layer.scrollFactor > 1)) issues.push('invalid-parallax-layer')
    if ((profile === 'run-and-gun' || profile === 'platformer')
      && (!Array.isArray(level.platforms) || level.platforms.length === 0)) issues.push('missing-playable-platforms')
    if (profile === 'racing' && !object(level.track)) issues.push('missing-race-track')
    if (profile === 'puzzle' && !Array.isArray(level.puzzles)) issues.push('missing-puzzle-definitions')
    if (profile === 'strategy' && !Array.isArray(level.units)) issues.push('missing-strategy-units')
    if (profile === 'rhythm' && !Array.isArray(level.notes)) issues.push('missing-rhythm-chart')
    if (profile === 'simulation' && !Array.isArray(level.systems)) issues.push('missing-simulation-systems')
  }
  const controlRequirements: Record<GameProfile, readonly string[]> = {
    'run-and-gun': ['move', 'jump', 'shoot'],
    platformer: ['move', 'jump'],
    'top-down-action': ['move', 'action'],
    racing: ['steer', 'accelerate', 'brake'],
    puzzle: ['interact'],
    strategy: ['select', 'command'],
    rpg: ['move', 'interact'],
    rhythm: ['play'],
    simulation: ['interact'],
    '3d': ['move'],
    custom: [],
  }
  if (!object(value.controls) || Object.values(value.controls).every(v => !nonempty(v))) issues.push('missing-controls')
  else missing(new Set(Object.entries(value.controls).filter(([, v]) => nonempty(v)).map(([k]) => k)),
    controlRequirements[profile], 'control', issues)
  if (profile === 'custom' && (!Array.isArray(value.mechanics) || value.mechanics.length === 0)) issues.push('missing-custom-mechanics')
  if (!object(value.audio)) issues.push('missing-audio')
  else {
    const cues = profile === 'run-and-gun' ? ['jump', 'shoot', 'hit', 'explosion', 'boss']
      : profile === 'racing' ? ['engine', 'collision']
        : profile === 'rhythm' ? ['beat'] : []
    missing(stringSet(value.audio.cues), cues, 'audio-cue', issues)
    if (!Array.isArray(value.audio.cues) || value.audio.cues.length === 0) warnings.push('audio-cues-not-declared')
    if (!nonempty(value.audio.music)) warnings.push('missing-music-plan')
  }
  if (profile === 'run-and-gun') {
    if (!object(value.motion) || !object(value.motion.rig)) warnings.push('articulated-character-rig-not-declared')
    if (!object(value.motion) || !Array.isArray(value.motion.aimDirections)
      || value.motion.aimDirections.length < 3) warnings.push('multi-directional-aim-not-declared')
  }
  auditPremiumProduction(value, profile, issues, warnings)
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    warnings.push('asset-provenance-not-declared')
  } else for (const source of value.sources) {
    if (!object(source) || !nonempty(source.path) || !nonempty(source.license)
      || !['original', 'cc0', 'cc-by-4.0', 'ofl-1.1', 'mit'].includes(source.license.toLowerCase())) {
      warnings.push('unreviewed-asset-license')
    }
  }
  if (!Array.isArray(value.references) || value.references.length === 0) warnings.push('research-references-not-declared')
  else for (const item of value.references) {
    if (!object(item) || !nonempty(item.title) || !nonempty(item.url)
      || !/^https:\/\/[^ ]+$/iu.test(item.url)) warnings.push('invalid-research-reference')
  }
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    summary: issues.length === 0 ? 'Structural game contract passed; gameplay and audiovisual QA are still required'
      : 'Game contract is incomplete; repair before calling this game finished',
  }
}

/**
 * Extract the embedded game contract without evaluating executable HTML.
 * Script id and type are exact to prevent confusing game logic with metadata.
 * @param html - Self-contained candidate game document.
 * @returns Parsed manifest or undefined if missing or malformed.
 */
export function readGameManifest(html: string): unknown {
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu
  for (const match of html.matchAll(script)) {
    const attributes = match[1] ?? ''
    if (!/\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(attributes)) continue
    if (!/\btype\s*=\s*["']application\/json["']/iu.test(attributes)) return undefined
    try { return JSON.parse(match[2] ?? '') as unknown } catch { return undefined }
  }
  return undefined
}

/** Checks packaging constraints of PHOENIX's isolated, network-free game iframe.
 * @param html - Candidate game document for isolated preview.
 * @returns Issues and warnings requiring attention before publication.
 */
export function auditGameHtml(html: string): GameStudioAudit {
  const result = auditGameManifest(readGameManifest(html))
  const issues = [...result.issues]
  const warnings = [...result.warnings]
  auditRuntimeBindings(html, readGameManifest(html), issues)
  if (/(<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=)/iu.test(html)) issues.push('external-script-or-stylesheet-blocked')
  if (/(<img\b[^>]*\bsrc\s*=\s*["']https?:|\bfetch\s*\(|\bXMLHttpRequest\b)/iu.test(html)) warnings.push('network-assets-blocked-in-game-sandbox')
  if (!/<canvas\b/iu.test(html)) warnings.push('no-canvas-found')
  if (!/<script\b(?![^>]*type\s*=\s*["']application\/json)/iu.test(html)) warnings.push('no-game-runtime-detected')
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    summary: issues.length ? 'Game preview requires repairs' : result.summary,
  }
}
) + '\\b', 'u').test(runtime)) {
      issues.push('missing-runtime-asset-binding:' + String(ref))
    }
  }
}

/** Audit a genre-specific game contract, without claiming that the declared mechanics actually work.
 * @param value - Untrusted game manifest supplied with the artifact.
 * @returns Structural issues and verification limits, not a gameplay verdict.
 */
export function auditGameManifest(value: unknown): GameStudioAudit {
  const issues: string[] = []
  const warnings: string[] = []
  if (!object(value)) return { valid: false, issues: ['manifest-not-object'], warnings, summary: 'Invalid game manifest' }
  if (value.schemaVersion !== 1) issues.push('unsupported-schema-version')
  if (!nonempty(value.title)) issues.push('missing-title')
  if (!nonempty(value.genre)) issues.push('missing-genre')
  const profile = profileFor(value, warnings, issues)
  const player = object(value.player) ? value.player : undefined
  const requiredMotion: Readonly<Partial<Record<GameProfile, readonly string[]>>> = {
    'run-and-gun': ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death'],
    platformer: ['idle', 'run', 'jump', 'fall'],
    'top-down-action': ['idle', 'move', 'attack', 'hurt', 'death'],
    racing: ['idle', 'drive', 'turn', 'crash'],
  }
  const motion = requiredMotion[profile]
  if (motion !== undefined) animationStates(player, motion, issues)
  else if (player !== undefined && (!Array.isArray(player.states) || player.states.length === 0)) warnings.push('player-states-not-declared')
  enemiesAndBosses(value, profile === 'run-and-gun' || profile === 'top-down-action', profile === 'run-and-gun', issues)
  if (!object(value.level)) issues.push('missing-level')
  else {
    const level = value.level
    const layers = level.layers
    const requiredLayers = profile === 'run-and-gun' ? 3 : profile === 'platformer' ? 2 : 1
    if (!Array.isArray(layers) || layers.length < requiredLayers) issues.push('level-requires-' + (requiredLayers === 3 ? 'parallax-layers' : 'scene-layers'))
    else if (layers.some(layer => !object(layer) || !nonempty(layer.id)
      || typeof layer.scrollFactor !== 'number' || !Number.isFinite(layer.scrollFactor)
      || layer.scrollFactor < 0 || layer.scrollFactor > 1)) issues.push('invalid-parallax-layer')
    if ((profile === 'run-and-gun' || profile === 'platformer')
      && (!Array.isArray(level.platforms) || level.platforms.length === 0)) issues.push('missing-playable-platforms')
    if (profile === 'racing' && !object(level.track)) issues.push('missing-race-track')
    if (profile === 'puzzle' && !Array.isArray(level.puzzles)) issues.push('missing-puzzle-definitions')
    if (profile === 'strategy' && !Array.isArray(level.units)) issues.push('missing-strategy-units')
    if (profile === 'rhythm' && !Array.isArray(level.notes)) issues.push('missing-rhythm-chart')
    if (profile === 'simulation' && !Array.isArray(level.systems)) issues.push('missing-simulation-systems')
  }
  const controlRequirements: Record<GameProfile, readonly string[]> = {
    'run-and-gun': ['move', 'jump', 'shoot'],
    platformer: ['move', 'jump'],
    'top-down-action': ['move', 'action'],
    racing: ['steer', 'accelerate', 'brake'],
    puzzle: ['interact'],
    strategy: ['select', 'command'],
    rpg: ['move', 'interact'],
    rhythm: ['play'],
    simulation: ['interact'],
    '3d': ['move'],
    custom: [],
  }
  if (!object(value.controls) || Object.values(value.controls).every(v => !nonempty(v))) issues.push('missing-controls')
  else missing(new Set(Object.entries(value.controls).filter(([, v]) => nonempty(v)).map(([k]) => k)),
    controlRequirements[profile], 'control', issues)
  if (profile === 'custom' && (!Array.isArray(value.mechanics) || value.mechanics.length === 0)) issues.push('missing-custom-mechanics')
  if (!object(value.audio)) issues.push('missing-audio')
  else {
    const cues = profile === 'run-and-gun' ? ['jump', 'shoot', 'hit', 'explosion', 'boss']
      : profile === 'racing' ? ['engine', 'collision']
        : profile === 'rhythm' ? ['beat'] : []
    missing(stringSet(value.audio.cues), cues, 'audio-cue', issues)
    if (!Array.isArray(value.audio.cues) || value.audio.cues.length === 0) warnings.push('audio-cues-not-declared')
    if (!nonempty(value.audio.music)) warnings.push('missing-music-plan')
  }
  if (profile === 'run-and-gun') {
    if (!object(value.motion) || !object(value.motion.rig)) warnings.push('articulated-character-rig-not-declared')
    if (!object(value.motion) || !Array.isArray(value.motion.aimDirections)
      || value.motion.aimDirections.length < 3) warnings.push('multi-directional-aim-not-declared')
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    warnings.push('asset-provenance-not-declared')
  } else for (const source of value.sources) {
    if (!object(source) || !nonempty(source.path) || !nonempty(source.license)
      || !['original', 'cc0', 'cc-by-4.0', 'ofl-1.1', 'mit'].includes(source.license.toLowerCase())) {
      warnings.push('unreviewed-asset-license')
    }
  }
  if (!Array.isArray(value.references) || value.references.length === 0) warnings.push('research-references-not-declared')
  else for (const item of value.references) {
    if (!object(item) || !nonempty(item.title) || !nonempty(item.url)
      || !/^https:\/\/[^ ]+$/iu.test(item.url)) warnings.push('invalid-research-reference')
  }
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    summary: issues.length === 0 ? 'Structural game contract passed; gameplay and audiovisual QA are still required'
      : 'Game contract is incomplete; repair before calling this game finished',
  }
}

/**
 * Extract the embedded game contract without evaluating executable HTML.
 * Script id and type are exact to prevent confusing game logic with metadata.
 * @param html - Self-contained candidate game document.
 * @returns Parsed manifest or undefined if missing or malformed.
 */
export function readGameManifest(html: string): unknown {
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu
  for (const match of html.matchAll(script)) {
    const attributes = match[1] ?? ''
    if (!/\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(attributes)) continue
    if (!/\btype\s*=\s*["']application\/json["']/iu.test(attributes)) return undefined
    try { return JSON.parse(match[2] ?? '') as unknown } catch { return undefined }
  }
  return undefined
}

/** Checks packaging constraints of PHOENIX's isolated, network-free game iframe.
 * @param html - Candidate game document for isolated preview.
 * @returns Issues and warnings requiring attention before publication.
 */
export function auditGameHtml(html: string): GameStudioAudit {
  const result = auditGameManifest(readGameManifest(html))
  const issues = [...result.issues]
  const warnings = [...result.warnings]
  if (/(<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=)/iu.test(html)) issues.push('external-script-or-stylesheet-blocked')
  if (/(<img\b[^>]*\bsrc\s*=\s*["']https?:|\bfetch\s*\(|\bXMLHttpRequest\b)/iu.test(html)) warnings.push('network-assets-blocked-in-game-sandbox')
  if (!/<canvas\b/iu.test(html)) warnings.push('no-canvas-found')
  if (!/<script\b(?![^>]*type\s*=\s*["']application\/json)/iu.test(html)) warnings.push('no-game-runtime-detected')
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    summary: issues.length ? 'Game preview requires repairs' : result.summary,
  }
}
