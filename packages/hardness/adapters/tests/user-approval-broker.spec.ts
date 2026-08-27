import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserApprovalBroker } from '../src/user-approval-broker.ts'
import type { CapabilitySurface } from '@deepseek-ai/dsh-hardness'

const surface = {
  id: 'tool:calendar@1.0.0:visual', need: { kind: 'calendar_invite' }, capabilityId: 'tool:calendar', capabilityVersion: '1.0.0', modality: 'visual', inputs: [], outputs: [], requiredPermissions: [{ kind: 'calendar.write' }], verification: 'verified',
} as const satisfies CapabilitySurface

describe('HARDNESS user approval broker', () => {
  it('passes explicit agent, signal and reason to the real approval seam', async () => {
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const agent = {} as Agent
    const signal = new AbortController().signal
    const broker = createUserApprovalBroker(approval)
    await expect(broker.request(surface, { agent, signal })).resolves.toEqual({ kind: 'approved', grants: ['calendar.write'] })
    expect(approval.request).toHaveBeenCalledWith({ agent, toolName: 'tool:calendar', reason: 'Capability requires: calendar.write', signal })
  })
})
