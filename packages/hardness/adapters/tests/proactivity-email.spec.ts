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
  it('resumes the persisted target session when scheduled work fires with no live agent', async () => {
    const dispose = vi.fn(async () => {})
    const whenIdle = vi.fn(async () => {})
    const parent = { id: 'agent-a', whenIdle }
    const composeResumedAgent = vi.fn(async () => {})
    const resume = vi.fn(async (options: {
      resumeSessionId: unknown
      setup?: (ctx: unknown) => Promise<void> | void
    }) => {
      await options.setup?.({})
      return { agent: parent, dispose }
    })
    const start = vi.fn(async () => ({
      id: 'child',
      result: Promise.resolve({
        output: [{ type: 'text', text: 'email sent after autonomous resume' }],
        stopReason: 'completed',
      }),
      dispose: async () => {},
    }))
    const unrelated = { id: 'other-agent' }
    const executor = createProactivityExecutor(
      {
        get: vi.fn(() => undefined),
        roots: vi.fn(() => [unrelated]),
        list: vi.fn(() => [unrelated]),
        resume,
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
        composeResumedAgent,
      },
    )

    await expect(executor.execute(execution())).resolves.toEqual({
      summary: 'email sent after autonomous resume',
    })

    expect(resume).toHaveBeenCalledTimes(1)
    expect(resume.mock.calls[0]?.[0]?.resumeSessionId).toBe('agent-a')
    expect(composeResumedAgent).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(whenIdle).toHaveBeenCalledTimes(1)
  })

  it('resumes, wakes, drains, and releases a persisted chat session without user input', async () => {
    const followup = vi.fn()
    const whenIdle = vi.fn(async () => {})
    const dispose = vi.fn(async () => {})
    const parent = { id: 'agent-a', followup, whenIdle }
    const resume = vi.fn(async () => ({ agent: parent, dispose }))
    const executor = createProactivityExecutor(
      {
        get: vi.fn(() => undefined),
        roots: vi.fn(() => []),
        list: vi.fn(() => []),
        resume,
      } as never,
      undefined,
      {
        pollMs: 15_000,
        privateWorkProvider: 'spawn',
        privateWorkResultChars: 12_000,
      },
    )

    await expect(executor.execute(execution({
      delivery: 'chat',
      senderIdentity: 'auto',
    }))).resolves.toEqual({
      summary: 'resumed persisted Phoenix agent and completed scheduled chat turn',
    })

    expect(resume).toHaveBeenCalledTimes(1)
    expect(followup).toHaveBeenCalledTimes(1)
    expect(whenIdle).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

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

  it('uses the verified Kira mailbox for host-owned email delivery exactly once per occurrence key', async () => {
    const sendMail = vi.fn(async () => {})
    const start = vi.fn(async (_provider: string, request: { prompt: Array<{ type: string; text: string }> }) => ({
      id: 'child',
      result: Promise.resolve({
        output: [{ type: 'text', text: 'Informe terminado y adjunto disponible en Drive.' }],
        stopReason: 'completed',
      }),
      dispose: async () => {},
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
        sendMail,
      },
    )

    await expect(executor.execute(execution())).resolves.toEqual({
      summary: 'email sent to owner@example.com: Informe terminado y adjunto disponible en Drive.',
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledWith({
      taskId: 'mail-task',
      scheduledFor: '2026-09-28T02:53:29.000Z',
      to: 'owner@example.com',
      subject: 'Scheduled self email',
      text: 'Informe terminado y adjunto disponible en Drive.',
      idempotencyKey: 'mail-task:deliver:2026-09-28T02:53:29.000Z',
    })
    const prompt = start.mock.calls[0]?.[1]?.prompt[0]?.text ?? ''
    expect(prompt).toContain('Phoenix owns a verified Kira mailbox')
    expect(prompt).toContain('Do not call a mail connector yourself')
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
    const start = vi.fn(async (
      _provider: string,
      request: { prompt: Array<{ type: string; text: string }> },
    ) => ({
      id: 'child',
      result: Promise.resolve({
        output: [{ type: 'text', text: 'sent explicitly' }],
        stopReason: 'completed',
      }),
      dispose: async () => {},
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
        resolveDefaultMailRecipient,
      },
    )

    await executor.execute(execution({ recipient: 'saved@example.com' }))

    expect(resolveDefaultMailRecipient).not.toHaveBeenCalled()
    const prompt = start.mock.calls[0]?.[1]?.prompt[0]?.text ?? ''
    expect(prompt).toContain('Recipient: saved@example.com')
    expect(prompt).not.toContain('Recipient: other@example.com')
  })
  it('sends a verified conditional email before marking its watch terminal', async () => {
    const sendMail = vi.fn(async () => {})
    const followup = vi.fn()
    const parent = { id: 'agent-a', followup, whenIdle: async () => {} }
    const start = vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed', structured: { met: true, evidence: 'Confirmed' }, output: [{ type: 'text', text: 'Verified result' }] }), dispose: async () => {} }))
    const executor = createProactivityExecutor({ get: () => parent } as never, { getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }), start } as never, { pollMs: 1000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000, sendMail })
    await expect(executor.execute(execution({ condition: 'Ready', recipient: 'owner@example.com' }))).resolves.toMatchObject({ terminal: true })
    expect(sendMail).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledTimes(2)
    expect(followup).not.toHaveBeenCalled()
  })

  it('defers unverified host mail before any model run while preserving user connector delivery', async () => {
    const start = vi.fn(async () => ({ result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Sent by connector' }] }), dispose: async () => {} }))
    const mailReady = vi.fn(async () => { throw new ProactivityDeferredError('mail not verified') })
    const executor = createProactivityExecutor({ get: () => ({ id: 'agent-a' }) } as never, { getProvider: () => ({ capabilities: {} }), start } as never, { pollMs: 1000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000, sendMail: async () => {}, mailReady })
    await expect(executor.execute(execution({ recipient: 'owner@example.com' }))).rejects.toBeInstanceOf(ProactivityDeferredError)
    expect(start).not.toHaveBeenCalled()
    await executor.execute(execution({ recipient: 'owner@example.com', senderIdentity: 'user' }))
    expect(start).toHaveBeenCalledOnce()
    expect(mailReady).toHaveBeenCalledOnce()
  })

  it('recovers confirmed email without running the model or condition again', async () => {
    const start = vi.fn()
    const sendMail = vi.fn()
    const mailReady = vi.fn(async () => 'Persisted body')
    const executor = createProactivityExecutor({ get: () => ({ id: 'agent-a' }) } as never, { getProvider: () => ({ capabilities: {} }), start } as never, { pollMs: 1000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000, sendMail, mailReady })
    await expect(executor.execute(execution({ condition: 'Ready', recipient: 'owner@example.com' }))).resolves.toEqual({ summary: 'email sent to owner@example.com: Persisted body', terminal: true })
    expect(start).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

})
