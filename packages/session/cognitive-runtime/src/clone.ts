/** Runtime cloning helpers for detached cognitive projections. */

import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import type { AttentionCandidate } from './types.ts'

/**
 * Clone one record and its nested arrays so projections do not alias the ledger.
 * @param record - The ledger record to detach.
 * @returns A detached copy of the cognitive-memory record.
 */
export function cloneCognitiveRecord(record: CognitiveMemoryRecord): CognitiveMemoryRecord {
  return {
    ...record,
    layers: [...record.layers],
    entities: record.entities.map(entity => ({ ...entity })),
    relations: record.relations.map(relation => ({ ...relation })),
    provenance: { ...record.provenance },
  }
}

/**
 * Clone one candidate and its nested record for an independent projection snapshot.
 * @param candidate - The candidate to detach.
 * @returns A detached copy of the attention candidate.
 */
export function cloneAttentionCandidate(candidate: AttentionCandidate): AttentionCandidate {
  return {
    record: cloneCognitiveRecord(candidate.record),
    signals: { ...candidate.signals },
    score: candidate.score,
    reasons: [...candidate.reasons],
  }
}
