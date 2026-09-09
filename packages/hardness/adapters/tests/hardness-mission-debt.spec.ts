import type { Agent } from '@phoenix-ai/dsh-agent'
import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createHardnessTool, type HardnessMissionRunner } from '../src/hardness-tool.ts'
import type { HardnessMissionResult } from '../src/mission-orchestrator.ts'

const callId = CallId('hardness-mission-debt')
const signal = new AbortController().signal
const agent = { id: 'agent-1' } as unknown as Agent

function execution(): ToolRunContext {
  return {
    callId,
    rootCallId: callId,
    name: 'hardness_run',
    arguments: {},
    token: Symbol('tool-token') as never,
    signal,
    agent,
    deferContext: vi.fn<ToolRunContext['deferContext']>(),
    concludeTurn: vi.fn<ToolRunContext['concludeTurn']>(),
  }
}

function runnerReturning(result: HardnessMissionResult): HardnessMissionRunner {
  return { run: vi.fn(async () => result) }
}

describe('HARDNESS technical mission debt', () => {
  it.each([
    'no acquisition/build provider handles mailbox-verification',
    'HARDNESS route has no executable surface',
    'no executor owns the routed capability',
    'capability is unavailable in the current registry',
  ])('reclassifies a technical gap as RECOVERING instead of WAITING_EXTERNAL: %s', async (reason) => {
    const tool = createHardnessTool(runnerReturning({
      kind: 'blocked',
      reason,
      status: 'WAITING_EXTERNAL',
      nextAction: 'wait_for_dependency',
    }))
    const exec = execution()

    await expect(tool.execute({ need: { kind: 'mailbox-verification' }, arguments: {} }, exec)).resolves.toEqual({
      kind: 'blocked',
      reason,
      mission_status: 'RECOVERING',
      next_action: 'repair_and_replan',
    })
    expect(exec.deferContext).toHaveBeenCalledWith(expect.objectContaining({
      content: [expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('acquire or build the smallest governed helper') as unknown,
      }) as unknown],
    }) as unknown)
  })

  it('preserves a true human approval dependency as WAITING_EXTERNAL', async () => {
    const reason = 'approval was denied; direct human authorization is required'
    const tool = createHardnessTool(runnerReturning({
      kind: 'blocked',
      reason,
      status: 'WAITING_EXTERNAL',
      nextAction: 'wait_for_dependency',
    }))

    await expect(tool.execute({ need: { kind: 'mailbox-verification' }, arguments: {} }, execution())).resolves.toEqual({
      kind: 'blocked',
      reason,
      mission_status: 'WAITING_EXTERNAL',
      next_action: 'wait_for_dependency',
    })
  })
})
