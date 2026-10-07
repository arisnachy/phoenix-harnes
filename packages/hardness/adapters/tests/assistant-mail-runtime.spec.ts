import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { installAssistantMail } from '../src/assistant-mail-runtime.ts'
import type { AssistantMailControl } from '../src/assistant-mail-runtime.ts'
import { JsonProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import type { MailOutgoingOwnership } from '../src/assistant-mail-types.ts'
import { mailRecord } from '../src/assistant-mail-store.ts'

const input = { taskId: 'mail-task', scheduledFor: '2026-09-28T02:53:29.000Z', to: 'owner@example.com', subject: 'Report', text: 'Done', idempotencyKey: 'mail-task:deliver:2026-09-28T02:53:29.000Z' }
async function fixture(ready = true, existingDirectory?: string, authorizeOutgoing = async (_ownership: MailOutgoingOwnership) => true) {
  const directory = existingDirectory ?? await mkdtemp(join(tmpdir(), 'phoenix-runtime-'))
  await writeFile(join(directory, 'account.json'), JSON.stringify({ state: ready ? 'ready' : 'pending-verification', inboxId: 'kira@agentmail.to', ownerEmail: input.to, contacts: [] }))
  let credential: string | undefined = 'secret'
  const credentials = {
    resolve: async () => credential === undefined ? undefined : ({ value: credential }),
    set: async (_ref: unknown, value: string) => { credential = value },
    unset: async () => { credential = undefined },
  }
  const ctx = { get: (name: string) => name === 'credentials' ? credentials : undefined, on: () => () => {}, effect: () => {} }
  const runtime = installAssistantMail(ctx as never, { directory, authorizeOutgoing, credentialRef: 'MAIL_KEY', pollMs: 60000, timeoutMs: 1000, workTimeoutMs: 1000 }, { pollMs: 60000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000 })
  return { runtime, directory }
}
async function firstOutgoing(directory: string): Promise<Record<string, unknown>> {
  const rows: unknown = JSON.parse(await readFile(join(directory, 'outbox.json'), 'utf8'))
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('expected a persisted outgoing message')
  return mailRecord(rows[0])
}
it('explicit ensure resumes owner attachment for a pending mailbox', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-explicit-ensure-'))
  await writeFile(join(directory, 'account.json'), JSON.stringify({
    state: 'pending-verification',
    inboxId: 'kira@agentmail.to',
    ownerEmail: 'owner@example.com',
    contacts: [],
  }))
  const ctx = new Context()
  let credential = 'am_pending'
  ctx.reflect.provide('credentials', {
    resolve: async () => ({ value: credential }),
    set: async (_ref: unknown, value: string) => { credential = value },
    unset: async () => { credential = '' },
  })
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.agentmail.to/v0/agent/human')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_pending')
    return Response.json({ human_email: 'owner@example.com', instructions: 'Enter the OTP.' })
  })
  vi.stubGlobal('fetch', fetch)
  const runtime = installAssistantMail(ctx, {
    directory,
    authorizeOutgoing: async () => true,
    credentialRef: 'MAIL_KEY',
    pollMs: 60_000,
    timeoutMs: 1000,
    workTimeoutMs: 1000,
  }, { pollMs: 60_000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000 })
  try {
    const service = ctx.get('assistantMail') as AssistantMailControl | undefined
    expect(service).toBeDefined()
    await expect(service!.ensure('owner@example.com')).resolves.toMatchObject({
      state: 'pending-verification',
      inboxId: 'kira@agentmail.to',
    })
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    await runtime.dispose()
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  }
})

