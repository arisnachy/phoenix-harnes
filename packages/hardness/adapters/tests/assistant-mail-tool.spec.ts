import { describe, expect, it, vi } from 'vitest'
import { createAssistantMailIdentityTool, createAssistantMailSendTool, createAssistantMailInboxTool } from '../src/assistant-mail-tool.ts'
import type { AssistantMailControl } from '../src/assistant-mail-runtime.ts'

function control(overrides: Partial<AssistantMailControl> = {}): AssistantMailControl {
  return {
    recover: overrides.recover ?? (async () => ({ state: 'pending-verification', inboxId: 'kira-real@agentmail.to', connection: 'disconnected' })),
    changeOwner: overrides.changeOwner ?? (async (ownerEmail: string) => ({ state: 'pending-verification', inboxId: 'kira-real@agentmail.to', ownerEmail, connection: 'verification-required' })),
    createInbox: overrides.createInbox ?? (async () => ({ state: 'ready', inboxId: 'kira-another@agentmail.to', connection: 'disconnected' })),
    discard: overrides.discard ?? (async () => ({ state: 'not-configured', connection: 'not-configured' })),
    replace: overrides.replace ?? (async (ownerEmail?: string) => ({ state: 'pending-verification', inboxId: 'kira-replacement@agentmail.to', connection: 'not-configured', ...(ownerEmail === undefined ? {} : { ownerEmail }) })),
    verify: overrides.verify ?? (async () => ({ state: 'ready', inboxId: 'kira-real@agentmail.to', connection: 'connected' })),
    refresh: overrides.refresh ?? (async () => ({ state: 'ready', inboxId: 'kira-real@agentmail.to', connection: 'connected' })),
    sendToOwner: overrides.sendToOwner ?? (async () => ({ from: 'kira-real@agentmail.to', to: 'owner@example.com', messageId: 'sent' as never, threadId: 'thread' as never })),
    sendToAuthorized: overrides.sendToAuthorized ?? (async (to: string) => ({
      from: 'kira-real@agentmail.to', to, messageId: 'sent' as never, threadId: 'thread' as never,
    })),
    readInbox: overrides.readInbox ?? (async () => ({
      inboxId: 'kira-real@agentmail.to',
      messages: [{ messageId: 'message-1', from: 'owner@example.com', subject: 'Tarea', preview: 'Informe', taskState: 'replied' }],
    })),
    listMailJobs: overrides.listMailJobs ?? (async () => [{ id: 'job-1', from: 'owner@example.com', subject: 'Tarea', state: 'replied' }]),
    status: overrides.status ?? (async () => ({
      state: 'ready',
      inboxId: 'kira-real@agentmail.to',
      connection: 'connected',
    })),
    ensure: overrides.ensure ?? (async () => ({
      state: 'pending-verification',
      inboxId: 'kira-new@agentmail.to',
      connection: 'not-configured',
    })),
  }
}

