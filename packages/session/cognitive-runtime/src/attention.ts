/** Deterministic attention scoring over detached session-learning records. */

import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { cloneCognitiveRecord } from './types.ts'
import type { AttentionCandidate, AttentionSignals, AttentionWeights } from './types.ts'

const WEIGHT_KEYS = ['importance', 'confidence', 'recency', 'urgency', 'goalRelevance', 'novelty'] as const

/**
 * Score active records using persisted metadata and stable tie-breaks.
 * @param records - Cognitive records to filter, detach, and rank.
 * @param weights - Non-negative finite contribution for each signal.
 * @returns Detached candidates sorted from highest attention to lowest.
 */
export function scoreAttention(
  records: readonly CognitiveMemoryRecord[],
  weights: AttentionWeights,
): AttentionCandidate[] {
  validateWeights(weights)
  const active = records.filter(record => record.status === 'active')
  if (active.length === 0) return []

  const bounds = observedBounds(active)
  const totalWeight = WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0)
  const candidates = active.map((record) => {
    const signals = signalsFor(record, bounds)
    const weighted = WEIGHT_KEYS.reduce((sum, key) => sum + signals[key] * weights[key], 0)
    const score = totalWeight === 0 ? 0 : clamp(weighted / totalWeight)
    return {
      record: cloneCognitiveRecord(record),
      signals,
      score,
      reasons: WEIGHT_KEYS.filter(key => weights[key] > 0 && signals[key] > 0),
    }
  })

  return candidates.sort(compareCandidates)
}

interface ObservedBounds {
  readonly oldest: number
  readonly newest: number
}

function observedBounds(records: readonly CognitiveMemoryRecord[]): ObservedBounds {
  let oldest = Number.POSITIVE_INFINITY
  let newest = Number.NEGATIVE_INFINITY
  for (const record of records) {
    const observedAt = record.lastObservedAt
    if (observedAt < oldest) oldest = observedAt
    if (observedAt > newest) newest = observedAt
  }
  return { oldest, newest }
}

function signalsFor(record: CognitiveMemoryRecord, bounds: ObservedBounds): AttentionSignals {
  const recency = bounds.oldest === bounds.newest
    ? 1
    : clamp((record.lastObservedAt - bounds.oldest) / (bounds.newest - bounds.oldest))
  const urgency = record.kind === 'error' || record.kind === 'pending' ? 1 : 0
  const goalRelevance = record.kind === 'mission' || record.kind === 'pending' || record.layers.includes('prospective') ? 1 : 0
  const frequency = Number.isFinite(record.frequency) && record.frequency > 0 ? record.frequency : 1
  return {
    importance: clamp(record.importance),
    confidence: clamp(record.confidence),
    recency,
    urgency,
    goalRelevance,
    novelty: clamp(1 / frequency),
  }
}

function compareCandidates(left: AttentionCandidate, right: AttentionCandidate): number {
  return right.score - left.score
    || right.record.eventSeq - left.record.eventSeq
    || compareText(left.record.provenance.sourceUri, right.record.provenance.sourceUri)
    || compareText(String(left.record.id), String(right.record.id))
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validateWeights(weights: AttentionWeights): void {
  for (const key of WEIGHT_KEYS) {
    const value = weights[key]
    if (!Number.isFinite(value)) throw new TypeError(`attention weight ${key} must be finite`)
    if (value < 0) throw new TypeError(`attention weight ${key} must be non-negative`)
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
