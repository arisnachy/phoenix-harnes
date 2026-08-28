/** Durable, secret-free audit records for governed HARDNESS missions. */

import type { CallId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { CapabilityId } from '@deepseek-ai/dsh-hardness'
import type { HardnessProtocolStep } from '@deepseek-ai/dsh-hardness'

/** Terminal state recorded for one HARDNESS protocol step. */
export type HardnessMissionAuditOutcome = 'completed' | 'blocked'

/** One replayable, model-safe audit row for a governed mission. */
export interface HardnessMissionAuditEntry {
  readonly callId: CallId
  readonly step: HardnessProtocolStep
  readonly outcome: HardnessMissionAuditOutcome
  readonly capabilityKind: string
  readonly capabilityId?: CapabilityId
  readonly descriptorVersion?: string
  /** Stable reason code; provider error text and arguments are deliberately excluded. */
  readonly reasonCode?: string
  readonly artifactId?: string
  readonly evidenceId?: string
  readonly durationMs?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One terminal state in the governed HARDNESS mission protocol. */
    'hardness/mission': HardnessMissionAuditEntry
  }
}

/** Sink used by a mission to append its protocol trace to the calling session. */
export interface HardnessMissionAuditWriter {
  record(entry: HardnessMissionAuditEntry): void
}

/** Create a session-backed HARDNESS audit writer. */
export function createHardnessMissionAudit(session: Session): HardnessMissionAuditWriter {
  return {
    record(entry) {
      session.append('hardness/mission', entry)
    },
  }
}

/** Replay all audit rows belonging to one model tool call in log order. */
export function replayHardnessMissionAudit(
  events: readonly SessionEvent[],
  callId: CallId,
): readonly HardnessMissionAuditEntry[] {
  return events
    .filter((event): event is SessionEvent<'hardness/mission'> => event.type === 'hardness/mission' && event.data.callId === callId)
    .map(event => event.data)
}