describe('owned durable outgoing mail', () => {
  it('commits payload and first attempt before provider IO and deduplicates confirmed sends after restart', async () => {
    const { runtime, directory } = await fixture()
    let calls = 0
    vi.stubGlobal('fetch', async (url: string) => {
      if (!url.endsWith('/send')) return Response.json({ messages: [] })
      calls++
      const row = await firstOutgoing(directory)
      expect(row.firstAttempt).toBeTypeOf('number')
      expect(mailRecord(row.reply).text).toBe('Done')
      return Response.json({ message_id: 'sent', thread_id: 'thread' })
    })
    let restarted: typeof runtime | undefined
    try {
      await runtime.send(input)
      await runtime.dispose()
      restarted = (await fixture(true, directory)).runtime
      await restarted.send(input)
      expect(calls).toBe(1)
      await expect(restarted.send({ ...input, text: 'Changed' })).rejects.toThrow('different content')
    }
    finally {
      await runtime.dispose(); await restarted?.dispose()
      vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true })
    }
  })
  it('rejects new sends after disposal without provider IO', async () => {
    const { runtime, directory } = await fixture()
    const fetch = vi.fn(async (_request: RequestInfo | URL) => Response.json({ messages: [] }))
    vi.stubGlobal('fetch', fetch)
    try {
      await runtime.dispose()
      await expect(runtime.send(input)).rejects.toThrow('disposed')
      expect(fetch.mock.calls.filter(([url]) => {
        const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        return address.endsWith('/send')
      })).toHaveLength(0)
    }
    finally { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
  })
  it('aborts an owned provider send and waits for it during disposal', async () => {
    const { runtime, directory } = await fixture()
    let started!: () => void
    const sending = new Promise<void>((resolve) => { started = resolve })
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      if (!url.endsWith('/send')) return Response.json({ messages: [] })
      started()
      return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true }))
    })
    try {
      const result = runtime.send(input).catch((error: unknown) => error)
      await sending
      await runtime.dispose()
      expect(await result).toBeInstanceOf(Error)
      const row = await firstOutgoing(directory)
      expect(row.state).toBe('pending')
    } finally { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
  })

  it('recovers a bare AgentMail 403 by rotating the stored key and retries the same send once', async () => {
    const { runtime, directory } = await fixture()
    let sends = 0
    let recoveries = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/agent/sign-up')) {
        recoveries++
        return Response.json({ api_key: 'am_rotated', inbox_id: 'kira@agentmail.to' })
      }
      if (url.endsWith('/inboxes/kira%40agentmail.to')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_rotated')
        return Response.json({ inbox_id: 'kira@agentmail.to' })
      }
      if (url.endsWith('/send')) {
        sends++
        if (sends === 1) return Response.json({ message: 'Forbidden' }, { status: 403 })
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_rotated')
        return Response.json({ message_id: 'sent-after-recovery', thread_id: 'thread-after-recovery' })
      }
      return Response.json({ messages: [] })
    })
    try {
      await expect(runtime.send(input)).resolves.toBeUndefined()
      expect(recoveries).toBe(1)
      expect(sends).toBe(2)
      expect((await firstOutgoing(directory)).state).toBe('sent')
      const account: unknown = JSON.parse(await readFile(join(directory, 'account.json'), 'utf8'))
      expect(mailRecord(account).state).toBe('ready')
    } finally { await runtime.dispose(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
  })

  it('recovers a provider verification 403 once and preserves the pending send for owner OTP', async () => {
    const { runtime, directory } = await fixture()
    let recoveries = 0
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/send')) {
        return Response.json({
          code: 'missing_permission',
          message: 'Forbidden',
          fix: 'Complete POST /v0/agent/verify before retrying.',
        }, { status: 403 })
      }
      if (url.endsWith('/agent/sign-up')) {
        recoveries++
        return Response.json({ api_key: 'rotated-secret', inbox_id: 'kira@agentmail.to' })
      }
      return Response.json({ messages: [] })
    })
    try {
      await expect(runtime.send(input)).rejects.toThrow('pending')
      await vi.waitFor(async () => {
        const account: unknown = JSON.parse(await readFile(join(directory, 'account.json'), 'utf8'))
        expect(mailRecord(account).state).toBe('pending-verification')
      })
      expect(recoveries).toBe(1)
      const row = await firstOutgoing(directory)
      expect(row.state).toBe('pending')
      expect(mailRecord(row.reply).text).toBe('Done')
    } finally { await runtime.dispose(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
  })

  it('defers a pending-verification account without issuing provider requests', async () => {
    const { runtime, directory } = await fixture(false)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      await expect(runtime.preflight(input.idempotencyKey)).rejects.toThrow('not verified')
      await expect(runtime.send(input)).rejects.toThrow('not verified')
      expect(fetch).not.toHaveBeenCalled()
    } finally { await runtime.dispose(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
  })

  it.each(['cancelled', 'paused', 'missing'] as const)('suppresses %s task mail during unrelated flush and persisted restart', async (stopped) => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-owner-'))
    const store = new JsonProactivityStore(join(directory, 'tasks.json'))
    let engine = new ProactivityEngine(store, { execute: async () => ({ summary: 'unused' }) }, { id: () => input.taskId })
    await engine.create({ title: 'Report', instruction: 'Send report', runAt: input.scheduledFor, createdBy: 'user', delivery: 'email' })
    const authorizeOutgoing = async (ownership: MailOutgoingOwnership) => {
      const task = await engine.get(ownership.taskId)
      return task !== undefined && ownership.scheduledFor === task.nextRunAt && (task.status === 'scheduled' || task.status === 'running')
    }
    const { runtime } = await fixture(true, directory, authorizeOutgoing)
    let restarted: typeof runtime | undefined
    let calls = 0
    vi.stubGlobal('fetch', async (url: string) => {
      if (!url.endsWith('/send')) return Response.json({ messages: [] })
      calls++
      throw new Error('confirmation lost')
    })
    try {
      await expect(runtime.send(input)).rejects.toThrow('pending')
      expect(calls).toBe(1)
      if (stopped === 'cancelled') await engine.cancel(input.taskId)
      else if (stopped === 'paused') await engine.pause(input.taskId)
      else {
        await store.save({ version: 1, tasks: [] })
        engine = new ProactivityEngine(store, { execute: async () => ({ summary: 'unused' }) })
      }
      await runtime.preflight('unrelated-occurrence')
      expect(calls).toBe(1)
      await runtime.dispose()
      engine = new ProactivityEngine(new JsonProactivityStore(join(directory, 'tasks.json')), { execute: async () => ({ summary: 'unused' }) })
      restarted = (await fixture(true, directory, authorizeOutgoing)).runtime
      await restarted.preflight('another-unrelated-occurrence')
      expect(calls).toBe(1)
      const row = await firstOutgoing(directory)
      expect(row.state).toBe('pending')
      expect(row.firstAttempt).toBeTypeOf('number')
      expect(mailRecord(row.reply).taskId).toBe(input.taskId)
      expect(mailRecord(row.reply).scheduledFor).toBe(input.scheduledFor)
      await writeFile(join(directory, 'outbox.json'), JSON.stringify([{ ...row, firstAttempt: Date.now() - 86_400_000 }]))
      await restarted.preflight('expiry-check')
      expect((await firstOutgoing(directory)).state).toBe('ambiguous')
      expect(calls).toBe(1)
    } finally {
      await runtime.dispose(); await restarted?.dispose()
      vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true })
    }
  })

})

