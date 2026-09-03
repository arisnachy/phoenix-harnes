/** Pure detection of unresolved executable work at a turn stop boundary. */

import type { SessionEvent } from '@phoenix-ai/dsh-session'

/** Evidence required before an ordinary human turn may become a persistent mission. */
export interface MissionDebtBootstrap {
  /** Exact direct-human objective recovered from the current turn. */
  readonly objective: string
  /** Bounded assistant line that explicitly left work unresolved. */
  readonly evidence: string
}

const MAX_EVIDENCE = 500
const PENDING_HEADING = /^(?:[-*]\s*)?(?:\*\*)?(?:pendiente(?:s)?|pending|remaining|to\s+do|todo)(?:\*\*)?\s*:/iu
const UNRESOLVED_PHRASE = /\b(?:(?:todav[ií]a|a[uú]n)\s+no|not\s+yet|still\s+not|still\s+needs?\s+to|still\s+need\s+to|remains?\s+to\s+be)\b/iu
const RESOLVED_PENDING = /\b(?:no\s+(?:hay|queda(?:n)?|existe(?:n)?)\s+(?:nada\s+)?pendiente(?:s)?|nothing\s+(?:is\s+)?pending|no\s+pending\s+(?:work|items?))\b/iu

/** Return text carried by one message-like durable payload. */
function messageText(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content.flatMap((block) => {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) return []
    const record = block as { type?: unknown; text?: unknown }
    return record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
  }).join('\n').trim()
}

/** Events accepted by one exact currently open turn. */
function eventsForTurn(events: readonly SessionEvent[], turn: number): readonly SessionEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) return events.slice(index + 1)
  }
  return []
}

/** Last explicit unresolved-debt line from the candidate assistant response. */
function debtEvidence(text: string): string | undefined {
  for (const rawLine of text.split(/\r?\n/u).toReversed()) {
    const line = rawLine.trim()
    if (line.length === 0 || RESOLVED_PENDING.test(line)) continue
    if (PENDING_HEADING.test(line) || UNRESOLVED_PHRASE.test(line)) {
      return line.slice(0, MAX_EVIDENCE)
    }
  }
  return undefined
}

/**
 * Prove that an ordinary top-level turn performed executable work but tried to
 * stop while explicitly leaving work unresolved.
 * @param events - durable session events including the current open turn.
 * @param turn - current turn number supplied by `agent/turn-stopping`.
 * @returns direct-human objective plus debt evidence, or `undefined` when the
 * turn should be allowed to stop normally.
 */
export function missionDebtBootstrap(
  events: readonly SessionEvent[],
  turn: number,
): MissionDebtBootstrap | undefined {
  const window = eventsForTurn(events, turn)
  if (!window.some(event => event.type === 'tool/call')) return undefined

  const human = window.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (human?.type !== 'user/message') return undefined
  const objective = messageText(human.data)
  if (objective.length === 0) return undefined

  const assistant = window.findLast(event => event.type === 'assistant/message')
  if (assistant?.type !== 'assistant/message') return undefined
  const evidence = debtEvidence(messageText(assistant.data.message))
  return evidence === undefined ? undefined : { objective, evidence }
}
