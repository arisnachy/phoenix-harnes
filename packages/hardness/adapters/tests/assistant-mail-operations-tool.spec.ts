import { describe, expect, it, vi } from 'vitest'
import { createAssistantMailOperationsTool } from '../src/assistant-mail-operations-tool.ts'
import type { AssistantMailControl } from '../src/assistant-mail-runtime.ts'

function control(operate?: AssistantMailControl['operate']): AssistantMailControl {
  return {
    status: async () => ({ state: 'ready', inboxId: 'kira@agentmail.to', connection: 'connected' }),
    ensure: async () => ({ state: 'ready', inboxId: 'kira@agentmail.to', connection: 'connected' }),
    operate: operate ?? (async (action, input) => ({ action, input })),
  }
}

describe('Kira AgentMail operations tool', () => {
  it('exposes real mailbox reads instead of claiming AgentMail is unavailable', async () => {
    const operate = vi.fn(async () => ({ count: 1, messages: [{ message_id: 'm1' }] }))
    const tool = createAssistantMailOperationsTool(() => control(operate))
    await expect(tool.execute({ action: 'list_messages' }, { callId: 'call-read' } as never)).resolves.toMatchObject({
      kind: 'kira_agentmail',
      action: 'list_messages',
      result: { count: 1 },
    })
    expect(operate).toHaveBeenCalledWith('list_messages', expect.objectContaining({ action: 'list_messages' }))
  })

  it('adds a stable per-tool-call idempotency key to real sends', async () => {
    const operate = vi.fn(async () => ({ message_id: 'sent', thread_id: 'thread' }))
    const tool = createAssistantMailOperationsTool(() => control(operate))
    await tool.execute({
      action: 'send_message',
      to: ['owner@example.com'],
      subject: 'Resultado',
      text: 'Terminado',
    }, { callId: 'call-123' } as never)
    expect(operate).toHaveBeenCalledWith('send_message', expect.objectContaining({
      idempotency_key: 'phoenix-agentmail-call-123',
    }))
  })

  it('preserves an explicit idempotency key and creates deterministic resource client IDs', async () => {
    const operate = vi.fn(async () => ({ ok: true }))
    const tool = createAssistantMailOperationsTool(() => control(operate))
    await tool.execute({
      action: 'reply_message',
      message_id: 'm1',
      text: 'Gracias',
      idempotency_key: 'business-reply-1',
    }, { callId: 'call-reply' } as never)
    await tool.execute({
      action: 'create_draft',
      to: ['owner@example.com'],
      subject: 'Borrador',
      text: 'Texto',
    }, { callId: 'call-draft' } as never)
    expect(operate).toHaveBeenNthCalledWith(1, 'reply_message', expect.objectContaining({
      idempotency_key: 'business-reply-1',
    }))
    expect(operate).toHaveBeenNthCalledWith(2, 'create_draft', expect.objectContaining({
      client_id: 'phoenix-agentmail-call-draft',
    }))
  })
})


it('forwards Free quota status and explicit trash cleanup operations to the resident host', async () => {
  const operate = vi.fn(async (action: string) => action === 'quota_status'
    ? { plan: 'free', remaining: { monthlyEmails: 2500 } }
    : { mode: 'execute', deleted: 3 })
  const tool = createAssistantMailOperationsTool(() => control(operate))
  await tool.execute({ action: 'quota_status', refresh: true }, { callId: 'quota' } as never)
  await tool.execute({
    action: 'cleanup_execute',
    older_than_days: 7,
    max_delete: 100,
    confirm_cleanup: true,
  }, { callId: 'cleanup' } as never)
  expect(operate).toHaveBeenNthCalledWith(1, 'quota_status', expect.objectContaining({ refresh: true }))
  expect(operate).toHaveBeenNthCalledWith(2, 'cleanup_execute', expect.objectContaining({
    older_than_days: 7,
    confirm_cleanup: true,
  }))
})
