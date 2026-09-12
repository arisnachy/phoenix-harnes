/** Pure data types for the deterministic PHOENIX cognitive projection. */

import type { SessionId } from '@phoenix-ai/dsh-session'
import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'

/** Relative contribution of each persisted attention signal. */
export interface AttentionWeights {
  /** Contribution of the ledger's importance estimate. */
  readonly importance: number
  /** Contribution of the ledger's confidence estimate. */
  readonly confidence: number
  /** Contribution of persisted observation recency. */
  readonly recency: number
  /** Contribution of pending or failed work urgency. */
  readonly urgency: number
  /** Contribution of mission and prospective-work relevance. */
  readonly goalRelevance: number
  /** Contribution of low observation frequency. */
  readonly novelty: number
}

/** Normalized signals used to produce one attention score. */
export interface AttentionSignals {
  /** Ledger importance in the inclusive range 0..1. */
  readonly importance: number
  /** Ledger confidence in the inclusive range 0..1. */
  readonly confidence: number
  /** Recency normalized from persisted observation times. */
  readonly recency: number
  /** Whether the record describes pending or failed work. */
  readonly urgency: number
  /** Whether the record is mission or prospective work. */
  readonly goalRelevance: number
  /** Inverse frequency, capped at 1. */
  readonly novelty: number
}

/** One detached record with explainable deterministic attention ranking. */
export interface AttentionCandidate {
  /** Detached cognitive-memory record used by this candidate. */
  readonly record: CognitiveMemoryRecord
  /** Signal values before weighting. */
  readonly signals: AttentionSignals
  /** Weighted normalized score in the inclusive range 0..1. */
  readonly score: number
  /** Stable human-readable signal names that contributed to the score. */
  readonly reasons: readonly string[]
}

/** Focus, active, background, and budget-suppressed working-memory partitions. */
export interface WorkingMemoryPartition {
  /** Highest-ranked candidate, when any active record exists. */
  readonly focus?: AttentionCandidate
  /** Candidates after focus up to the active budget. */
  readonly active: readonly AttentionCandidate[]
  /** Candidates after active up to the background budget. */
  readonly background: readonly AttentionCandidate[]
  /** Remaining candidates omitted only because of the configured budgets. */
  readonly suppressed: readonly AttentionCandidate[]
}

/** Reconstructed process-local cognitive state for one exact session. */
export interface CognitiveState extends WorkingMemoryPartition {
  /** Exact session identity from the canonical session store. */
  readonly sessionId: SessionId
  /** Project provenance copied from the session-learning records, when present. */
  readonly projectId?: string
  /** Highest source event sequence represented by the projection. */
  readonly observedSeq: number
  /** Number of active records considered before partition budgets. */
  readonly candidateCount: number
}

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
