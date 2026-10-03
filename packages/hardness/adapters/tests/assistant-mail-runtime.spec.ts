import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installAssistantMail } from '../src/assistant-mail-runtime.ts'
import { JsonProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import type { MailOutgoingOwnership } from '../src/assistant-mail-types.ts'
import { mailRecord } from '../src/assistant-mail-store.ts'

const input = { taskId: 'mail-task', scheduledFor: '2026-09-28T02:53:29.000Z', to: 'owner@example.com', subject: 'Report', text: 'Done', idempotencyKey: 'mail-task:deliver:2026-09-28T02:53:29.000Z' }
async function fixture(ready = true, existingDirectory?: string, authorizeOutgoing = async (_ownership: MailOutgoingOwnership) => true) {
  const directory = existingDirectory ?? await mkdtemp(join(tmpdir(), 'phoenix-runtime-'))
  await writeFile(join(directory, 'account.json'), JSON.stringify({ state: ready ? 'ready' : 'pending-verification', inboxId: 'kira@agentmail.to', ownerEmail: input.to, contacts: [] }))
  const ctx = { get: (name: string) => name === 'credentials' ? { resolve: async () => ({ value: 'secret' }) } : undefined, on: () => () => {}, effect: () => {} }
  const runtime = installAssistantMail(ctx as never, { directory, authorizeOutgoing, credentialRef: 'MAIL_KEY', pollMs: 60000, timeoutMs: 1000, workTimeoutMs: 1000 }, { pollMs: 60000, privateWorkProvider: 'spawn', privateWorkResultChars: 1000 })
  return { runtime, directory }
}
async function firstOutgoing(directory: string): Promise<Record<string, unknown>> {
  const rows: unknown = JSON.parse(await readFile(join(directory, 'outbox.json'), 'utf8'))
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('expected a persisted outgoing message')
  return mailRecord(rows[0])
}
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

it('retains a wake arriving during an active inbox check without waiting for the poll timer', async () => {
  const sockets: EventTarget[] = []
  class Socket extends EventTarget {
    constructor(_url: string) { super(); sockets.push(this); queueMicrotask(() => { this.dispatchEvent(new Event('open')) }) }
    send(_data: string): void {}
    close(): void {}
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
    sockets[0]!.dispatchEvent(new Event('message'))
    await vi.waitFor(() => { expect(calls).toBe(2) })
    sockets[0]!.dispatchEvent(new Event('message'))
    release()
    await vi.waitFor(() => { expect(calls).toBe(3) })
  } finally { release?.(); await runtime.dispose(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) }
})