describe('Kira mailbox identity tool', () => {
  it('returns the real Kira inbox instead of inventing Gmail setup', async () => {
    const tool = createAssistantMailIdentityTool(() => control())
    await expect(tool.execute({ action: 'status' }, {} as never)).resolves.toMatchObject({
      kind: 'kira_mail_identity',
      available: true,
      state: 'ready',
      address: 'kira-real@agentmail.to',
      needs_verification: false,
    })
  })

  it('passes only the owner email to autonomous signup when needed', async () => {
    const ensure = vi.fn(async (ownerEmail?: string) => ({
      state: 'pending-verification' as const,
      inboxId: 'kira-created@agentmail.to',
      connection: 'not-configured',
      ...(ownerEmail === undefined ? {} : { ownerEmail }),
    }))
    const tool = createAssistantMailIdentityTool(() => control({ ensure }))

    await expect(tool.execute({
      action: 'ensure',
      owner_email: 'owner@example.com',
    }, {} as never)).resolves.toMatchObject({
      state: 'pending-verification',
      address: 'kira-created@agentmail.to',
      needs_verification: true,
    })
    expect(ensure).toHaveBeenCalledWith('owner@example.com')
  })

  it('asks only for verification email when no owner identity is known', async () => {
    const tool = createAssistantMailIdentityTool(() => control({
      ensure: async () => { throw new Error('owner email required for one-time mailbox verification') },
    }))
    const result = await tool.execute({ action: 'ensure' }, {} as never)
    expect(result).toMatchObject({
      state: 'not-configured',
      available: true,
    })
    expect(JSON.stringify(result)).toContain('owner email')
    expect(JSON.stringify(result)).toContain('Do not ask for an AgentMail API key')
    expect(JSON.stringify(result)).toContain('do not start Gmail OAuth')
  })

  it('never tells the model to fabricate a mailbox when the host service is unavailable', async () => {
    const tool = createAssistantMailIdentityTool(() => undefined)
    const result = await tool.execute({ action: 'ensure' }, {} as never)
    expect(result).toMatchObject({
      available: false,
      state: 'unavailable',
    })
    expect(JSON.stringify(result)).toContain('Do not fall back to Gmail creation')
  })
})

it('exposes a real owner send and reports only the confirmed provider receipt', async () => {
  const service = control()
  const sendToOwner = vi.fn(service.sendToOwner.bind(service))
  const tool = createAssistantMailSendTool(() => control({ sendToOwner }))
  const result = await tool.execute({ subject: 'Prueba', text: 'Hola' },
    { agent: { id: 'lead' }, callId: 'call-owner-mail', rootCallId: 'outer-code-call' } as never)
  expect(sendToOwner).toHaveBeenCalledWith('Prueba', 'Hola', 'phoenix-chat-mail-lead-call-owner-mail')
  expect(result).toMatchObject({ state: 'sent', from: 'kira-real@agentmail.to', to: 'owner@example.com', messageId: 'sent' })
})
it('can activate and refresh the existing mailbox without signup', async () => {
  const service = control()
  const verify = vi.fn(service.verify.bind(service))
  const refresh = vi.fn(service.refresh.bind(service))
  const ensure = vi.fn(service.ensure.bind(service))
  const tool = createAssistantMailIdentityTool(() => control({ verify, refresh, ensure }))
  await tool.execute({ action: 'verify', code: '123456' }, {} as never)
  await tool.execute({ action: 'refresh' }, {} as never)
  expect(verify).toHaveBeenCalledWith('123456')
  expect(refresh).toHaveBeenCalledOnce()
  expect(ensure).not.toHaveBeenCalled()
})

it('keeps two nested sends distinct while sharing a code-mode root', async () => {
  const service = control()
  const sendToOwner = vi.fn(service.sendToOwner.bind(service))
  const tool = createAssistantMailSendTool(() => control({ sendToOwner }))
  for (const callId of ['outer:code:1', 'outer:code:2']) {
    await tool.execute({ subject: 'Prueba', text: 'Hola' },
      { agent: { id: 'lead' }, callId, rootCallId: 'outer' } as never)
  }
  expect(sendToOwner.mock.calls.map(call => call[2])).toEqual([
    'phoenix-chat-mail-lead-outer:code:1', 'phoenix-chat-mail-lead-outer:code:2',
  ])
})
it('does not turn missing runtime or pending delivery into a sent result', async () => {
  await expect(createAssistantMailSendTool(() => undefined)
    .execute({ subject: 'Prueba', text: 'Hola' }, {} as never)).rejects.toThrow('unavailable')
  const tool = createAssistantMailSendTool(() => control({ sendToOwner: async () => { throw new Error('provider confirmation pending') } }))
  await expect(tool.execute({ subject: 'Prueba', text: 'Hola' },
    { agent: { id: 'lead' }, callId: 'mail' } as never)).rejects.toThrow('confirmation pending')
})


