import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Game Studio's existing sandboxed executable artifact renderer in the Phoenix chat. */
export const PHOENIX_GAME_MIME = 'application/vnd.phoenix.game+html'

interface GameManifest {
  readonly schemaVersion: number
  readonly title: string
  readonly genre: string
}


/**
 * Enforce the premium production inventory at publication time, rather than
 * trusting a visually impressive but disconnected spritesheet or cover image.
 * Static references are NOT evidence of actual gameplay or perceived AV quality.
 */
function validatePremiumProduction(html: string, manifest: Record<string, unknown>): void {
  if (manifest.productionTier === undefined || manifest.productionTier === 'prototype') return
  if (manifest.productionTier !== 'polished') {
    throw new ToolArgsError(['productionTier debe ser prototype o polished.'])
  }
  const asObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const filled = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
  const p = asObject(manifest.production) ? manifest.production : undefined
  if (!p) throw new ToolArgsError(['Modo polished: falta production con arte, historia, pantallas y recursos integrados.'])
  const errors: string[] = []
  const art = asObject(p.artDirection) ? p.artDirection : undefined
  if (!art || !filled(art.style) || !filled(art.camera)
    || !Array.isArray(art.palette) || art.palette.filter(filled).length < 3) {
    errors.push('artDirection(style, camera, palette>=3)')
  }
  const story = asObject(p.story) ? p.story : undefined
  if (!story || !filled(story.premise) || !filled(story.goal) || !filled(story.ending)) errors.push('story(premise, goal, ending)')
  if (!Array.isArray(manifest.references) || manifest.references.length < 2
    || manifest.references.some(r => !asObject(r) || !filled(r.title)
      || !filled(r.url) || !/^https:\/\/\S+$/u.test(r.url))) errors.push('references(>=2 research URLs)')
  const screens = Array.isArray(p.screens) ? p.screens : []
  for (const id of ['title', 'intro', 'pause', 'game-over', 'victory']) {
    if (!screens.some(s => asObject(s) && s.id === id && filled(s.runtimeRef))) errors.push('screen:' + id)
  }
  const assets = Array.isArray(p.assets) ? p.assets : []
  const ids = new Set<string>()
  const role = (name: string): boolean => assets.some(a => asObject(a) && a.role === name)
  for (const asset of assets) {
    if (!asObject(asset) || !filled(asset.id) || !filled(asset.role) || !filled(asset.runtimeRef)
      || !filled(asset.origin) || !['original', 'cc0', 'licensed'].includes(asset.origin.toLowerCase())
      || ids.has(asset.id)) {
      errors.push('invalid-or-duplicate-production-asset')
      continue
    }
    ids.add(asset.id)
    if (asset.origin === 'licensed' && (!filled(asset.license) || !filled(asset.sourceUrl)
      || !/^https:\/\/\S+$/u.test(asset.sourceUrl))) errors.push('unlicensed-asset:' + asset.id)
  }
  const profile = filled(manifest.gameType) ? manifest.gameType : manifest.genre
  const action = typeof profile === 'string' && /run.and.gun|contra|shooter|shoot.em.up/iu.test(profile)
  const topDown = typeof profile === 'string' && /top.down|twin.stick|arena.action/iu.test(profile)
  const representational = typeof profile === 'string'
    && /run.and.gun|platform|top.down|twin.stick|rpg|adventure|3d|racing/iu.test(profile)
  const roles = ['background', 'ui', 'music', 'sfx']
  if (representational) roles.push('player')
  if (action || topDown) roles.push('enemy', 'weapon')
  if (action) roles.push('boss', 'vfx')
  for (const required of roles) if (!role(required)) errors.push('asset-role:' + required)
  const requiredActors = (kind: 'enemies' | 'bosses', roleName: string): void => {
    const actors = manifest[kind]
    if (!Array.isArray(actors)) return
    for (const actor of actors) {
      if (!asObject(actor) || !filled(actor.id)) continue
      const match = assets.find(a => asObject(a) && a.role === roleName && a.entityId === actor.id)
      if (!match) errors.push('unbound-' + roleName + ':' + actor.id)
      else if (asObject(match) && Array.isArray(actor.states)) {
        const actualStates: readonly unknown[] = Array.isArray(match.states) ? match.states : []
        if (actor.states.some(s => !actualStates.includes(s))) errors.push('animation-mismatch:' + actor.id)
      }
    }
  }
  requiredActors('enemies', 'enemy')
  requiredActors('bosses', 'boss')
  const hero = assets.find(a => asObject(a) && a.role === 'player')
  if (representational && asObject(manifest.player) && Array.isArray(manifest.player.states)) {
    const heroStates: readonly unknown[] = asObject(hero) && Array.isArray(hero.states) ? hero.states : []
    if (manifest.player.states.some(s => !heroStates.includes(s))) errors.push('unbound-player-animations')
  }
  const bindings = Array.isArray(p.audioBindings) ? p.audioBindings : []
  const cues = asObject(manifest.audio) ? manifest.audio.cues : undefined
  for (const cue of Array.isArray(cues) ? cues : []) {
    if (filled(cue) && !bindings.some(b => asObject(b) && b.cue === cue && filled(b.runtimeRef))) {
      errors.push('audio-cue:' + cue)
    }
  }
  if (!bindings.some(b => asObject(b) && b.cue === 'music' && filled(b.runtimeRef))) errors.push('soundtrack')
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) errors.push('source-provenance')
  const runtime = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter(m => !/\btype\s*=\s*["']application\/json["']/iu.test(m[1] ?? ''))
    .map(m => m[2] ?? '').join('\n')
  for (const group of [screens, assets, bindings]) {
    for (const item of group) {
      if (!asObject(item)) continue
      const ref = item.runtimeRef
      if (!filled(ref) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ref)
        || !new RegExp('\\b' + ref + '\\b', 'u').test(runtime)) {
        errors.push('runtimeRef:' + String(ref))
      }
    }
  }
  if (errors.length) {
    throw new ToolArgsError(['Juego polished incompleto: ' + [...new Set(errors)].join(', ')
      + '. Integra los assets al runtime antes de publicar; no basta el manifiesto.'])
  }
}

