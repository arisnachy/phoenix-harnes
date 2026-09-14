/** Conservative autonomous curation of durable, user-authored learning. */

const MAX_TEXT_CHARS = 2_048

/** Durable memory categories that Phoenix may infer from explicit user language. */
export type AutonomousMemoryKind = 'preference' | 'correction'

/** Classifier result for one user-authored durable memory candidate. */
export interface AutonomousMemoryCandidate {
  readonly kind: AutonomousMemoryKind
  readonly summary: string
  readonly confidence: number
  readonly importance: number
}

/** One durable cognitive-memory write emitted by the autonomous curator. */
export interface AutonomousMemoryWrite {
  readonly sessionId: string
  readonly eventSeq: number
  readonly kind: 'preference' | 'lesson'
  readonly layers: readonly ('autobiographical' | 'semantic' | 'procedural' | 'temporal')[]
  readonly content: string
  readonly summary: string
  readonly sourceEventType: string
  readonly occurredAt: number
  readonly confidence: number
  readonly importance: number
  readonly subject: string
  readonly value: string
  readonly projectId?: string
}

/** Storage seam used by the autonomous curator. */
export interface AutonomousMemoryStore {
  /**
   * Persist one bounded cognitive-memory row.
   * @param input - Secret-free memory write.
   * @returns Completion when the write is durable.
   */
  remember(input: AutonomousMemoryWrite): Promise<void>
}

/** Provenance for one user-authored message observed by the curator. */
export interface AutonomousUserMessage {
  readonly text: string
  readonly sessionId: string
  readonly eventSeq: number
  readonly occurredAt: number
  readonly projectId?: string
}

/**
 * Classify only strongly signaled durable user guidance; ordinary chatter and one-off instructions are discarded.
 * @param text - User-authored message.
 * @returns Durable candidate or undefined when retention is not justified.
 */
export function classifyAutonomousMemory(text: string): AutonomousMemoryCandidate | undefined {
  const summary = normalize(text)
  if (summary === '' || summary.length > MAX_TEXT_CHARS || containsSecret(summary)) return undefined
  const folded = fold(summary)
  const durable = /\b(?:quiero que siempre|prefiero que|de ahora en adelante|a partir de ahora|cada vez que|siempre que|nunca quiero que|i prefer|from now on|every time|whenever|always)\b/iu.test(folded)
  const correction = /\b(?:corrijo|correccion|eso esta mal|eso es incorrecto|te dije que no|de ahora en adelante|from now on|that is wrong|that's wrong|incorrect|correction)\b/iu.test(folded)
  const transient = /\b(?:esta vez|solo esta vez|por ahora|ahora mismo|temporalmente|this time|just this time|for now|temporarily)\b/iu.test(folded)
  if (transient && !durable) return undefined
  if (correction) return { kind: 'correction', summary, confidence: 0.96, importance: 0.96 }
  if (durable) return { kind: 'preference', summary, confidence: 0.93, importance: 0.93 }
  return undefined
}

/** Autonomous curator that turns strong user-authored durability signals into cognitive memory. */
export class AutonomousMemoryCurator {
  private readonly lastDurableSubject = new Map<string, string>()

  constructor(private readonly store: AutonomousMemoryStore) {}

  /**
   * Observe one user message and persist it when it clearly expresses durable guidance or correction.
   * @param input - Message plus session/project provenance.
   * @returns The retained candidate, or undefined when the message should not be stored.
   */
  async observeUserMessage(input: AutonomousUserMessage): Promise<AutonomousMemoryCandidate | undefined> {
    const candidate = classifyAutonomousMemory(input.text)
    if (candidate === undefined) return undefined
    const kind = candidate.kind === 'preference' ? 'preference' : 'lesson'
    const sourceEventType = candidate.kind === 'preference'
      ? 'autonomous/user-preference'
      : 'autonomous/user-correction'
    const scope = memoryScope(input)
    const generatedSubject = `phoenix.learning.autonomous.${candidate.kind}.${memoryKey(candidate.summary)}`
    const subject = candidate.kind === 'correction'
      ? this.lastDurableSubject.get(scope) ?? generatedSubject
      : generatedSubject
    await this.store.remember({
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      kind,
      layers: candidate.kind === 'preference'
        ? ['autobiographical', 'semantic', 'temporal']
        : ['autobiographical', 'semantic', 'procedural', 'temporal'],
      content: candidate.summary,
      summary: candidate.summary,
      sourceEventType,
      occurredAt: input.occurredAt,
      confidence: candidate.confidence,
      importance: candidate.importance,
      subject,
      value: JSON.stringify({ version: 1, ...candidate }),
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
    })
    this.lastDurableSubject.set(scope, subject)
    return candidate
  }
}

function memoryScope(input: AutonomousUserMessage): string {
  return input.projectId === undefined ? `session:${input.sessionId}` : `project:${input.projectId}`
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
}

function containsSecret(value: string): boolean {
  return [
    /\bbearer\s+\S+/iu,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/iu,
    /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  ].some(pattern => pattern.test(value))
}

function memoryKey(value: string): string {
  const source = fold(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
