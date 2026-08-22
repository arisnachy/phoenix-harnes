import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { capabilityDimensions, type CapabilityEvidence, type EvidenceSource, type ModelRef } from './model-ladder.ts'

/** Durable PHOENIX authority evidence and quarantine state stored on the local machine. */
export interface PhoenixLocalState {
  version: 1
  evidence: CapabilityEvidence[]
  quarantined: ModelRef[]
}

const EVIDENCE_SOURCES = new Set<EvidenceSource>(['benchmark', 'mission', 'collective-observation', 'operator'])
const DIMENSIONS = new Set<string>(capabilityDimensions)

function isModelRef(value: unknown): value is ModelRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.provider === 'string' && record.provider.length > 0
    && typeof record.model === 'string' && record.model.length > 0
}

function isCapabilityEvidence(value: unknown): value is CapabilityEvidence {
  if (!isModelRef(value)) return false
  const record = value as unknown as Record<string, unknown>
  if (typeof record.dimension !== 'string' || !DIMENSIONS.has(record.dimension)) return false
  if (typeof record.score !== 'number' || !Number.isFinite(record.score) || record.score < 0 || record.score > 100) return false
  if (typeof record.source !== 'string' || !EVIDENCE_SOURCES.has(record.source as EvidenceSource)) return false
  if (record.weight !== undefined && (typeof record.weight !== 'number' || !Number.isFinite(record.weight))) return false
  if (record.observedAt !== undefined && (typeof record.observedAt !== 'number' || !Number.isFinite(record.observedAt))) return false
  if (record.reproducible !== undefined && typeof record.reproducible !== 'boolean') return false
  return true
}

/**
 * Read local evolution state fail-safe. Any malformed document or malformed entry
 * returns an empty state so corrupt local persistence cannot crash PHOENIX startup.
 * @param path - absolute or process-relative JSON state path.
 * @returns Validated version-1 local state, or an empty state on any read/shape failure.
 */
export function readLocalState(path: string): PhoenixLocalState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PhoenixLocalState>
    if (parsed.version !== 1 || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.quarantined)) throw new Error('invalid state')
    if (!parsed.evidence.every(isCapabilityEvidence) || !parsed.quarantined.every(isModelRef)) throw new Error('invalid entries')
    return {
      version: 1,
      evidence: parsed.evidence.map(value => ({ ...value })),
      quarantined: parsed.quarantined.map(value => ({ ...value })),
    }
  } catch {
    return { version: 1, evidence: [], quarantined: [] }
  }
}

/**
 * Atomically replace local evolution state with owner-only file permissions.
 * @param path - destination JSON file.
 * @param state - already validated PHOENIX local state to persist.
 */
export function writeLocalState(path: string, state: PhoenixLocalState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}
