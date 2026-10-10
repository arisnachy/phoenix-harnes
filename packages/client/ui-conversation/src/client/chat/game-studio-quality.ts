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
  if (object(value.art)) {
    if (value.art.mode === 'production' && profile === 'run-and-gun') {
      const required = ['enemies', 'bosses', 'backgrounds', 'weapons', 'projectiles', 'powers', 'props', 'effects']
      for (const group of required) {
        if (!Array.isArray(value.art[group]) || value.art[group].length === 0) {
          issues.push('missing-production-art:' + group)
        }
      }
      if (Array.isArray(value.art.backgrounds) && object(value.level) && Array.isArray(value.level.layers)
        && value.art.backgrounds.length < value.level.layers.length) {
        issues.push('production-scenery-incomplete')
      }
    }
    if (value.art.mode === 'prototype') warnings.push('character-art-prototype-not-final')
    if (value.art.mode === 'production' && !nonempty(value.art.designReference) && profile === 'run-and-gun') {
      warnings.push('approved-character-design-reference-missing')
    }
  } else if (['run-and-gun', 'platformer', 'top-down-action', 'rpg'].includes(profile)) {
    warnings.push('visual-art-status-not-declared')
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
  // A missing manifest fails metadata preflight but does NOT prevent the iframe
  // from attempting to execute. Never misdiagnose a blank game as a JSON error.
  const manifestTags = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/giu)]
    .filter(match => /\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(match[1] ?? ''))
  const parsed = readGameManifest(html)
  const result = parsed === undefined ? undefined : auditGameManifest(parsed)
  const issues = result === undefined ? [manifestTags.length === 0
    ? 'game-manifest-missing'
    : 'game-manifest-invalid-json-or-type'] : [...result.issues]
  if (manifestTags.length > 1) issues.push('game-manifest-duplicated')
  const warnings = [...(result?.warnings ?? [])]
  if (/(<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=)/iu.test(html)) issues.push('external-script-or-stylesheet-blocked')
  if (/(<img\b[^>]*\bsrc\s*=\s*["']https?:|\bfetch\s*\(|\bXMLHttpRequest\b)/iu.test(html)) warnings.push('network-assets-blocked-in-game-sandbox')
  if (!/<canvas\b/iu.test(html)) warnings.push('no-canvas-found')
  if (!/<script\b(?![^>]*type\s*=\s*["']application\/json)/iu.test(html)) warnings.push('no-game-runtime-detected')
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    summary: issues.length
      ? 'Game Studio structural preflight needs repairs; the isolated preview still attempts to run HTML, so diagnose blank screens separately'
      : result?.summary ?? 'Game Studio manifest requires repair',
  }
}
