/** Runtime cloning helpers for detached cognitive projections. */

import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import type { AttentionCandidate } from './types.ts'

/** Clone one record and its nested arrays so projections do not alias the ledger. */
export function cloneCognitiveRecord(record: CognitiveMemoryRecord): CognitiveMemoryRecord {
  return {
    ...record,
    layers: [...record.layers],
    entities: record.entities.map(entity => ({ ...entity })),
    relations: record.relations.map(relation => ({ ...relation })),
    provenance: { ...record.provenance },
  }
}

/** Clone one candidate and its nested record for an independent projection snapshot. */
export function cloneAttentionCandidate(candidate: AttentionCandidate): AttentionCandidate {
  return {
    record: cloneCognitiveRecord(candidate.record),
    signals: { ...candidate.signals },
    score: candidate.score,
    reasons: [...candidate.reasons],
  }
}
