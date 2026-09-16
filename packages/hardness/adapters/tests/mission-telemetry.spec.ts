import { describe, expect, it } from 'vitest'
import type { HardnessMissionAuditEntry } from '../src/mission-audit.ts'
import { createHardnessMissionTelemetry, replayHardnessMissionTelemetry } from '../src/mission-telemetry.ts'

const callId = 'call:telemetry' as never

function entry(input: Omit<HardnessMissionAuditEntry, 'callId' | 'capabilityKind'>): HardnessMissionAuditEntry {
  return { callId, capabilityKind: 'test', ...input }
}

const controlledSample: readonly HardnessMissionAuditEntry[] = [
  entry({ step: 'inspect', outcome: 'completed' }),
  entry({ step: 'execute', outcome: 'blocked', reasonCode: 'execution-threw' }),
  entry({ step: 'audit', outcome: 'blocked', reasonCode: 'mission-blocked', durationMs: 25 }),
  entry({ step: 'execute', outcome: 'completed', durationMs: 12 }),
  entry({ step: 'present', outcome: 'completed' }),
  entry({ step: 'audit', outcome: 'completed', durationMs: 20 }),
]

describe('HARDNESS mission telemetry', () => {
  it('aggregates controlled success, blocking, recovery, and latency signals', () => {
    const telemetry = createHardnessMissionTelemetry()
    for (const audit of controlledSample) telemetry.record(audit)

    expect(telemetry.snapshot()).toMatchObject({
      attempts: 2,
      completedMissions: 1,
      blockedMissions: 1,
      recoveryAttempts: 1,
      durations: { count: 4, totalMs: 57, maxMs: 25 },
      blockedReasonCodes: { 'execution-threw': 1, 'mission-blocked': 1 },
      steps: {
        execute: { completed: 1, blocked: 1 },
        audit: { completed: 1, blocked: 1 },
      },
    })
  })

  it('replays the durable sample and resets without retaining prior metrics', () => {
    const replayed = replayHardnessMissionTelemetry(controlledSample)
    const telemetry = createHardnessMissionTelemetry()
    for (const audit of controlledSample) telemetry.record(audit)
    expect(replayed).toEqual(telemetry.snapshot())

    telemetry.reset()
    expect(telemetry.snapshot()).toMatchObject({
      attempts: 0,
      completedMissions: 0,
      blockedMissions: 0,
      recoveryAttempts: 0,
      durations: { count: 0, totalMs: 0, maxMs: 0 },
      blockedReasonCodes: {},
    })
  })
})
