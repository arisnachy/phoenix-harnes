/** Provider-neutral metacognitive evidence. No model calls, raw prompts or authority changes. */
import type { ExperienceAggregate } from './experience.ts'

/** Evidence coverage of previous attempts, not a prediction of future correctness. */
export interface MetaEvidence {
  readonly attempts: number
  readonly verified: number
  readonly failed: number
  readonly unverified: number
  readonly verifiedFraction: number | null
  readonly sufficientForReuse: boolean
}

/** Separate observed verification from uncertainty; unverified is not successful or failed.
 * @param state - Durable task experience from the existing memory owner.
 * @returns Factual counts and a conservative reuse gate.
 */
export function assessMetaEvidence(state: Pick<ExperienceAggregate, 'runs' | 'verifiedSuccesses' | 'failures'>): MetaEvidence {
  const { runs, verifiedSuccesses, failures } = state
  const valid = [runs, verifiedSuccesses, failures].every(n => Number.isSafeInteger(n) && n >= 0)
    && verifiedSuccesses + failures <= runs
  if (!valid) return { attempts: 0, verified: 0, failed: 0, unverified: 0, verifiedFraction: null, sufficientForReuse: false }
  const fraction = runs === 0 ? null : verifiedSuccesses / runs
  return { attempts: runs, verified: verifiedSuccesses, failed: failures, unverified: runs - verifiedSuccesses - failures,
    verifiedFraction: fraction, sufficientForReuse: verifiedSuccesses >= 3 && fraction !== null && fraction >= 0.8 }
}

/** Failure category is an operational clue, never a diagnosis without inspection. */
export type MetaFailure = 'permission' | 'quota' | 'context' | 'transport' | 'invalid-input' | 'cancelled' | 'unknown'

/** Categorize only machine error codes, not untrusted tool text or model speculation.
 * @param error - Structured error from a canonical session event.
 * @returns Known evidence category or unknown.
 */
export function classifyMetaFailure(error: unknown): MetaFailure {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return 'unknown'
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string' || code.length > 128) return 'unknown'
  if (/^(?:TOOL_ABORTED(?:_BEFORE_DISPATCH)?|ABORT_ERR|ABORTED|CANCELLED)$/iu.test(code)) return 'cancelled'
  if (/(?:PERMISSION|FORBIDDEN|UNAUTHORIZED|APPROVAL|ACCESS_DENIED|AUTH_REQUIRED)/iu.test(code)) return 'permission'
  if (/(?:QUOTA|RATE_LIMIT|RESOURCE_EXHAUSTED)/iu.test(code)) return 'quota'
  if (/(?:CONTEXT_WINDOW|CONTEXT_LENGTH|CONTEXT_LIMIT|TOKEN_LIMIT)/iu.test(code)) return 'context'
  if (/(?:TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|NETWORK|TRANSPORT|STREAM_IDLE)/iu.test(code)) return 'transport'
  if (/(?:INVALID_ARG|INVALID_INPUT|VALIDATION|SCHEMA|BAD_REQUEST)/iu.test(code)) return 'invalid-input'
  return 'unknown'
}

/** Actionable guidance constrained to existing tools, policies and verified evidence.
 * @param failure - Classified machine error.
 * @returns A short diagnostic next step, or undefined when evidence is insufficient.
 */
export function metaRecoveryHint(failure: MetaFailure): string | undefined {
  switch (failure) {
    case 'permission': return 'Permission or authentication failure: respect the denial; inspect existing authorization and request approval only through the normal policy. Never bypass it.'
    case 'quota': return 'Quota or rate limit signal: inspect live provider availability and retry timing. Use only an already-authorized alternative under the current routing policy.'
    case 'context': return 'Context limit signal: preserve current constraints and verified artifacts using existing checkpoint/compaction; do not invent a context limit or discard the task.'
    case 'transport': return 'Transport failure signal: check availability and connection state; use a bounded retry only when new evidence supports it.'
    case 'invalid-input': return 'Input validation signal: inspect the actual tool schema and correct the arguments before another call.'
    default: return undefined
  }
}

/** Canonical tool results carry source.callId; older fixtures used message.callId.
 * @param message - Tool-result message envelope.
 * @returns Valid call identity, or undefined.
 */
export function metaResultCallId(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined
  const value = message as { source?: { callId?: unknown }; callId?: unknown }
  const id = value.source?.callId ?? value.callId
  return typeof id === 'string' && id.length > 0 && id.length <= 512 ? id : undefined
}
