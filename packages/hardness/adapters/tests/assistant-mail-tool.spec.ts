import { describe, expect, it, vi } from 'vitest'
import { createAssistantMailIdentityTool } from '../src/assistant-mail-tool.ts'
import type { AssistantMailControl } from '../src/assistant-mail-runtime.ts'

function control(overrides: Partial<AssistantMailControl> = {}): AssistantMailControl {
  return {
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
    operate: overrides.operate ?? (async () => ({ ok: true })),
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
      ownerEmail,
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
