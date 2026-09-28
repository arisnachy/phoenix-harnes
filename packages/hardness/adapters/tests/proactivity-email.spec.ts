import { describe, expect, it, vi } from 'vitest'
import {
  ProactivityDeferredError,
  type ProactivityExecution,
  type ProactivityTask,
} from '../src/proactivity-engine.ts'
import { createProactivityExecutor } from '../src/proactivity-runtime.ts'

function task(overrides: Partial<ProactivityTask> = {}): ProactivityTask {
  return {
    id: 'mail-task',
    title: 'Scheduled self email',
    instruction: 'Send exactly: prueba realizada: “PRUEBA WAKE SCHEDULER OK”.',
    createdBy: 'user',
    createdAt: '2026-09-28T02:48:29.000Z',
    updatedAt: '2026-09-28T02:48:29.000Z',
    nextRunAt: '2026-09-28T02:53:29.000Z',
    recurrence: { kind: 'once' },
    catchUp: 'latest',
    visibility: 'visible',
    delivery: 'email',
    senderIdentity: 'harness',
    targetAgentId: 'agent-a',
    status: 'scheduled',
    history: [],
    ...overrides,
  }
}

function execution(overrides: Partial<ProactivityTask> = {}): ProactivityExecution {
  return {
    phase: 'deliver',
    task: task(overrides),
    scheduledFor: '2026-09-28T02:53:29.000Z',
    idempotencyKey: 'mail-task:deliver:2026-09-28T02:53:29.000Z',
    instruction: 'Send exactly: prueba realizada: “PRUEBA WAKE SCHEDULER OK”.',
  }
}

describe('scheduled email execution', () => {
  it('recovers a legacy task without recipient from the connected Google account and does not require harnessMailIdentity', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn(async (_provider: string, request: { prompt: Array<{ type: string; text: string }> }) => ({
      id: 'child',
      result: Promise.resolve({
        output: [{ type: 'text', text: 'email sent' }],
        stopReason: 'completed',
      }),
      dispose,
      request,
    }))
    const parent = { id: 'agent-a' }
    const executor = createProactivityExecutor(
      {
        get: vi.fn(() => parent),
        roots: vi.fn(() => [parent]),
        list: vi.fn(() => [parent]),
      } as never,
      {
        getProvider: vi.fn(() => ({ capabilities: {} })),
        start,
      } as never,
      {
        pollMs: 15_000,
        privateWorkProvider: 'spawn',
        privateWorkResultChars: 12_000,
        resolveDefaultMailRecipient: async () => 'owner@example.com',
      },
    )

    await expect(executor.execute(execution())).resolves.toEqual({ summary: 'email sent' })

    expect(start).toHaveBeenCalledTimes(1)
    const request = start.mock.calls[0]?.[1]
    const prompt = request?.prompt[0]?.text ?? ''
    expect(prompt).toContain('Recipient: owner@example.com')
    expect(prompt).toContain('no dedicated mail identity reference is configured')
    expect(prompt).toContain('currently authorized connected mail account')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps an undeliverable legacy email occurrence pending instead of pretending it was sent', async () => {
    const start = vi.fn()
    const parent = { id: 'agent-a' }
    const executor = createProactivityExecutor(
      {
        get: vi.fn(() => parent),
        roots: vi.fn(() => [parent]),
        list: vi.fn(() => [parent]),
      } as never,
      {
        getProvider: vi.fn(() => ({ capabilities: {} })),
        start,
      } as never,
      {
        pollMs: 15_000,
        privateWorkProvider: 'spawn',
        privateWorkResultChars: 12_000,
        resolveDefaultMailRecipient: async () => undefined,
      },
    )

    await expect(executor.execute(execution())).rejects.toBeInstanceOf(ProactivityDeferredError)
    expect(start).not.toHaveBeenCalled()
  })

  it('prefers an explicit persisted recipient without inspecting the connected account', async () => {
    const resolveDefaultMailRecipient = vi.fn(async () => 'other@example.com')
    const start = vi.fn(async () => ({
      id: 'child',
      result: Promise.resolve({
        output: [{ type: 'text', text: 'sent explicitly' }],
        stopReason: 'completed',
      }),
      dispose: async () => {},
    }))
    const parent = { id: 'agent-a' }
    const executor = createProactivityExecutor(
      {
        get: vi.fn(() => parent),
        roots: vi.fn(() => [parent]),
        list: vi.fn(() => [parent]),
      } as never,
      {
        getProvider: vi.fn(() => ({ capabilities: {} })),
        start,
      } as never,
      {
        pollMs: 15_000,
        privateWorkProvider: 'spawn',
        privateWorkResultChars: 12_000,
        resolveDefaultMailRecipient,
      },
    )

    await executor.execute(execution({ recipient: 'saved@example.com' }))

    expect(resolveDefaultMailRecipient).not.toHaveBeenCalled()
    const prompt = start.mock.calls[0]?.[1]?.prompt[0]?.text ?? ''
    expect(prompt).toContain('Recipient: saved@example.com')
    expect(prompt).not.toContain('Recipient: other@example.com')
  })
})
