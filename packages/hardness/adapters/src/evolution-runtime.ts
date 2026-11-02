/** Canonical Host-owned continuity and reversible exploration adapters. */

import type { CallId } from '@phoenix-ai/dsh-llm'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import {
  verifyEvolutionProbe,
  type EvolutionCheckpoint,
  type EvolutionProbe,
} from '@phoenix-ai/dsh-hardness'
import { replayMissionKernelSession } from './mission-kernel.ts'

/** Durable checkpoint obtained from a canonical mission ledger, not model-authored text.
 * @param events - Host-owned session rows, including the mission kernel.
 * @param missionId - Exact mission identifier.
 * @param revision - Mission revision being resumed.
 * @param modelRoute - New provider/model route, selected through the Host.
 * @returns Resumable checkpoint with independently judged completion status.
 */
export function recoverEvolutionCheckpoint(
  events: readonly SessionEvent[],
  missionId: string,
  revision: number,
  modelRoute: string,
): EvolutionCheckpoint {
  const started = events.some(event => event.type === 'hardness/kernel'
    && event.data.kind === 'started'
    && event.data.missionId === missionId
    && event.data.revision === revision)
  const state = replayMissionKernelSession(events, missionId as CallId, revision)
  const verified = started
    && state.status === 'DONE'
    && state.terminalReason === 'verified'
    && state.judge?.verdict === 'pass'
    && state.quality?.verdict === 'pass'
    && (state.judge.evidence.length > 0)
  return Object.freeze({
    missionId,
    revision,
    modelRoute,
    objective: started ? state.goal.objective : '',
    status: state.status,
    verified,
    evidence: Object.freeze(verified ? [...state.judge.evidence] : []),
  })
}

/** Bounded Host sandbox/readback contract. Only this trusted adapter runs probes. */
export interface EvolutionProbeHost {
  /** @returns Actual state reference before a sandbox experiment. */
  readBack(): Promise<string>
  /** @returns Completion after a genuinely isolated reversible action. */
  runSandbox(): Promise<void>
  /** @param rollbackId - Trusted sandbox checkpoint reference.
   * @returns Completion after restoring sandbox state.
   */
  rollback(rollbackId: string): Promise<void>
}

/** Observation of a reversible experiment; never a model quality verdict. */
export interface EvolutionProbeResult {
  readonly status: 'observed' | 'unchanged' | 'read-only'
  readonly before: string
  readonly after: string
  readonly rollbackConfirmed: boolean
}

/**
 * Run only Host-owned isolated probes, enforce actual readback, always restore.
 * External writes cannot be requested through this capability.
 * @param probe - Host-reviewed experiment proposal and attempt budget.
 * @param host - Trusted readback/sandbox/rollback implementation.
 * @returns Evidence of a real observation, never a success claim.
 */
export async function runEvolutionProbe(
  probe: EvolutionProbe,
  host: EvolutionProbeHost,
): Promise<EvolutionProbeResult> {
  const decision = verifyEvolutionProbe(probe)
  if (!decision.allowed) throw new Error('blocked evolution probe: ' + decision.reasons.join('; '))
  const before = await host.readBack()
  if (!before.trim()) throw new Error('probe has no verified starting observation')
  if (probe.action === 'read') {
    return Object.freeze({ status: 'read-only', before, after: before, rollbackConfirmed: true })
  }
  const rollbackId = probe.rollbackId
  if (rollbackId === undefined) throw new Error('sandbox rollback reference is missing')
  let after = ''
  let observedError: unknown
  try {
    await host.runSandbox()
    after = await host.readBack()
    if (!after.trim()) throw new Error('probe produced no readable observation')
  } catch (error) {
    observedError = error
  }
  try {
    await host.rollback(rollbackId)
  } catch (error) {
    throw new Error('evolution sandbox rollback was not confirmed', { cause: error })
  }
  const recovered = await host.readBack()
  if (!recovered.trim() || recovered !== before) throw new Error('evolution sandbox rollback state mismatch')
  if (observedError !== undefined) {
    throw observedError instanceof Error ? observedError : new Error('evolution sandbox action failed', { cause: observedError })
  }
  return Object.freeze({
    status: before === after ? 'unchanged' : 'observed',
    before,
    after,
    rollbackConfirmed: true,
  })
}
