import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { validateGameArt } from './game-art.ts'

/** Game Studio's existing sandboxed executable artifact renderer in the Phoenix chat. */
export const PHOENIX_GAME_MIME = 'application/vnd.phoenix.game+html'

interface GameManifest {
  readonly schemaVersion: number
  readonly title: string
  readonly genre: string
  readonly artPreflight: 'production-structure' | 'prototype' | 'not-required'
}

function jsonValue(source: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(source) as unknown } catch {
    throw new ToolArgsError(['El manifiesto JSON entregado a Game Studio no es válido. Corrige JSON antes de publicar.'])
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolArgsError(['El manifiesto JSON debe ser un objeto con schemaVersion, title y genre.'])
  }
  return value as Record<string, unknown>
}

function comparable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(comparable).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>
    return '{' + Object.keys(fields).sort().map(key => JSON.stringify(key) + ':' + comparable(fields[key])).join(',') + '}'
  }
  const encoded = JSON.stringify(value)
  return typeof encoded === 'string' ? encoded : 'undefined'
}

/** Bind a truthfully authored manifest to the game *before* publishing.
 * Kira may pass \`manifest_json\` separately so forgetting the exact HTML script
 * wrapper never wastes a publication call. It never invents entities or art.
 * @param html - Original complete self-contained executable HTML.
 * @param manifestJson - Optional separate authored JSON object as text.
 * @returns Game HTML with exactly one validated canonical manifest binding.
 */
