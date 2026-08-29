import { describe, expect, it, vi } from 'vitest'
import { PermissionBroker } from '../src/permission-broker.ts'
import type { CapabilityId, CapabilitySurface } from '@phoenix-ai/dsh-hardness'

const surface = {
  id: 'tool:calendar@1.0.0:visual', need: { kind: 'calendar_invite' }, capabilityId: 'tool:calendar' as CapabilityId, capabilityVersion: '1.0.0', modality: 'visual', inputs: [], outputs: [], requiredPermissions: [{ kind: 'calendar.write' }], verification: 'verified',
} as const satisfies CapabilitySurface

describe('HARDNESS permission broker boundary', () => {
  it('asks explicitly and grants only the current request', async () => {
    const requestApproval = vi.fn(async () => 'allowed-once' as const)
    const broker = new PermissionBroker(requestApproval)
    await expect(broker.request(surface)).resolves.toEqual({ kind: 'approved', grants: ['calendar.write'] })
    expect(requestApproval).toHaveBeenCalledWith(surface)
  })

  it('fails closed when approval is rejected or unavailable', async () => {
    const broker = new PermissionBroker(async () => 'rejected' as const)
    await expect(broker.request(surface)).resolves.toEqual({ kind: 'denied', reason: 'rejected' })
  })
})
