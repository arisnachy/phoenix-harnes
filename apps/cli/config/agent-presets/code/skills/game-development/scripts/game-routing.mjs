/**
 * Universal Game Studio routing. A genre is a hint, not a fixed template.
 * Lightweight board/arcade games may use Phoenix's internal HTML engine;
 * character-heavy, physics-rich, 3D and other complex games use Godot.
 * Routing does NOT assert that a renderer or an export actually succeeded.
 */
const RETRO_FAMILIES = Object.freeze([
  { family: 'falling-blocks', pattern: /\b(?:tetris|falling.blocks|bloques.que.caen)\b/u },
  { family: 'snake', pattern: /\b(?:snake|serpiente|viborita|snake3)\b/u },
  { family: 'pong', pattern: /\b(?:pong|ping.pong|tenis.de.mesa)\b/u },
  { family: 'maze-arcade', pattern: /\b(?:pac.man|pacman|come.cocos|comecocos)\b/u },
  { family: 'brick-breaker', pattern: /\b(?:breakout|arkanoid|rompe.ladrillos)\b/u },
  { family: 'board', pattern: /\b(?:chess|ajedrez|checkers|damas|domino|dominoes|backgammon|go.board|tres.en.raya|tic.tac.toe)\b/u },
  { family: 'cards', pattern: /\b(?:solitaire|solitario|uno.cards|juego.de.cartas|memory.cards)\b/u },
  { family: 'logic', pattern: /\b(?:2048|sudoku|minesweeper|buscaminas|sopa.de.letras|nonogram|picross|rompecabezas|jigsaw)\b/u },
])
const ADVANCED = /\b(?:3d|2\.5d|tridimensional|third.person|first.person|primera.persona|tercera.persona|mundo.abierto|open.world|multiplayer|multijugador|online|cooperativo|coop|networked|realista|realistic|simulador|simulation|fisica.avanzada|advanced.physics|ragdoll|fps|mmorpg|rpg|plataformas|platformer|combate|combat|lucha|fighting|beat.em.up|shooter|disparos|boss|jefe.final|cinematico|cinematic|metaverso|vr|realidad.virtual|realidad.aumentada|procedural.world|mundo.procedural)\b/u
const THREE_D = /\b(?:3d|tridimensional|third.person|first.person|primera.persona|tercera.persona|open.world|mundo.abierto|vr|realidad.virtual)\b/u

/** Determine the minimum *authoring* engine without fabricating gameplay. */
export function classifyGameRequest(genre) {
  if (typeof genre !== 'string' || genre.trim().length === 0) throw new Error('Genre cannot be empty.')
  const description = genre.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  const matched = RETRO_FAMILIES.find(item => item.pattern.test(description))
  const advanced = ADVANCED.test(description)
  return {
    family: matched?.family ?? 'custom',
    isRetro: matched !== undefined && !advanced,
    is3d: THREE_D.test(description),
    hasAdvancedRequirements: advanced,
  }
}

/**
 * Selects engine and *truthful* publishing contract. Only a self-contained HTML
 * game can currently be submitted through phoenix_game. Godot's web export is a
 * bundle (HTML+JS+WASM+PCK), requiring a separate host/player integration.
 */
export function routeGame(genre, delivery, quality) {
  if (!['chat', 'desktop', 'web'].includes(delivery)) throw new Error('Delivery must be chat, desktop or web.')
  if (!['prototype', 'production'].includes(quality)) throw new Error('Quality must be prototype or production.')
  const classification = classifyGameRequest(genre)
  const internal = classification.isRetro
  const engine = internal ? 'html5' : 'godot'
  const tools = internal ? [] : ['godot', classification.is3d ? 'blender' : 'tiled', 'ffmpeg']
  const inChat = delivery === 'chat'
  const publishFormat = internal ? 'standalone-html' : 'godot-web-export-bundle'
  const chatPublisherReady = internal && inChat
  const renderer = inChat
    ? (internal ? 'phoenix_game-single-file-html' : 'godot-web-bundle-host-required')
    : (internal ? 'standalone-web-html' : 'native-project-or-hosted-godot-export')
  return {
    genre, delivery, quality, engine, authoringEngine: engine, tools, renderer, publishFormat,
    gameFamily: classification.family, isRetro: classification.isRetro,
    chatPublisherReady, requiresWebBundlePublisher: inChat && !internal,
    action: internal
      ? 'Create and test a standalone playable retro/board/logic HTML game, with complete rules, accessible controls, responsive sizing and an authored manifest. Publish directly with phoenix_game.'
      : 'Author and test the real Godot project. For chat, export the SAME game to a multi-file Godot Web package. Never silently rewrite the game as a separate HTML5 imitation; do not report in-chat publication without a real bundle host and playback evidence.',
    authoringRule: internal
      ? 'Use Phoenix internal engine only for genuinely lightweight retro/board/puzzle experiences; original art and real rule validation are still required.'
      : 'Godot is the sole source of gameplay for this request. Use verified scenes, character art, physics, audio and automated plus actual playtests.',
    godotWebNote: !internal
      ? 'Web playback needs a genuine Godot Web export (HTML, JS, WASM, PCK and companion files), secure HTTP hosting, WebGL2 and the Compatibility renderer. Prefer single-threaded export. Godot 4 C# projects cannot currently target Web. Existing phoenix_game only accepts self-contained HTML, so this route is NOT certified for in-chat Godot playback yet.'
      : undefined,
    gate: internal
      ? 'Verify playable rules, controls, scoring, restart, responsive sizing and the real in-chat iframe; publishing metadata is not gameplay proof.'
      : 'Verify authentic integrated characters/scenes, orientation, hitboxes, enemy behavior, level layers, sampled audio, web export and real browser playback; never substitute geometric placeholder characters as production art.',
  }
}
