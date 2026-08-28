/** Runtime validation for the durable HARDNESS atlas format. */

import type { HardnessAtlasSnapshot } from '@deepseek-ai/dsh-hardness'

/**
 * Parse and validate one durable HARDNESS atlas snapshot.
 * @param value - untrusted decoded JSON value.
 * @returns validated version-one atlas snapshot.
 */
export function parseAtlasSnapshot(value: unknown): HardnessAtlasSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('invalid HARDNESS atlas: expected object')
  const record = value as Record<string, unknown>
  if (record.formatVersion !== 1) throw new Error('invalid HARDNESS atlas: unsupported formatVersion')
  if (!Array.isArray(record.capabilities) || !Array.isArray(record.evidence)) {
    throw new Error('invalid HARDNESS atlas: capabilities and evidence must be arrays')
  }
  return {
    formatVersion: 1,
    capabilities: record.capabilities as HardnessAtlasSnapshot['capabilities'],
    evidence: record.evidence as HardnessAtlasSnapshot['evidence'],
  }
}
