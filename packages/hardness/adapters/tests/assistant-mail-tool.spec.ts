import { describe, expect, it, vi } from 'vitest'
import { createAssistantMailIdentityTool, createAssistantMailSendTool } from '../src/assistant-mail-tool.ts'
import type { AssistantMailControl } from '../src/assistant-mail-runtime.ts'

function control(overrides: Partial<AssistantMailControl> = {}): AssistantMailControl {
  return {
    recover: overrides.recover ?? (async () => ({ state: 'pending-verification', inboxId: 'kira-real@agentmail.to', connection: 'disconnected' })),
    createInbox: overrides.createInbox ?? (async () => ({ state: 'ready', inboxId: 'kira-another@agentmail.to', connection: 'disconnected' })),
    verify: overrides.verify ?? (async () => ({ state: 'ready', inboxId: 'kira-real@agentmail.to', connection: 'connected' })),
    refresh: overrides.refresh ?? (async () => ({ state: 'ready', inboxId: 'kira-real@agentmail.to', connection: 'connected' })),
    sendToOwner: overrides.sendToOwner ?? (async () => ({ from: 'kira-real@agentmail.to', to: 'owner@example.com', messageId: 'sent' as never, threadId: 'thread' as never })),
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
