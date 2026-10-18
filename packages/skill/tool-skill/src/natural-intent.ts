/**
 * High-confidence routing hints for direct, natural-language user requests.
 * This is intentionally narrow: the model still handles open-ended and
 * ambiguous work through the normal skill catalog. Domain tools never infer
 * instructions from retrieved webpages, tool results, or quoted sources.
 */

/**
 * Return the shipped skill needed for an explicit request to create a game.
 * Genre and game title are unrestricted; users never need to name an engine,
 * a template path, a skill, or a publisher.
 * @param input - Text of an actual user-authored message (not tool content).
 * @returns Game Studio's skill name or undefined for unrelated/ambiguous text.
 */
export function naturalCreationSkill(input: string): 'game-development' | undefined {
  const normalized = input.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0 || normalized.length > 4000) return undefined

  // Explicit refusals and meta questions are not instructions to create.
  if (/^(?:no\s+(?:quiero|necesito|hagas|crees|generes|programes|hace|make|create|build)|sin\s+(?:crear|hacer|generar)|dont\s+(?:make|create|build)|do\s+not\s+(?:make|create|build))\b/u.test(normalized)) return undefined
  if (/^(?:como\s+(?:se\s+)?(?:hace|crear?|programar)|how\s+to\s+(?:make|create|build)|que\s+(?:es|significa))\b/u.test(normalized)) return undefined

  const game = '(?:videojuego|video game|juego|game|juegos|games)'
  const build = '(?:haz(?:me)?|hacer|crea(?:me)?|crear|creame|genera(?:me)?|desarrolla|programa|construye|disena|prepara|arma|make|build|create|generate|develop|code|design)'
  const command = new RegExp('(?:^|[.!?]\\s*)\\s*(?:(?:por favor|please|quiero que|necesito que|puedes|podrias|can you|could you|me gustaria que)\\s+){0,3}' + build + '(?:\\s+\\S+){0,9}?\\s+(?:(?:un|una|el|la|a|an|the|mi|me|some|a simple)\\s+)?' + game + '(?:\\b|$)', 'u')
  const desired = new RegExp('(?:^|[.!?]\\s*)\\s*(?:quiero|necesito|dame|me gustaria|i want|i need|give me|build me|make me)(?:\\s+\\S+){0,4}?\\s+(?:(?:un|una|a|an|the)\\s+)?' + game + '(?:\\b|$)', 'u')
  const short = new RegExp('^(?:(?:un|una|a|an)\\s+)?' + game + '\\s+(?:tipo|estilo|de|sobre|similar|like|about|with|para|for)\\b', 'u')
  if (command.test(normalized) || desired.test(normalized) || short.test(normalized)) return 'game-development'
  return undefined
}
