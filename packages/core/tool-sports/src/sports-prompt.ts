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
// Understand the task, not just one spelling of "deporte": informal prediction requests are sports intent.
const PREDICTION_INTENT = /\b(?:qui[eé]n(?:es)?\s+(?:va(?:n)?\s+a\s+)?ganar[aá]?|qu[eé]\s+equipo\s+(?:gana|ganar[aá]|es\s+(?:el\s+)?favorito)|cua?l(?:es)?\s+(?:es|son)\s+(?:el|los)\s+favoritos?|predic(?:e|ci[oó]n|ciones)|pronostic(?:a|ar)|simula\s+(?:el\s+)?(?:encuentro|partido)|ticket\s+ganador|apuestas?\s+de\s+hoy|an[aá]lisis\s+(?:del?\s+)?partido)\b/iu
const TASK_CONTINUATION = /\b(?:investig(?:a|ar|aci[oó]n)|analiz(?:a|ar)|compara|mu[eé]strame|detalla|pronostica|predice|probabilidad(?:es)?|favorito|estad[ií]sticas?|lesionados?|cuotas?|mercados?|ticket|patas|partidos?|encuentros?|predicci[oó]n)\b/iu

function recentHumanMessages(events: readonly PromptEvent[] | undefined): string[] {
  const messages: string[] = []
  if (events === undefined) return messages
  for (let i = events.length - 1; i >= 0 && messages.length < 5; i--) {
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
  if (SPORTS_TOPIC.test(current) || PREDICTION_INTENT.test(current)) return true
  // Continuations inherit sports context, even if the user only says "investiga el primero".
  // Reject unrelated new tasks rather than injecting sports guidance in every conversation.
  const earlier = incomingUserText?.trim() ? history : history.slice(1)
  const isFollowup=SHORT_CONTINUATION.test(current)||TASK_CONTINUATION.test(current)
  if(!isFollowup)return false
  for(const message of earlier.slice(0,3)){
    if(SPORTS_TOPIC.test(message)||PREDICTION_INTENT.test(message))return true
    // A new non-sports topic terminates the previous sports context.
    if(!SHORT_CONTINUATION.test(message)&&!TASK_CONTINUATION.test(message))return false
  }
  return false
}
