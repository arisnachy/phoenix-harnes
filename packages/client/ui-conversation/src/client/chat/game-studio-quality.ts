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

/** Audit the contract Kira's game-generation team must deliver before visual QA. */
export function auditGameManifest(value: unknown): GameStudioAudit {
  const issues: string[] = []
  const warnings: string[] = []
  if (!object(value)) return { valid: false, issues: ['manifest-not-object'], warnings, summary: 'Invalid game manifest' }
  if (value.schemaVersion !== 1) issues.push('unsupported-schema-version')
  if (!nonempty(value.title)) issues.push('missing-title')
  if (!nonempty(value.genre)) issues.push('missing-genre')
  if (!object(value.player)) issues.push('missing-player')
  else {
    missing(stringSet(value.player.states), ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death'], 'player-state', issues)
    if (!object(value.player.animations)) issues.push('missing-player-animations')
    else for (const state of ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death']) {
      const frames = value.player.animations[state]
      if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 1 || frames > 240) {
        issues.push('animation-frames:' + state)
      }
    }
  }
  if (!Array.isArray(value.enemies) || value.enemies.length === 0) issues.push('missing-enemies')
  else {
    const ids = namedSet(value.enemies)
    if (ids.size !== value.enemies.length) issues.push('duplicate-or-unnamed-enemy')
    for (const enemy of value.enemies) {
      if (!object(enemy)) { issues.push('invalid-enemy'); continue }
      missing(stringSet(enemy.states), ['move', 'attack', 'hurt', 'death'], 'enemy-state', issues)
    }
  }
  if (!Array.isArray(value.bosses) || value.bosses.length === 0) issues.push('missing-boss')
  else for (const boss of value.bosses) {
    if (!object(boss) || !nonempty(boss.id) || !Array.isArray(boss.phases)
      || boss.phases.length < 2 || boss.phases.some(phase => !nonempty(phase))) {
      issues.push('boss-requires-two-phases')
    }
  }
  if (!object(value.level)) issues.push('missing-level')
  else {
    if (!Array.isArray(value.level.layers) || value.level.layers.length < 3) issues.push('level-requires-parallax-layers')
    else if (value.level.layers.some(layer => !object(layer) || !nonempty(layer.id)
      || typeof layer.scrollFactor !== 'number' || !Number.isFinite(layer.scrollFactor)
      || layer.scrollFactor < 0 || layer.scrollFactor > 1)) issues.push('invalid-parallax-layer')
    if (!Array.isArray(value.level.platforms) || value.level.platforms.length === 0) issues.push('missing-playable-platforms')
  }
  if (!object(value.controls)) issues.push('missing-controls')
  else missing(new Set(Object.entries(value.controls).filter(([, v]) => nonempty(v)).map(([k]) => k)),
    ['move', 'jump', 'shoot'], 'control', issues)
  if (!object(value.audio)) issues.push('missing-audio')
  else {
    missing(stringSet(value.audio.cues), ['jump', 'shoot', 'hit', 'explosion', 'boss'], 'audio-cue', issues)
    if (!nonempty(value.audio.music)) warnings.push('missing-music-plan')
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

/** Checks packaging constraints of PHOENIX's isolated, network-free game iframe. */
export function auditGameHtml(html: string): GameStudioAudit {
  const result = auditGameManifest(readGameManifest(html))
  const issues = [...result.issues]
  const warnings = [...result.warnings]
  if (/(\<script\b[^>]*\bsrc\s*=|\<link\b[^>]*\bhref\s*=)/iu.test(html)) issues.push('external-script-or-stylesheet-blocked')
  if (/(\<img\b[^>]*\bsrc\s*=\s*["']https?:|\bfetch\s*\(|\bXMLHttpRequest\b)/iu.test(html)) warnings.push('network-assets-blocked-in-game-sandbox')
  if (!/<canvas\b/iu.test(html)) warnings.push('no-canvas-found')
  if (!/<script\b(?![^>]*type\s*=\s*["']application\/json)/iu.test(html)) warnings.push('no-game-runtime-detected')
  return {
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    summary: issues.length ? 'Game preview requires repairs' : result.summary,
  }
}
