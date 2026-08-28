/** Evidence storage and promotion guards for HARDNESS capabilities. */

import type { CapabilityEvidence, CapabilityId } from './types.ts'

/**
 * Store one secret-free immutable evidence record.
 * @param evidence - evidence record to validate and freeze.
 * @returns immutable copy safe for the in-memory evidence index.
 */
export function freezeEvidence(evidence: CapabilityEvidence): CapabilityEvidence {
  if (evidence.id.length === 0 || evidence.capabilityId.length === 0) throw new Error('invalid evidence: id and capabilityId are required')
  if (evidence.caseId.length === 0 || evidence.inputSummary.length === 0) throw new Error('invalid evidence: case and input summary are required')
  if (!Number.isFinite(evidence.durationMs) || evidence.durationMs < 0) throw new Error('invalid evidence: duration must be non-negative')
  return Object.freeze({ ...evidence, artifactRefs: Object.freeze([...evidence.artifactRefs]) })
}

/**
 * Read evidence for one capability from the in-memory index.
 * @param evidence - evidence index keyed by evidence id.
 * @param id - capability whose evidence should be returned.
 * @returns matching evidence records in insertion order.
 */
export function evidenceForCapability(
  evidence: ReadonlyMap<string, CapabilityEvidence>,
  id: CapabilityId,
): readonly CapabilityEvidence[] {
  return [...evidence.values()].filter(item => item.capabilityId === id)
}
