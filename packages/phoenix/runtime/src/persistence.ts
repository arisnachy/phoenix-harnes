import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CapabilityEvidence, ModelRef } from './model-ladder.ts'

export interface PhoenixLocalState {
  version: 1
  evidence: CapabilityEvidence[]
  quarantined: ModelRef[]
}

export function readLocalState(path: string): PhoenixLocalState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<PhoenixLocalState>
    if (parsed.version !== 1 || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.quarantined)) throw new Error('invalid state')
    return { version: 1, evidence: parsed.evidence, quarantined: parsed.quarantined }
  } catch {
    return { version: 1, evidence: [], quarantined: [] }
  }
}

export function writeLocalState(path: string, state: PhoenixLocalState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}
