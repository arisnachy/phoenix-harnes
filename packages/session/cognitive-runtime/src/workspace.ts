/** Construction of a detached global-workspace snapshot. */

import type { SessionId } from '@phoenix-ai/dsh-session'
import { cloneAttentionCandidate } from './clone.ts'
import type { AttentionCandidate, CognitiveState, WorkingMemoryPartition } from './types.ts'

/**
 * Build the session-scoped global workspace from an existing attention partition.
 * @param sessionId - Exact session identity represented by the snapshot.
 * @param projectId - Optional project provenance copied from the ledger.
 * @param observedSeq - Highest durable session event sequence represented.
 * @param candidates - Active candidates considered before budget partitioning.
 * @param partition - Focus and memory regions derived from the candidates.
 * @returns A detached process-local cognitive state.
 */
export function createGlobalWorkspace(
  sessionId: SessionId,
  projectId: string | undefined,
  observedSeq: number,
  candidates: readonly AttentionCandidate[],
  partition: WorkingMemoryPartition,
): CognitiveState {
  return {
    sessionId,
    ...projectId === undefined ? {} : { projectId },
    observedSeq,
    candidateCount: candidates.length,
    ...partitionCopy(partition),
  }
}

function partitionCopy(partition: WorkingMemoryPartition): WorkingMemoryPartition {
  return {
    ...partition.focus === undefined ? {} : { focus: cloneAttentionCandidate(partition.focus) },
    active: partition.active.map(cloneAttentionCandidate),
    background: partition.background.map(cloneAttentionCandidate),
    suppressed: partition.suppressed.map(cloneAttentionCandidate),
  }
}