/** Validate source packaging without executing untrusted game HTML or claiming gameplay QA. */
function validateGameHtml(html: string): GameManifest {
  if (html.trim().length === 0) throw new ToolArgsError(['El videojuego HTML está vacío.'])
  if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=/iu.test(html)) {
    throw new ToolArgsError(['El juego debe incluir su JavaScript y CSS directamente: el visor aislado no carga CDN ni scripts externos.'])
  }
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|<img\b[^>]*\bsrc\s*=\s*["']https?:/iu.test(html)) {
    throw new ToolArgsError(['El juego debe funcionar sin red: incluye los recursos como data: URL o código autónomo.'])
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
  const manifestBlock = scripts.find(match => /\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(match[1] ?? ''))
  if (manifestBlock === undefined
    || !/\btype\s*=\s*["']application\/json["']/iu.test(manifestBlock[1] ?? '')) {
    throw new ToolArgsError(['Falta <script id="phoenix-game-manifest" type="application/json"> con el contrato del juego.'])
  }
  let value: unknown
  try {
    value = JSON.parse(manifestBlock[2] ?? '')
  } catch {
    throw new ToolArgsError(['El manifiesto JSON del juego es inválido.'])
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolArgsError(['El manifiesto del juego debe ser un objeto.'])
  }
  const manifest = value as Record<string, unknown>
  if (manifest.schemaVersion !== 1 || typeof manifest.title !== 'string'
    || manifest.title.trim() === '' || typeof manifest.genre !== 'string'
    || manifest.genre.trim() === '') {
    throw new ToolArgsError(['El manifiesto necesita schemaVersion:1, title y genre no vacíos.'])
  }
  validatePremiumProduction(html, manifest)
  if (!scripts.some(match => match !== manifestBlock && (match[2] ?? '').trim().length > 0
    && !/\btype\s*=\s*["']application\/json["']/iu.test(match[1] ?? ''))) {
    throw new ToolArgsError(['Solo se recibió metadato o arte estático; el juego requiere JavaScript ejecutable.'])
  }
  if (!/<canvas\b|<button\b|<svg\b|<input\b|\brole\s*=\s*["']application["']/iu.test(html)) {
    throw new ToolArgsError(['Falta una superficie interactiva para jugar (Canvas o controles DOM).'])
  }
  return { schemaVersion: 1, title: manifest.title, genre: manifest.genre }
}

/**
 * Publish a complete offline game as the existing sandboxed Game Studio preview in the chat.
 * This validates packaging, not real keyboard/motion/audio behavior, which still needs testing.
 * @returns Game Studio tool definition with the dedicated executable game MIME.
 */
export function createPhoenixGameTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_game',
    description: 'Publish a COMPLETE self-contained PLAYABLE browser game directly inside this PHOENIX chat (Game Studio). Use for any in-chat 2D/2.5D/3D game, arcade, shooter, platformer, puzzle, racing, rhythm or simulation. This is the actual in-chat game publisher; image_generation produces assets only and phoenix_canvas is for non-game apps. Supply HTML with inline CSS and executable JavaScript, interactive Canvas/DOM and a JSON phoenix-game-manifest (schemaVersion:1, title, genre, controls, level, audio, and genre-appropriate player/enemies/animations). No external CDN, network requests, or remote assets. Use real source/graphics/audio assets only if embed-ready. The tool emits application/vnd.phoenix.game+html, which PHOENIX already renders in its sandboxed Game Studio player with export and structural preflight. The publication receipt is NOT proof of gameplay, audio or visual quality: run independent tests, report what was actually verified, and never call a PNG-only response a finished game. When La Forja is requested, delegate via the real spawn_teammate tool before publishing if available. For polished games set productionTier=polished and provide an integrated production inventory: original or legally licensed protagonist, differentiated enemies, boss, weapons, backgrounds, VFX, menu/title/intro/end screens, story, soundtrack and SFX with valid runtimeRef identifiers that exist in executable JavaScript. A disconnected spritesheet or declarative JSON fails publication. Prototype mode is for clearly labeled prototypes only. No automatic mission termination: do not close a broader game mission until mandatory verification is complete.',
    parameters: {
      title: { type: 'string', required: true, description: 'Human-facing game title.' },
      html: { type: 'string', required: true, description: 'Complete offline HTML5 game with embedded game-manifest, inline JS/CSS, and working input/animation/gameplay.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          preflight: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Game Studio: "${value.title}" publicado en el chat. Integridad estructural básica comprobada; jugabilidad, arte y sonido pendientes de pruebas reales.`,
      }],
      presentationMeta: (args, value) => ({
        artifact: {
          id: value.artifactId,
          mime: PHOENIX_GAME_MIME,
          title: value.title,
          data: args.html,
          executable: true,
        },
      }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new ToolArgsError(['El título del juego no puede estar vacío.'])
      validateGameHtml(args.html)
      return Promise.resolve({
        artifactId: `phoenix-game:${String(exec.callId)}`,
        title,
        preflight: 'packaging-only',
      })
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Game Studio · ${args.title}`,
        kind: 'read',
        rawInput: 'HTML5 jugable integrado en el chat',
      }
    },
  })
}
