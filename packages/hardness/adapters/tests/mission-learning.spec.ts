import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import HardnessRegistry from '@phoenix-ai/dsh-hardness/src/index.ts'
import type { CapabilityId, HardnessService } from '@phoenix-ai/dsh-hardness/src/types.ts'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'
import { LabMode, SelfImprovementLedger } from '../src/lab-mode.ts'

const descriptor = {
  id: 'tool:calendar@1.0.0' as CapabilityId, kind: 'calendar', name: 'Calendar builder', description: 'built', inputs: ['event'], outputs: ['invite'], dependencies: [], requiredPermissions: [], provider: 'fixture-builder', location: 'local', version: '1.0.0', compatibility: [], limitations: [], modalities: ['native'], status: 'experimental',
} as const

describe('HARDNESS mission learning', () => {
  it('records prepared BUILD experience without claiming verification', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const lab = new LabMode('mission-learning')
    const ledger = new SelfImprovementLedger()
    const hardness = ctx.get('hardness') as HardnessService
    const registry = new AcquisitionRegistry(hardness, { lab, ledger })
    registry.register(async need => need.kind === 'calendar' ? descriptor : undefined)

    await registry.acquireOrBuild({ kind: 'calendar', inputs: ['event'], outputs: ['invite'] })

    expect(lab.snapshot().experiments).toHaveLength(1)
    expect(lab.snapshot().experiments[0]).toMatchObject({ metric: 'prepared testing capability', result: 1 })
    expect(lab.snapshot().frozen).toHaveLength(0)
    expect(ledger.snapshot()[0]).toMatchObject({ change: 'register testing capability tool:calendar@1.0.0', rollback: 'remove capability tool:calendar@1.0.0' })
    await ctx.fiber.dispose()
  })
})
