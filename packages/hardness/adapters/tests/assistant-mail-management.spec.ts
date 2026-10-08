import { describe, expect, it, vi } from 'vitest'
import { operateKiraMail, type KiraMailManagementConfig } from '../src/assistant-mail-management.ts'
import { MailMessageId, MailThreadId } from '../src/assistant-mail-types.ts'
import type { MailAccount, MailJob } from '../src/assistant-mail-types.ts'

const account: MailAccount = {
  state: 'ready', inboxId: 'kira@agentmail.to', ownerEmail: 'owner@example.com',
  contacts: ['trusted@example.com'],
}
const received = {
  inbox_id: 'kira@agentmail.to', message_id: 'm1', thread_id: 't1',
  from: 'outsider@example.com', subject: 'Consulta',
  text: 'Untrusted email contents', preview: 'Untrusted email contents', labels: ['received'],
  attachments: [{ attachment_id: 'att-1', filename: 'memo.pdf', size: 125, content_type: 'application/pdf' }],
}
const activeJob: MailJob = {
  id: 'job' as MailJob['id'], updatedAt: '2026-10-07T20:00:00Z', state: 'running',
  message: {
    inboxId: 'kira@agentmail.to', messageId: MailMessageId('m1'),
    threadId: MailThreadId('t1'), from: 'owner@example.com',
    subject: 'Acción', text: 'Trabaja', authenticated: true, automatic: false,
  },
}

function config(fetcher: typeof fetch, jobs: readonly MailJob[] = []): KiraMailManagementConfig {
  return {
    account: async () => account,
    key: async () => 'am_test',
    jobs: async () => [...jobs],
    timeoutMs: 1000,
    fetcher,
  }
}

