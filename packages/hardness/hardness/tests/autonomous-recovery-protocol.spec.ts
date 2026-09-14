import { describe, expect, it } from 'vitest'
import type { CapabilityId, CapabilityRouteResult } from '../src/types.ts'
import { evaluateHardnessProtocol, type HardnessProtocolInput } from '../src/operating-protocol.ts'

const routed: CapabilityRouteResult = {
  kind: 'route',
  route: {
    need: { kind: 'test' },
    capability: {
      id: 'tool:test' as CapabilityId,
      kind: 'test',
      name: 'Test',
      description: 'Test capability',
      inputs: [],
      outputs: ['result'],
      dependencies: [],
      requiredPermissions: [],
      provider: 'test',
      location: 'test',
      version: '1.0.0',
      compatibility: [],
      limitations: [],
      modalities: ['native'],
      status: 'verified',
    },
    modality: 'native',
    requiredPermissions: [],
  },
}

const input = (patch: Partial<HardnessProtocolInput> = {}): HardnessProtocolInput => ({
  route: routed,
  inspection: 'completed',
  planning: 'completed',
  approval: 'approved',
  execution: 'pending',
  verification: 'pending',
  presentation: 'pending',
  audit: 'pending',
  ...patch,
})

describe('HARDNESS fail-forward protocol', () => {
  it('treats an unresolved capability as recovery work before asking the user', () => {
    const view = evaluateHardnessProtocol(input({
      route: { kind: 'missing', considered: [], reasons: ['no matching capability'] },
    }))

    expect(view.outcome).toBe('continue')
    expect(view.allowedActions).toEqual(expect.arrayContaining([
      'inspect-alternatives',
      'acquire-or-build-capability',
      'replan',
    ]))
    expect(view.forbiddenActions).toContain('claim-success')
  })

  it('turns execution failure into repair or alternative-route work', () => {
    const view = evaluateHardnessProtocol(input({ execution: 'failed' }))

    expect(view.outcome).toBe('continue')
    expect(view.allowedActions).toEqual(expect.arrayContaining([
      'inspect-failure',
      'select-alternative',
      'repair-or-build-capability',
      'replan',
    ]))
    expect(view.forbiddenActions).toContain('claim-success')
  })

  it('turns verification failure into repair and fresh verification rather than terminal blocking', () => {
    const view = evaluateHardnessProtocol(input({ execution: 'completed', verification: 'failed' }))

    expect(view.outcome).toBe('continue')
    expect(view.allowedActions).toEqual(expect.arrayContaining([
      'inspect-failure',
      'repair-result',
      'replan',
      'verify-result',
    ]))
  })

  it('turns presentation failure into renderer recovery', () => {
    const view = evaluateHardnessProtocol(input({
      execution: 'completed',
      verification: 'passed',
      presentation: 'failed',
    }))

    expect(view.outcome).toBe('continue')
    expect(view.allowedActions).toEqual(expect.arrayContaining([
      'select-alternative-renderer',
      'acquire-or-build-renderer',
      'render-verified-result',
    ]))
  })
})
