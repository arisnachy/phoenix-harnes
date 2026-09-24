import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import HardnessRegistry from '@phoenix-ai/dsh-hardness/src/index.ts'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { CapabilityId, HardnessService } from '@phoenix-ai/dsh-hardness'
import type { ToolRuntime } from '@phoenix-ai/dsh-tools'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'
import { createHardnessMissionRunner } from '../src/mission-runtime.ts'
import { replayHardnessMissionAudit } from '../src/mission-audit.ts'
import { replayHardnessMissionTelemetry } from '../src/mission-telemetry.ts'

const EXPECTED = 'PHOENIX_HARDNESS_OK\n'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('HARDNESS live proof', () => {
  it('executes, verifies, judges, audits, and promotes one real filesystem mission', async () => {
    const startedAt = Date.now()
    const proofDir = resolve(process.cwd(), 'artifacts', 'hardness-live-proof')
    const proofFile = resolve(proofDir, 'hardness-live-proof.txt')
    const reportFile = resolve(proofDir, 'hardness-live-proof-report.json')
    const markdownFile = resolve(proofDir, 'hardness-live-proof-report.md')
    await mkdir(proofDir, { recursive: true })

    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const capabilityId = 'tool:hardness_live_proof' as CapabilityId

    hardness.register({
      id: capabilityId,
      kind: 'hardness-live-proof',
      name: 'HARDNESS live proof writer',
      description: 'Create and independently read back a deterministic proof artifact on the live runner.',
      inputs: ['content'],
      outputs: ['proof'],
      dependencies: [],
      requiredPermissions: [],
      provider: 'phoenix-live-proof',
      location: 'github-actions-runner',
      version: '1.0.0',
      compatibility: ['node'],
      limitations: ['ephemeral runner filesystem'],
      modalities: ['native'],
      status: 'testing',
    })

    const events: Array<{ type: string; data: unknown }> = []
    const session = {
      events,
      append(type: string, data: unknown) {
        events.push({ type, data })
      },
    }
    const agent = { session } as unknown as Agent

    let toolCalls = 0
    const tools: Pick<ToolRuntime, 'execute'> = {
      async execute(input) {
        toolCalls += 1
        if (input.name !== 'hardness_live_proof') {
          throw new Error(`unexpected live proof tool: ${input.name}`)
        }

        await writeFile(proofFile, EXPECTED, 'utf8')
        const observed = await readFile(proofFile, 'utf8')
        const expectedSha256 = sha256(EXPECTED)
        const observedSha256 = sha256(observed)
        if (observed !== EXPECTED || observedSha256 !== expectedSha256) {
          throw new Error('live proof read-back verification failed')
        }

        return {
          isError: false as const,
          value: null,
          content: [{ type: 'text' as const, text: 'HARDNESS live proof verified on disk.' }],
          meta: {
            artifact: {
              id: 'hardness-live-proof-artifact',
              mime: 'application/json',
              data: {
                file: relative(process.cwd(), proofFile),
                expected: EXPECTED.trim(),
                observed: observed.trim(),
                sha256: observedSha256,
                verified: true,
              },
            },
          },
        }
      },
    }

    const runner = createHardnessMissionRunner({
      hardness,
      tools,
      acquisition: new AcquisitionRegistry(hardness),
      approval: { request: async () => 'allowed-once' as const } as never,
    })

    const callId = 'call-hardness-live-proof' as never
    const result = await runner.run({
      need: { kind: 'hardness-live-proof' },
      args: { content: EXPECTED.trim() },
      context: { callId, signal: new AbortController().signal, agent },
    })

    const observed = await readFile(proofFile, 'utf8')
    const audit = replayHardnessMissionAudit(events as never, callId)
    const telemetry = runner.telemetry?.snapshot()
    const replayedTelemetry = replayHardnessMissionTelemetry(audit)
    const evidence = hardness.evidenceFor(capabilityId)
    const capability = hardness.get(capabilityId)
    const kernelEvents = events.filter(event => event.type === 'hardness/kernel').map(event => event.data)
    const elapsedMs = Date.now() - startedAt

    expect(result).toMatchObject({
      kind: 'completed',
      artifact: { id: 'hardness-live-proof-artifact', mime: 'application/json' },
    })
    expect(toolCalls).toBe(1)
    expect(observed).toBe(EXPECTED)
    expect(audit.map(entry => [entry.step, entry.outcome])).toEqual([
      ['inspect', 'completed'],
      ['resolve', 'completed'],
      ['plan', 'completed'],
      ['approve', 'completed'],
      ['execute', 'completed'],
      ['verify', 'completed'],
      ['present', 'completed'],
      ['audit', 'completed'],
    ])
    expect(telemetry).toMatchObject({
      attempts: 1,
      completedMissions: 1,
      blockedMissions: 0,
      recoveryAttempts: 0,
      steps: {
        inspect: { completed: 1, blocked: 0 },
        resolve: { completed: 1, blocked: 0 },
        plan: { completed: 1, blocked: 0 },
        approve: { completed: 1, blocked: 0 },
        execute: { completed: 1, blocked: 0 },
        verify: { completed: 1, blocked: 0 },
        present: { completed: 1, blocked: 0 },
        audit: { completed: 1, blocked: 0 },
      },
    })
    expect(replayedTelemetry).toEqual(telemetry)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({
      capabilityId,
      outcome: 'passed',
      artifactRefs: ['hardness-live-proof-artifact'],
    })
    expect(capability?.status).toBe('verified')

    const report = {
      generatedAt: new Date().toISOString(),
      elapsedMs,
      task: 'Create PHOENIX_HARDNESS_OK, read it back, hash it, and complete a governed HARDNESS mission.',
      missionResult: result,
      filesystemProof: {
        path: relative(process.cwd(), proofFile),
        expected: EXPECTED.trim(),
        observed: observed.trim(),
        expectedSha256: sha256(EXPECTED),
        observedSha256: sha256(observed),
        verified: observed === EXPECTED && sha256(observed) === sha256(EXPECTED),
      },
      capability: {
        id: capabilityId,
        statusAfterMission: capability?.status,
      },
      toolCalls,
      audit,
      telemetry,
      replayedTelemetry,
      evidence,
      kernelEvents,
    }

    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8')
    await writeFile(markdownFile, [
      '# HARDNESS live proof',
      '',
      `- Mission: **${result.kind}**`,
      `- File read-back: **${report.filesystemProof.verified ? 'PASS' : 'FAIL'}**`,
      `- SHA-256: \`${report.filesystemProof.observedSha256}\``,
      `- HARDNESS capability after mission: **${capability?.status ?? 'missing'}**`,
      `- Tool executions: **${toolCalls}**`,
      `- Audit steps: **${audit.length}**`,
      `- Completed missions in telemetry: **${telemetry?.completedMissions ?? 0}**`,
      `- Blocked missions in telemetry: **${telemetry?.blockedMissions ?? 0}**`,
      `- Recovery attempts: **${telemetry?.recoveryAttempts ?? 0}**`,
      `- Evidence records: **${evidence.length}**`,
      `- Kernel events: **${kernelEvents.length}**`,
      `- End-to-end test elapsed: **${elapsedMs} ms**`,
      '',
      '## Protocol trace',
      '',
      ...audit.map(entry => `- ${entry.step}: ${entry.outcome}${entry.evidenceId ? ` — evidence ${entry.evidenceId}` : ''}`),
      '',
    ].join('\n'), 'utf8')

    await ctx.fiber.dispose()
  })
})