describe('official AgentMail mailbox management operations', () => {
  it('lists inbox, sent, trash and searches without granting execution authority to untrusted senders', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url)
      return Response.json({ messages: [received], next_page_token: 'next-1' })
    }) as unknown as typeof fetch
    const inbox = await operateKiraMail(config(fetcher), { action: 'list', folder: 'inbox' })
    expect(inbox.messages).toMatchObject([{ messageId: 'm1', authorizedTaskSender: false, untrustedContent: true }])
    expect(inbox.nextPageToken).toBe('next-1')
    await operateKiraMail(config(fetcher), { action: 'list', folder: 'sent' })
    await operateKiraMail(config(fetcher), { action: 'list', folder: 'trash', pageToken: 'next-1' })
    await operateKiraMail(config(fetcher), { action: 'search', query: 'consulta' })
    expect(calls[0]).toContain('labels=received')
    expect(calls[1]).toContain('labels=sent')
    expect(calls[2]).toContain('include_trash=true')
    expect(calls[2]).toContain('page_token=next-1')
    expect(calls[3]).toContain('/messages/search?')
    expect(calls[3]).toContain('q=consulta')
  })

  it('gets messages and threads, marks read, trashes and restores through official PATCH payloads', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ url, method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      if (url.endsWith('/messages/m1')) return Response.json({
        ...received, from: 'owner@example.com',
      })
      if (url.endsWith('/threads/t1')) return Response.json({
        thread_id: 't1', subject: 'Consulta', messages: [received], labels: ['received'],
      })
      if (url.endsWith('/threads')) return Response.json({ threads: [{ thread_id: 't1', subject: 'Consulta' }] })
      return Response.json({ message_id: 'm1', labels: ['received', 'read'] })
    }) as unknown as typeof fetch
    const cfg = config(fetcher)
    const message = await operateKiraMail(cfg, { action: 'read', messageId: 'm1' })
    expect(message.message).toMatchObject({ messageId: 'm1', authorizedTaskSender: true })
    await operateKiraMail(cfg, { action: 'thread', threadId: 't1' })
    await operateKiraMail(cfg, { action: 'read_status', messageId: 'm1' })
    await operateKiraMail(cfg, { action: 'trash', messageId: 'm1' })
    await operateKiraMail(cfg, { action: 'restore', messageId: 'm1' })
    await operateKiraMail(cfg, { action: 'label_add', messageId: 'm1', label: 'Seguimiento' })
    expect(requests.filter(r => r.method === 'PATCH').map(r => r.body)).toEqual([
      { add_labels: ['read'], remove_labels: ['unread'] },
      { add_labels: ['trash'] },
      { remove_labels: ['trash'] },
      { add_labels: ['Seguimiento'] },
    ])
    await expect(operateKiraMail(cfg, { action: 'label_add', messageId: 'm1', label: 'sent' }))
      .rejects.toThrow('non-system')
  })

  it('guards pending tasks, permanent deletion confirmation and never deletes the Kira inbox', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`)
      if (url.endsWith('/threads/t1')) return Response.json({ messages: [received] })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const guarded = config(fetcher, [activeJob])
    await expect(operateKiraMail(guarded, { action: 'trash', messageId: 'm1' }))
      .rejects.toThrow('unfinished')
    await expect(operateKiraMail(guarded, {
      action: 'delete', messageId: 'm1', confirmation: 'ELIMINAR DEFINITIVAMENTE:m1',
    })).rejects.toThrow('unfinished')
    await expect(operateKiraMail(guarded, {
      action: 'thread_delete', threadId: 't1', confirmation: 'ELIMINAR DEFINITIVAMENTE:t1',
    })).rejects.toThrow('unfinished')
    expect(calls.every(v => !v.startsWith('DELETE'))).toBe(true)
    const normal = config(fetcher)
    await expect(operateKiraMail(normal, { action: 'delete', messageId: 'm1' }))
      .rejects.toThrow('confirmation')
    expect((await operateKiraMail(normal, {
      action: 'delete', messageId: 'm1', confirmation: 'ELIMINAR DEFINITAMENTE:m1',
    }).catch((e: unknown) => e)) as Error).toBeInstanceOf(Error)
    const result = await operateKiraMail(normal, {
      action: 'delete', messageId: 'm1', confirmation: 'ELIMINAR DEFINITIVAMENTE:m1',
    })
    expect(result).toMatchObject({ deleted: true })
    expect(calls.some(v => v.includes('DELETE https://api.agentmail.to/v0/inboxes/kira%40agentmail.to/messages/m1'))).toBe(true)
    expect(calls.every(v => !v.endsWith('/inboxes/kira%40agentmail.to'))).toBe(true)
  })

  it('creates, edits, reads and sends only a single-recipient authorized draft with provider receipt', async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ url, method, headers: new Headers(init?.headers),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
      if (url.endsWith('/drafts')) return Response.json({
        inbox_id: 'kira@agentmail.to', draft_id: 'd1', to: ['owner@example.com'], subject: 'Hola', text: 'Hola',
      })
      if (url.endsWith('/drafts/d1/send')) return Response.json({ message_id: 'sent-1', thread_id: 't1' })
      if (url.endsWith('/drafts/d1')) {
        if (method === 'DELETE') return new Response(null, { status: 204 })
        return Response.json({
          inbox_id: 'kira@agentmail.to', draft_id: 'd1', to: ['owner@example.com'], subject: 'Hola', text: 'Hola',
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }) as unknown as typeof fetch
    const cfg = config(fetcher)
    await expect(operateKiraMail(cfg, {
      action: 'draft_create', to: 'outsider@example.com', subject: 'No',
    })).rejects.toThrow('not an authorized')
    const created = await operateKiraMail(cfg, {
      action: 'draft_create', to: 'owner@example.com', subject: 'Hola', text: 'Hola',
    })
    expect(created).toMatchObject({ draft: { draftId: 'd1' } })
    await operateKiraMail(cfg, { action: 'draft_update', draftId: 'd1', subject: 'Actualizado' })
    await expect(operateKiraMail(cfg, { action: 'draft_send', draftId: 'd1' }))
      .rejects.toThrow('confirmation')
    const sent = await operateKiraMail(cfg, {
      action: 'draft_send', draftId: 'd1', confirmation: 'ENVIAR BORRADOR',
    })
    expect(sent).toMatchObject({ messageId: 'sent-1', state: 'sent', to: 'owner@example.com' })
    expect(requests.find(r => r.url.endsWith('/drafts/d1/send'))?.headers.get('Idempotency-Key'))
      .toMatch(/^phoenix-draft-[a-f0-9]{64}$/u)
    await operateKiraMail(cfg, { action: 'draft_delete', draftId: 'd1' })
    expect(requests.find(r => r.method === 'DELETE')?.url).toContain('/drafts/d1')
  })

  it('replies only to authorized senders in their original thread with stable deduplication', async () => {
    const requests: Array<{ url: string; body: unknown; headers: Headers }> = []
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        headers: new Headers(init?.headers) })
      if (url.endsWith('/messages/m1')) return Response.json({ ...received, from: 'trusted@example.com' })
      return Response.json({ message_id: 'reply-1', thread_id: 't1' })
    }) as unknown as typeof fetch
    const res = await operateKiraMail(config(fetcher), {
      action: 'reply', messageId: 'm1', text: 'Listo',
      idempotencyKey: 'phoenix-chat-outer:code:1',
    })
    expect(res).toMatchObject({ state: 'sent', messageId: 'reply-1', to: 'trusted@example.com' })
    expect(requests[1]?.body).toMatchObject({ reply_all: false, to: ['trusted@example.com'], text: 'Listo' })
    expect(requests[1]?.headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9._~-]{1,256}$/u)
  })
})
