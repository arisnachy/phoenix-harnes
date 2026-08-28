import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createHardnessTool, type HardnessMissionRunner } from '../src/hardness-tool.ts'
import type { HardnessMissionResult } from '../src/mission-orchestrator.ts'

const callId = CallId('hardness-call-1')
const signal = new AbortController().signal
const agent = { id: 'agent-1' } as unknown as Agent

function execution(): ToolRunContext {
  return {
    callId,
    rootCallId: callId,
    token: Symbol('tool-token') as never,
    signal,
    agent,
    deferContext: vi.fn(),
    concludeTurn: vi.fn(),
  }
}

function runnerReturning(result: HardnessMissionResult): { runner: HardnessMissionRunner; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => result)
  return { runner: { run }, run }
}

describe('hardness_run tool adapter', () => {
  it('declares the exact model-facing name and need schema', () => {
    const { runner } = runnerReturning({ kind: 'blocked', reason: 'not used' })
    const tool = createHardnessTool(runner)

    expect(tool.name).toBe('hardness_run')
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        need: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            inputs: { type: 'array', items: { type: 'string' } },
            outputs: { type: 'array', items: { type: 'string' } },
            requiredStatus: {
              type: 'string',
              enum: ['experimental', 'testing', 'verified', 'broken', 'quarantined', 'deprecated'],
            },
            permissions: { type: 'array', items: { type: 'string' } },
          },
          required: ['kind'],
          additionalProperties: false,
        },
        arguments: {},
      },
      required: ['need', 'arguments'],
    })
    expect(tool.output.schema).toEqual({
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', const: 'blocked' },
            reason: { type: 'string' },
          },
          required: ['kind', 'reason'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', const: 'completed' },
            artifact_id: { type: 'string' },
            artifact_mime: { type: 'string' },
            rendered: {},
          },
          required: ['kind', 'artifact_id', 'artifact_mime', 'rendered'],
        },
      ],
    })
  })

  it('delegates once and projects a completed mission without private values', async () => {
    const result: HardnessMissionResult = {
      kind: 'completed',
      artifact: {
        id: 'artifact-1',
        mime: 'text/plain',
        data: { credential: 'must-not-leak', callback: () => 'must-not-leak' },
      },
      rendered: { kind: 'hardness-artifact', artifactId: 'artifact-1', text: 'done' },
    }
    const { runner, run } = runnerReturning(result)
    const tool = createHardnessTool(runner)
    const args = {
      need: { kind: 'web-search', inputs: ['query'], outputs: ['artifact'], requiredStatus: 'verified', permissions: ['network'] },
      arguments: { query: 'phoenix', credential: 'must-not-leak' },
    }

    await expect(tool.execute(args, execution())).resolves.toEqual({
      kind: 'completed',
      artifact_id: 'artifact-1',
      artifact_mime: 'text/plain',
      rendered: { kind: 'hardness-artifact', artifactId: 'artifact-1', text: 'done' },
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith({
      need: args.need,
      args: args.arguments,
      context: { callId, signal, agent },
    })
    const projected = await tool.execute(args, execution())
    expect(projected).not.toHaveProperty('artifact')
    expect(JSON.stringify(projected)).not.toContain('must-not-leak')
  })

  it('projects a blocked mission with its reason only', async () => {
    const { runner, run } = runnerReturning({ kind: 'blocked', reason: 'approval required' })
    const tool = createHardnessTool(runner)

    await expect(tool.execute({ need: { kind: 'web-search' }, arguments: { query: 'phoenix' } }, execution()))
      .resolves.toEqual({ kind: 'blocked', reason: 'approval required' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('blocks callbacks and sensitive keys in the rendered model-facing projection', async () => {
    const result: HardnessMissionResult = {
      kind: 'completed',
      artifact: { id: 'artifact-1', mime: 'text/plain', data: 'safe' },
      rendered: {
        kind: 'hardness-artifact',
        artifactId: 'artifact-1',
        private: { credential: 'must-not-leak' },
        callback: () => 'must-not-leak',
      },
    }
    const { runner } = runnerReturning(result)
    const tool = createHardnessTool(runner)

    await expect(tool.execute({ need: { kind: 'web-search' }, arguments: {} }, execution()))
      .resolves.toEqual({ kind: 'blocked', reason: 'mission produced an unsafe model-facing rendering' })
  })

  it('passes the call id, signal, and optional agent through unchanged', async () => {
    const { runner, run } = runnerReturning({ kind: 'blocked', reason: 'not used' })
    const tool = createHardnessTool(runner)
    const exec = execution()

    await tool.execute({ need: { kind: 'native' }, arguments: null }, exec)

    expect(run.mock.calls[0]?.[0].context).toEqual({ callId, signal, agent })
    expect(run.mock.calls[0]?.[0].context.signal).toBe(signal)
    expect(run.mock.calls[0]?.[0].context.agent).toBe(agent)
  })

  it('renders a concise generic pending view using the need kind', () => {
    const { runner } = runnerReturning({ kind: 'blocked', reason: 'not used' })
    const tool = createHardnessTool(runner)

    expect(tool.presentCall?.({ need: { kind: 'web-search' }, arguments: { query: 'phoenix' } })).toEqual({
      card: 'generic',
      title: 'HARDNESS web-search',
      kind: 'execute',
      rawInput: 'web-search',
    })
  })

  it('does not call the runner for malformed kind or need values', async () => {
    const { runner, run } = runnerReturning({ kind: 'blocked', reason: 'must not run' })
    const tool = createHardnessTool(runner)

    await expect(tool.execute({ need: { kind: '' }, arguments: {} }, execution())).rejects.toThrow(/kind.*non-empty/)
    await expect(tool.execute({ need: { kind: 'web-search', inputs: [7] }, arguments: {} }, execution())).rejects.toThrow(/invalid arguments/)
    await expect(tool.execute({ need: { kind: 'web-search', requiredStatus: 'ready' }, arguments: {} }, execution())).rejects.toThrow(/invalid arguments/)
    expect(run).not.toHaveBeenCalled()
  })
})
