/**
 * Presentation-only routing label for the visible user bubble.
 * The original text, including @mentions, remains unchanged in the model log.
 * Keep this roster aligned with KiraTeamsDock until a shared registry is available.
 */
const TEAM_NAMES = [
  'Kira', 'Vórtice', 'Aurora', 'Atlas', 'Nova', 'Lumen', 'Helix', 'Prisma',
  'Orión', 'Vega', 'Eclipse', 'Argo', 'Solaria', 'Nexo', 'Astra', 'Lyra',
  'Zenith', 'Cobalto', 'Quasar', 'Senda', 'Órbita', 'La Forja', 'Aegis',
] as const

function normalize(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim()
}

function recipientName(raw: string): string | undefined {
  const clean = raw.replace(/[,;:!?，。；：！？]+$/gu, '')
  return TEAM_NAMES.find(name => normalize(name) === normalize(clean))
}

/**
 * Test whether an inline token names a Kira Team teammate, not a file or folder.
 * @param token Inline token to inspect.
 * @returns Whether the token names a teammate.
 */
export function isTeamMention(token: string): boolean {
  if (!token.startsWith('@')) return false
  const raw = token.slice(1).replace(/^"|"$/gu, '')
  return recipientName(raw) !== undefined
}

/**
 * Extract an opening teammate address for display without modifying the authored text.
 * @param text Original teammate message.
 * @returns Directed recipient and remaining body, if recognized.
 */
export function parseDirectedTeamMessage(text: string): { recipient: string; body: string } | undefined {
  const match = /^\s*@(?:"([^"\n]+)"|([^\s]+))(?=\s|$)/u.exec(text)
  if (match === null) return undefined
  const recipient = recipientName(match[1] ?? match[2] ?? '')
  if (recipient === undefined) return undefined
  return { recipient, body: text.slice(match[0].length).trimStart() }
}