export function preparePhoenixGameSubmission(html: string, manifestJson?: string): string {
  if (html.trim().length === 0) throw new ToolArgsError(['El videojuego HTML está vacío.'])
  const supplied = manifestJson === undefined ? undefined : jsonValue(manifestJson)
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
  const canonical = scripts.filter(match => /\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(match[1] ?? ''))
  if (canonical.length > 1) throw new ToolArgsError(['Hay más de un manifiesto de Game Studio: deja un solo bloque JSON.'])
  if (canonical.length === 1) {
    const match = canonical[0]
    if (!/\btype\s*=\s*["']application\/json["']/iu.test(match?.[1] ?? '')) {
      throw new ToolArgsError(['El manifiesto existente debe usar type="application/json".'])
    }
    const embedded = jsonValue(match?.[2] ?? '')
    if (supplied !== undefined && comparable(embedded) !== comparable(supplied)) {
      throw new ToolArgsError(['El manifest_json suministrado no coincide con el manifiesto incluido en el HTML.'])
    }
    return html
  }
  // Salvage the common case where the author provided the correct JSON script
  // content but forgot the exact id attribute. Never select unrelated metadata.
  const candidates = scripts.filter((match) => {
    const attrs = match[1] ?? ''
    if (!/\btype\s*=\s*["']application\/json["']/iu.test(attrs) || /\bid\s*=/iu.test(attrs)) return false
    try {
      const item = JSON.parse(match[2] ?? '') as unknown
      return item !== null && typeof item === 'object' && !Array.isArray(item)
        && (item as Record<string, unknown>).schemaVersion === 1
        && typeof (item as Record<string, unknown>).genre === 'string'
    } catch { return false }
  })
  if (candidates.length === 1) {
    const selected = candidates[0]
    if (selected === undefined) throw new Error('Unreachable candidate state')
    const embedded = jsonValue(selected[2] ?? '')
    if (supplied !== undefined && comparable(embedded) !== comparable(supplied)) {
      throw new ToolArgsError(['El manifest_json no coincide con el bloque JSON ya escrito en el juego.'])
    }
    const opening = '<script' + (selected[1] ?? '') + ' id="phoenix-game-manifest">'
    return html.replace(selected[0], opening + (selected[2] ?? '') + '</script>')
  }
  if (candidates.length > 1) throw new ToolArgsError(['Hay varios contratos JSON ambiguos. Identifica uno como phoenix-game-manifest.'])
  if (supplied === undefined) {
    throw new ToolArgsError(['Falta el manifiesto: antes de publicar, pasa manifest_json con el contrato real del juego o incluye <script id="phoenix-game-manifest" type="application/json"> en HTML. Kira debe preparar esto desde el principio.'])
  }
  if (!/<\/body\s*>/iu.test(html)) throw new ToolArgsError(['Game Studio necesita HTML completo con </body> para insertar el contrato.'])
  const escaped = JSON.stringify(supplied).replace(/</gu, '\\u003c')
  return html.replace(/<\/body\s*>/iu,
    '<script id="phoenix-game-manifest" type="application/json">' + escaped + '</script></body>')
}

/** A sampled-production claim must carry real embedded sound bytes, not cue names only.
 * Structural check only; real playback/quality still require browser listening.
 */
function validateRecordedAudio(html: string, manifest: Record<string, unknown>): void {
  const audio = manifest.audio as Record<string, unknown>
  if (audio.mode !== 'sampled-production') return
  const cues = Array.isArray(audio.cues) ? (audio.cues as unknown[]).filter((v): v is string => typeof v === 'string') : []
  const voices = Array.isArray(audio.voices) ? (audio.voices as unknown[]).map(v => 'voice-' + String(v)) : []
  const names = [...cues, 'music', ...voices]
  if (names.length < 2 || names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_-]*$/u.test(name))) {
    throw new ToolArgsError(['Game Studio: sampled-production necesita una lista válida de señales de sonido y música.'])
  }
  const tags = [...html.matchAll(/<audio\b[^>]*>/giu)].map(match => match[0])
  for (const cue of new Set(names as string[])) {
    const id = 'phoenix-audio-' + cue
    const tag = tags.find((value) => {
      const match = /\bid\s*=\s*(["'])([^"']+)\1/iu.exec(value)
      return match?.[2] === id
    })
    const src = tag === undefined ? undefined : /\bsrc\s*=\s*(["'])(.*?)\1/iu.exec(tag)?.[2]
    const encoded = /^data:audio\/(?:wav|ogg|mpeg);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(src ?? '')
    if (encoded === null || (encoded[1]?.length ?? 0) < 20) {
      throw new ToolArgsError(['Game Studio: falta sonido grabado incrustado para ' + cue + ' (id=' + id + ').'])
    }
    const bytes = Buffer.from(encoded[1] ?? '', 'base64')
    const isWav = (src ?? '').startsWith('data:audio/wav;base64,')
    const isOgg = (src ?? '').startsWith('data:audio/ogg;base64,')
    const recognized = isWav
      ? bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF'
        && bytes.toString('ascii', 8, 12) === 'WAVE'
      : isOgg
        ? bytes.length > 32 && bytes.toString('ascii', 0, 4) === 'OggS'
        : bytes.length > 32 && (bytes.toString('ascii', 0, 3) === 'ID3'
          || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
    if (!recognized) {
      throw new ToolArgsError(['Game Studio: audio inválido para ' + cue + '; no basta con un texto codificado como base64.'])
    }
  }
  const runtime = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter(match => !/\btype\s*=\s*["']application\/json["']/iu.test(match[1] ?? ''))
    .map(match => match[2] ?? '').join('\n')
  if (!/(?:\b(?:playSoundSample|playSound)|\.play)\s*\(/u.test(runtime)) {
    throw new ToolArgsError(['Game Studio: el audio de producción se incrustó pero no tiene reproducción desde los eventos del juego.'])
  }
}

/** Validate source packaging without executing untrusted game HTML or claiming gameplay QA.
 * @param html - Self-contained HTML from Kira's actual game output.
 * @returns Parsed manifest basics and art preflight classification.
 */
export function validateGameHtml(html: string): GameManifest {
  if (html.trim().length === 0) throw new ToolArgsError(['El videojuego HTML está vacío.'])
  if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=/iu.test(html)) {
    throw new ToolArgsError(['El juego debe incluir su JavaScript y CSS directamente: el visor aislado no carga CDN ni scripts externos.'])
  }
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|<img\b[^>]*\bsrc\s*=\s*["']https?:/iu.test(html)) {
    throw new ToolArgsError(['El juego debe funcionar sin red: incluye los recursos como data: URL o código autónomo.'])
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
  const manifestBlocks = scripts.filter(match => /\bid\s*=\s*["']phoenix-game-manifest["']/iu.test(match[1] ?? ''))
  if (manifestBlocks.length > 1) throw new ToolArgsError(['Hay más de un phoenix-game-manifest. Solo debe existir uno.'])
  const manifestBlock = manifestBlocks[0]
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
  for (const field of ['controls', 'level', 'audio']) {
    const entry = manifest[field]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ToolArgsError(['El manifiesto del juego necesita el objeto "' + field + '" definido antes de publicar.'])
    }
  }
  if (!scripts.some(match => match !== manifestBlock && (match[2] ?? '').trim().length > 0
    && !/\btype\s*=\s*["']application\/json["']/iu.test(match[1] ?? ''))) {
    throw new ToolArgsError(['Solo se recibió metadato o arte estático; el juego requiere JavaScript ejecutable.'])
  }
  if (!/<canvas\b|<button\b|<svg\b|<input\b|\brole\s*=\s*["']application["']/iu.test(html)) {
    throw new ToolArgsError(['Falta una superficie interactiva para jugar (Canvas o controles DOM).'])
  }
  validateBrawlerContract(manifest)
  validateRecordedAudio(html, manifest)
  return { schemaVersion: 1, title: manifest.title, genre: manifest.genre,
    artPreflight: validateGameArt(html, manifest) }
}


/** Enforce beat-em-up production semantics at the publishing boundary, not only in the client preview.
 * A prototype can still be published for iterative review, but is never reported as completed.
 */
function validateBrawlerContract(manifest: Record<string, unknown>): void {
  const genreValue = manifest.gameType ?? manifest.genre
  const genre = typeof genreValue === 'string' ? genreValue.toLowerCase() : ''
  if (!/beat.em.up|beat.?em.?up|brawler|double.dragon|street.fight|pelea.{0,9}callej|lucha.{0,9}callej/u.test(genre)) return
  const art = manifest.art as Record<string, unknown> | undefined
  if (!art || typeof art !== 'object' || art.mode !== 'production') return
  const validObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  const controls = manifest.controls as Record<string, unknown>
  for (const name of ['move', 'punch', 'kick', 'jump', 'grab']) {
    const value = controls[name]
    if (typeof value !== 'string' || !value.trim())
      throw new ToolArgsError(['Game Studio beat-em-up: control necesario ' + name])
  }
  const hero = manifest.player as Record<string, unknown> | undefined
  for (const state of ['idle', 'run', 'jump', 'punch', 'kick', 'grab', 'hurt', 'death']) {
    if (!validObject(hero?.animations) || !Number.isInteger(hero.animations[state])
      || (hero.animations[state] as number) < (['punch','kick','grab','run'].includes(state) ? 2 : 1)) {
      throw new ToolArgsError(['Game Studio beat-em-up: falta animación jugable ' + state])
    }
  }
  const enemies = Array.isArray(manifest.enemies) ? manifest.enemies as unknown[] : []
  if (enemies.length < 3 || enemies.some(enemy =>
    !validObject(enemy) || typeof enemy.id !== 'string' || !enemy.id.trim())
    || new Set(enemies.map(enemy => validObject(enemy) ? enemy.id : null)).size !== enemies.length) {
    throw new ToolArgsError(['Game Studio beat-em-up: producción exige al menos 3 enemigos originales diferentes.'])
  }
  const bosses = Array.isArray(manifest.bosses) ? manifest.bosses as unknown[] : []
  if (!bosses.length || bosses.some(boss =>
    !validObject(boss) || !Array.isArray(boss.phases) || boss.phases.length < 2
      || !Array.isArray(boss.attacks) || boss.attacks.length < 2 || boss.attacks.some((attack: unknown) =>
      !validObject(attack) || typeof attack.id !== 'string'
        || typeof attack.telegraphSeconds !== 'number' || attack.telegraphSeconds <= 0))) {
    throw new ToolArgsError(['Game Studio beat-em-up: jefe necesita 2 fases y 2 ataques con anticipación.'])
  }
  const combat = manifest.combat
  if (!validObject(combat) || combat.depthAxis !== true || combat.knockback !== true
    || !validObject(combat.hitboxes) || !Array.isArray(combat.combos) || combat.combos.length < 2
    || !Array.isArray(combat.grapples) || combat.grapples.length < 1) {
    throw new ToolArgsError(['Game Studio beat-em-up: faltan profundidad, hitboxes, knockback, combos y agarres reales.'])
  }
  const level = manifest.level
  if (!validObject(level) || !validObject(level.belt)
    || typeof level.belt.minY !== 'number' || typeof level.belt.maxY !== 'number'
    || level.belt.maxY <= level.belt.minY || !Array.isArray(level.zones) || level.zones.length < 2
    || !Array.isArray(level.layers) || level.layers.length < 3
    || typeof level.scrollLength !== 'number' || level.scrollLength < 1200) {
    throw new ToolArgsError(['Game Studio beat-em-up: crea escenario lateral con profundidad, dos zonas y tres capas.'])
  }
  const audio = manifest.audio
  const cues = validObject(audio) ? audio.cues : undefined
  if (!validObject(audio) || audio.mode !== 'sampled-production'
    || !Array.isArray(cues)
    || ['punch', 'kick', 'hit', 'grab', 'boss', 'pickup'].some(cue => !cues.includes(cue))) {
    throw new ToolArgsError(['Game Studio beat-em-up: audio final requiere samples originales con golpes, agarres, jefe, pickups y música.'])
  }
}

/**
 * Publish a complete offline game as the existing sandboxed Game Studio preview in the chat.
 * This validates packaging, not real keyboard/motion/audio behavior, which still needs testing.
 * @returns Game Studio tool definition with the dedicated executable game MIME.
 */
export function createPhoenixGameTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_game',
    description: 'Publish a COMPLETE self-contained PLAYABLE browser game directly inside this PHOENIX chat (Game Studio). Use for any in-chat 2D/2.5D/3D game, arcade, beat-em-up, shooter, platformer, puzzle, racing, rhythm or simulation. This is the actual in-chat game publisher; image_generation produces assets only and phoenix_canvas is for non-game apps. Supply HTML with inline CSS and executable JavaScript and interactive Canvas/DOM. ALWAYS author the genuine game manifest FIRST and pass it as manifest_json (a JSON string) alongside HTML; Phoenix inserts the required <script id="phoenix-game-manifest" type="application/json"> automatically if it is absent. The only supported auto-repair is JSON packaging, never made-up gameplay/entities/assets. A correctly typed existing JSON block without id is recovered. Check schemaVersion:1, title, genre, controls, level, audio and genre-specific player/enemies/animations before invoking phoenix_game. The legacy embedded-only manifest remains supported. No "upload rejected, adding manifest" loop. A JSON phoenix-game-manifest (schemaVersion:1, title, genre, controls, level, audio, and genre-appropriate player/enemies/animations). No external CDN, network requests, or remote assets. For representational 2D character games, declare art.mode: production with art.designReference, art.hero sprite PNG atlas frame grid, art.hero.animations and art.backgrounds with actual inline data PNG images referenced by drawImage. A concept/portrait PNG alone is NOT an animated playable character; do not replace an approved character with boxes or primitives. If art is missing, explicitly set art.mode: prototype and say the graphics are UNFINISHED; never present that as a completed professional game. Use the real saved assets and verify screenshot vs approved character. For Double Dragon-inspired beat-em-up games use gameType=beat-em-up, distinct attack/grab/jump sprites, three original enemy archetypes, a mobile boss with two telegraphed attacks, a walkable depth belt, multi-zone streets, hitboxes, combos, pickups and recorded punch/kick/grab/hit samples. A character-only geometric brawler is art.mode=prototype and MUST NOT be called final. A production run-and-gun requires the COMPLETE independently designed cast and world: art.enemies matching every manifest enemy id, art.bosses with animated frames for EVERY boss phase, art.backgrounds matching each level layer, art.weapons, art.projectiles, art.powers, art.props, and two different art.effects. Create these first, use real images in the running Canvas and never stop after hero-only concept art. Use the finite checklist from examples/game-studio/plan-game-assets.mjs before creation. For a shooter with no art object, publishing is rejected. Use real source/graphics/audio assets only if embed-ready. A game declaring audio.mode=sampled-production MUST embed original/licensed audio clips with ids phoenix-audio-<cue> for every audio.cues entry, phoenix-audio-music for the soundtrack, and phoenix-audio-voice-<name> for audio.voices entries, plus an actual playback call. Missing samples make publication fail; procedural tones are prototypes. The tool emits application/vnd.phoenix.game+html, which PHOENIX already renders in its sandboxed Game Studio player with export and structural preflight. The publication receipt is NOT proof of gameplay, audio or visual quality: run independent tests, report what was actually verified, and never call a PNG-only response a finished game. When La Forja is requested, delegate via the real spawn_teammate tool before publishing if available. No automatic mission termination: do not close a broader game mission until mandatory verification is complete.',
    parameters: {
      title: { type: 'string', required: true, description: 'Human-facing game title.' },
      html: { type: 'string', required: true, description: 'Complete offline HTML5 game with inline JS/CSS and working input/animation/gameplay; separate manifest_json is accepted and embedded automatically.' },
      manifest_json: { type: 'string', description: 'Strongly recommended for NEW games: complete JSON manifest authored BEFORE gameplay publication (schemaVersion:1, title, genre, gameType, controls, level, audio, and entities matching the actual game). Automatically added to HTML; no second upload attempt.' },
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
        text: `Game Studio: "${value.title}" publicado en el chat. ${value.preflight === 'prototype-only' ? 'PROTOTIPO: faltan los gráficos finales; no está terminado.' : 'Preflight estructural aprobado; el uso de atlas no demuestra fidelidad visual.'} Jugabilidad y audio pendientes de pruebas reales.`,
      }],
      presentationMeta: (args, value) => ({
        artifact: {
          id: value.artifactId,
          mime: PHOENIX_GAME_MIME,
          title: value.title,
          data: preparePhoenixGameSubmission(args.html, args.manifest_json),
          executable: true,
        },
      }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new ToolArgsError(['El título del juego no puede estar vacío.'])
      const source = validateGameHtml(preparePhoenixGameSubmission(args.html, args.manifest_json))
      return Promise.resolve({
        artifactId: `phoenix-game:${String(exec.callId)}`,
        title,
        preflight: source.artPreflight === 'prototype' ? 'prototype-only' : 'packaging-only',
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