it('repairs the pending mailbox owner without replacing the inbox', async () => {
  const changeOwner = vi.fn(async (ownerEmail: string) => ({
    state: 'pending-verification' as const,
    inboxId: 'kira-real@agentmail.to',
    ownerEmail,
    connection: 'verification-required',
  }))
  const tool = createAssistantMailIdentityTool(() => control({ changeOwner }))
  await expect(tool.execute({ action: 'owner', owner_email: 'owner@example.com' }, {} as never)).resolves.toMatchObject({
    state: 'pending-verification',
    address: 'kira-real@agentmail.to',
    owner_email: 'owner@example.com',
  })
  expect(changeOwner).toHaveBeenCalledWith('owner@example.com')
})

it('supports the mailbox discard action', async () => {
  const discard = vi.fn(async () => ({ state: 'not-configured' as const, connection: 'not-configured' }))
  const tool = createAssistantMailIdentityTool(() => control({ discard }))
  await expect(tool.execute({ action: 'discard' }, {} as never)).resolves.toMatchObject({
    state: 'not-configured',
    needs_verification: false,
  })
  expect(discard).toHaveBeenCalledOnce()
})


it('replaces a stale mailbox in one model action while forwarding an optional owner email', async () => {
  const replace = vi.fn(async (ownerEmail?: string) => ({
    state: 'pending-verification' as const,
    inboxId: 'kira-replacement@agentmail.to',
    connection: 'not-configured',
    ...(ownerEmail === undefined ? {} : { ownerEmail }),
  }))
  const tool = createAssistantMailIdentityTool(() => control({ replace }))
  await expect(tool.execute({ action: 'replace', owner_email: 'owner@example.com' }, {} as never)).resolves.toMatchObject({
    state: 'pending-verification',
    address: 'kira-replacement@agentmail.to',
    needs_verification: true,
  })
  expect(replace).toHaveBeenCalledWith('owner@example.com')
})

it('sends to a previously authorized contact with the same stable chat call identity', async () => {
  const sendToAuthorized = vi.fn(async (to: string) => ({
    from: 'kira-real@agentmail.to', to, messageId: 'confirmed' as never, threadId: 'thread' as never,
  }))
  const tool = createAssistantMailSendTool(() => control({ sendToAuthorized }))
  const result = await tool.execute({ subject: 'Informe', text: 'Listo', to: 'trusted@example.com' },
    { agent: { id: 'lead' }, callId: 'authorized-mail' } as never)
  expect(sendToAuthorized).toHaveBeenCalledWith('trusted@example.com', 'Informe', 'Listo',
    'phoenix-chat-mail-lead-authorized-mail')
  expect(result).toMatchObject({ state: 'sent', to: 'trusted@example.com', messageId: 'confirmed' })
})

it('exposes received messages and real task state through the inbox tool', async () => {
  const readInbox = vi.fn(async () => ({
    inboxId: 'kira-real@agentmail.to',
    messages: [{ messageId: 'message-1', from: 'owner@example.com', subject: 'Tarea', preview: 'Informe', text: 'Informe' }],
  }))
  const tool = createAssistantMailInboxTool(() => control({ readInbox }))
  const listed = await tool.execute({ action: 'list', limit: 5 }, {} as never)
  expect(listed).toMatchObject({ kind: 'kira_mail_messages', inboxId: 'kira-real@agentmail.to' })
  expect(readInbox).toHaveBeenCalledWith(5)
  await tool.execute({ action: 'read', message_id: 'message-1' }, {} as never)
  expect(readInbox).toHaveBeenCalledWith(1, 'message-1')
  const jobs = await tool.execute({ action: 'jobs' }, {} as never)
  expect(jobs).toMatchObject({ kind: 'kira_mail_jobs', jobs: [{ state: 'replied' }] })
})

it('does not fake inbox contents when the Kira mailbox host is missing', async () => {
  const tool = createAssistantMailInboxTool(() => undefined)
  await expect(tool.execute({ action: 'list' }, {} as never)).rejects.toThrow('unavailable')
  await expect(createAssistantMailInboxTool(() => control()).execute({ action: 'read' }, {} as never))
    .rejects.toThrow('message_id')
})
