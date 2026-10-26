/** Activate sports-specific guidance only for sports work, not every chat. */
interface PromptEvent {
  readonly type: string
  readonly data: unknown
}

// Keep sports tool schemas and execution enabled; this only avoids irrelevant prose.
// oxlint-disable-next-line @stylistic/max-len -- One auditable sports-intent regex with explicit word boundaries.
const SPORTS_TOPIC = /\b(?:deport(?:e|es)|sports?|f[uú]tbol|futbol|soccer|football|b[eé]isbol|beisbol|baseball|mlb|nba|nfl|nhl|baloncesto|basketball|tenis|tennis|hockey|cricket|espn|pitchers?|bullpen|cuotas?|odds|apuestas?|sportsbook|pron[oó]stic(?:o|os)|picks?|ticket(?:s)?|bolet(?:o|os))\b/iu
// oxlint-disable-next-line @stylistic/max-len -- Strict continuation matching avoids unrelated task contamination.
const SHORT_CONTINUATION = /^(?:s[ií]|dale|ok|okay|contin[uú]a|sigue|adelante|hazlo|mu[eé]strame|ampl[ií]a|esos?|esas?|y\s+(?:el|la|los|las|eso))\s*[.!?¿¡]*$/iu

function recentHumanMessages(events: readonly PromptEvent[] | undefined): string[] {
  const messages: string[] = []
  if (events === undefined) return messages
  for (let i = events.length - 1; i >= 0 && messages.length < 2; i--) {
    const event = events[i]
    if (event === undefined || event.type !== 'user/message') continue
    const data = event.data as {
      source?: { kind?: string }
      content?: readonly { type?: string; text?: string }[]
    }
    if (data?.source?.kind !== 'user') continue
    const text = data.content?.filter(block => block.type === 'text')
      .map(block => block.text ?? '').join(' ').trim()
    if (text) messages.push(text)
  }
  return messages
}

/**
 * Select sports guidance from a pending human message or earlier durable input.
 * @param incomingUserText - Current human message before it is appended to the journal.
 * @param events - Durable session events used only for short follow-up continuity.
 * @returns Whether sports-specific instructions are relevant to the next model step.
 */
export function sportsPromptNeeded(incomingUserText: string | undefined, events: readonly PromptEvent[] | undefined): boolean {
  const history = recentHumanMessages(events)
  const current = incomingUserText?.trim() || history[0] || ''
  if (SPORTS_TOPIC.test(current)) return true
  // Short sports follow-ups stay supported, but a new unrelated task deactivates guidance.
  const previous = incomingUserText?.trim() ? history[0] : history[1]
  return SHORT_CONTINUATION.test(current) && previous !== undefined && SPORTS_TOPIC.test(previous)
}