it('retains a real AgentMail inbound wake arriving during an active inbox check without waiting for the poll timer', async () => {
  const sockets: EventTarget[] = []
  const messageEvent = (data: unknown): Event => {
    const event = new Event('message') as Event & { data?: unknown }
    Object.defineProperty(event, 'data', { value: JSON.stringify(data) })
    return event
  }
  class Socket extends EventTarget {
    constructor(_url: string) {
      super()
      sockets.push(this)
      queueMicrotask(() => { this.dispatchEvent(new Event('open')) })
    }
    send(_data: string): void {
      queueMicrotask(() => {
        this.dispatchEvent(messageEvent({ type: 'subscribed', inbox_ids: ['kira@agentmail.to'] }))
      })
    }
    close(): void {}
    receive(): void {
      this.dispatchEvent(messageEvent({
        type: 'message_received',
        event_type: 'message.received',
        message: { inbox_id: 'kira@agentmail.to' },
      }))
    }
  }
  let calls = 0
  let release!: () => void
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('fetch', async () => {
    calls++
    if (calls === 2) await new Promise<void>((resolve) => { release = resolve })
    return Response.json({ messages: [] })
  })
  const { runtime, directory } = await fixture()
  try {
    await vi.waitFor(() => { expect(sockets).toHaveLength(1); expect(calls).toBe(1) })
    ;(sockets[0] as Socket).receive()
    await vi.waitFor(() => { expect(calls).toBe(2) })
    sockets[0]!.receive()
    release()
    await vi.waitFor(() => { expect(calls).toBe(3) })
  } finally { release?.(); await runtime.dispose(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
})
