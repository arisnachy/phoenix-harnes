/** Secret-free HARDNESS mission telemetry derived from durable audit rows. */

import type { HardnessProtocolStep } from '@phoenix-ai/dsh-hardness'
import type { HardnessMissionAuditEntry } from './mission-audit.ts'

/** Aggregated counts for one protocol step. */
export interface HardnessMissionStepTelemetry {
  readonly completed: number
  readonly blocked: number
}

/** Read-only mission metrics maintained from audit entries. */
export interface HardnessMissionTelemetrySnapshot {
  readonly attempts: number
  readonly completedMissions: number
  readonly blockedMissions: number
  readonly recoveryAttempts: number
  readonly durations: {
    readonly count: number
    readonly totalMs: number
    readonly maxMs: number
  }
  readonly steps: Readonly<Partial<Record<HardnessProtocolStep, HardnessMissionStepTelemetry>>>
  readonly blockedReasonCodes: Readonly<Record<string, number>>
}

/** Best-effort observer used by the mission runner; it must not block execution. */
export interface HardnessMissionTelemetry {
  record(entry: HardnessMissionAuditEntry): void
  snapshot(): HardnessMissionTelemetrySnapshot
  reset(): void
}

const PROTOCOL_STEPS: readonly HardnessProtocolStep[] = ['inspect', 'resolve', 'plan', 'approve', 'execute', 'verify', 'present', 'audit']

function emptySteps(): Record<HardnessProtocolStep, HardnessMissionStepTelemetry> {
  return Object.fromEntries(PROTOCOL_STEPS.map(step => [step, { completed: 0, blocked: 0 }])) as Record<HardnessProtocolStep, HardnessMissionStepTelemetry>
}

function copySteps(steps: Readonly<Record<HardnessProtocolStep, HardnessMissionStepTelemetry>>): Readonly<Partial<Record<HardnessProtocolStep, HardnessMissionStepTelemetry>>> {
  return Object.freeze(Object.fromEntries(PROTOCOL_STEPS.map(step => [step, Object.freeze({ ...steps[step] })]))) as Readonly<Partial<Record<HardnessProtocolStep, HardnessMissionStepTelemetry>>>
}

/**
 * Create an in-memory telemetry observer for one governed runner.
 * @returns An observer with aggregate counters and reset support.
 */
export function createHardnessMissionTelemetry(): HardnessMissionTelemetry {
  let attempts = 0
  let completedMissions = 0
  let blockedMissions = 0
  let recoveryAttempts = 0
  let durationCount = 0
  let totalDurationMs = 0
  let maxDurationMs = 0
  let steps = emptySteps()
  let blockedReasonCodes: Record<string, number> = {}

  return {
    record(entry) {
      const step = steps[entry.step]
      steps[entry.step] = {
        completed: step.completed + (entry.outcome === 'completed' ? 1 : 0),
        blocked: step.blocked + (entry.outcome === 'blocked' ? 1 : 0),
      }
      if (entry.step === 'audit') {
        attempts += 1
        if (entry.outcome === 'blocked') blockedMissions += 1
      }
      if (entry.step === 'present' && entry.outcome === 'completed') completedMissions += 1
      if (entry.step === 'execute' && entry.outcome === 'blocked') recoveryAttempts += 1
      if (entry.durationMs !== undefined) {
        const durationMs = Math.max(0, entry.durationMs)
        durationCount += 1
        totalDurationMs += durationMs
        maxDurationMs = Math.max(maxDurationMs, durationMs)
      }
      if (entry.outcome === 'blocked' && entry.reasonCode !== undefined) {
        blockedReasonCodes[entry.reasonCode] = (blockedReasonCodes[entry.reasonCode] ?? 0) + 1
      }
    },
    snapshot() {
      return Object.freeze({
        attempts,
        completedMissions,
        blockedMissions,
        recoveryAttempts,
        durations: Object.freeze({ count: durationCount, totalMs: totalDurationMs, maxMs: maxDurationMs }),
        steps: copySteps(steps),
        blockedReasonCodes: Object.freeze({ ...blockedReasonCodes }),
      })
    },
    reset() {
      attempts = 0
      completedMissions = 0
      blockedMissions = 0
      recoveryAttempts = 0
      durationCount = 0
      totalDurationMs = 0
      maxDurationMs = 0
      steps = emptySteps()
      blockedReasonCodes = {}
    },
  }
}

/**
 * Replay audit rows into a fresh snapshot without retaining their source objects.
 * @param entries Durable audit rows to aggregate.
 * @returns The reconstructed telemetry snapshot.
 */
export function replayHardnessMissionTelemetry(entries: readonly HardnessMissionAuditEntry[]): HardnessMissionTelemetrySnapshot {
  const telemetry = createHardnessMissionTelemetry()
  for (const entry of entries) telemetry.record(entry)
  return telemetry.snapshot()
}
