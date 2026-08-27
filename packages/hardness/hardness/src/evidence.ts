/** Evidence storage and promotion guards for HARDNESS capabilities. */

import type { CapabilityEvidence, CapabilityId } from './types.ts'

/** Store one secret-free immutable evidence record. */
export function freezeEvidence(evidence: CapabilityEvidence): CapabilityEvidence {
  if (evidence.id.length === 0 || evidence.capabilityId.length === 0) throw new Error('invalid evidence: id and capabilityId are required')
  if (evidence.caseId.length === 0 || evidence.inputSummary.length === 0) throw new Error('invalid evidence: case and input summary are required')
  if (!Number.isFinite(evidence.durationMs) || evidence.durationMs < 0) throw new Error('invalid evidence: duration must be non-negative')
  return Object.freeze({ ...evidence, artifactRefs: Object.freeze([...evidence.artifactRefs]) })
}

/** Read evidence for one capability from the in-memory index. */
export function evidenceForCapability(
  evidence: ReadonlyMap<string, CapabilityEvidence>,
  id: CapabilityId,
): readonly CapabilityEvidence[] {
  return [...evidence.values()].filter(item => item.capabilityId === id)
}
