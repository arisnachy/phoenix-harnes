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
  if (!scripts.some(match => match !== manifestBlock && (match[2] ?? '').trim().length > 0
    && !/\btype\s*=\s*["']application\/json["']/iu.test(match[1] ?? ''))) {
    throw new ToolArgsError(['Solo se recibió metadato o arte estático; el juego requiere JavaScript ejecutable.'])
  }
  if (!/<canvas\b|<button\b|<svg\b|<input\b|\brole\s*=\s*["']application["']/iu.test(html)) {
    throw new ToolArgsError(['Falta una superficie interactiva para jugar (Canvas o controles DOM).'])
  }
  return { schemaVersion: 1, title: manifest.title, genre: manifest.genre,
    artPreflight: validateGameArt(html, manifest) }
}

/**
 * Publish a complete offline game as the existing sandboxed Game Studio preview in the chat.
 * This validates packaging, not real keyboard/motion/audio behavior, which still needs testing.
 * @returns Game Studio tool definition with the dedicated executable game MIME.
 */
export function createPhoenixGameTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_game',
    description: 'Publish a COMPLETE self-contained PLAYABLE browser game directly inside this PHOENIX chat (Game Studio). Use for any in-chat 2D/2.5D/3D game, arcade, shooter, platformer, puzzle, racing, rhythm or simulation. This is the actual in-chat game publisher; image_generation produces assets only and phoenix_canvas is for non-game apps. Supply HTML with inline CSS and executable JavaScript, interactive Canvas/DOM and a JSON phoenix-game-manifest (schemaVersion:1, title, genre, controls, level, audio, and genre-appropriate player/enemies/animations). No external CDN, network requests, or remote assets. For representational 2D character games, declare art.mode: production with art.designReference, art.hero sprite PNG atlas frame grid, art.hero.animations and art.backgrounds with actual inline data PNG images referenced by drawImage. A concept/portrait PNG alone is NOT an animated playable character; do not replace an approved character with boxes or primitives. If art is missing, explicitly set art.mode: prototype and say the graphics are UNFINISHED; never present that as a completed professional game. Use the real saved assets and verify screenshot vs approved character. A production run-and-gun requires the COMPLETE independently designed cast and world: art.enemies matching every manifest enemy id, art.bosses with animated frames for EVERY boss phase, art.backgrounds matching each level layer, art.weapons, art.projectiles, art.powers, art.props, and two different art.effects. Create these first, use real images in the running Canvas and never stop after hero-only concept art. Use the finite checklist from examples/game-studio/plan-game-assets.mjs before creation. For a shooter with no art object, publishing is rejected. Use real source/graphics/audio assets only if embed-ready. The tool emits application/vnd.phoenix.game+html, which PHOENIX already renders in its sandboxed Game Studio player with export and structural preflight. The publication receipt is NOT proof of gameplay, audio or visual quality: run independent tests, report what was actually verified, and never call a PNG-only response a finished game. When La Forja is requested, delegate via the real spawn_teammate tool before publishing if available. No automatic mission termination: do not close a broader game mission until mandatory verification is complete.',
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
        text: `Game Studio: "${value.title}" publicado en el chat. ${value.preflight === 'prototype-only' ? 'PROTOTIPO: faltan los gráficos finales; no está terminado.' : 'Preflight estructural aprobado; el uso de atlas no demuestra fidelidad visual.'} Jugabilidad y audio pendientes de pruebas reales.`,
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
      const source = validateGameHtml(args.html)
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
