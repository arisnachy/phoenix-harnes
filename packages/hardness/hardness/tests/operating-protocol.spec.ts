import { describe, expect, it } from 'vitest'
import type { CapabilityId, CapabilityRouteResult } from '../src/types.ts'
import {
  evaluateHardnessProtocol,
  renderHardnessProtocol,
  type HardnessProtocolInput,
} from '../src/operating-protocol.ts'

const routed: CapabilityRouteResult = {
  kind: 'route',
  route: {
    need: { kind: 'weather' },
    capability: {
      id: 'tool:weather' as CapabilityId,
      kind: 'weather',
      name: 'Weather',
      description: 'Weather lookup',
      inputs: ['location'],
      outputs: ['forecast'],
      dependencies: [],
      requiredPermissions: [{ kind: 'network' }],
      provider: 'test',
      location: 'test',
      version: '1.0.0',
      compatibility: [],
      limitations: [],
      modalities: ['native'],
      status: 'verified',
    },
    modality: 'native',
    requiredPermissions: [{ kind: 'network' }],
  },
}

const input = (patch: Partial<HardnessProtocolInput> = {}): HardnessProtocolInput => ({
  route: routed,
  inspection: 'completed',
  planning: 'completed',
  approval: 'pending',
  execution: 'pending',
  verification: 'pending',
  presentation: 'pending',
  audit: 'pending',
  ...patch,
})

describe('HARDNESS model operating protocol', () => {
  it('requires inspection and planning before approval or execution', () => {
    expect(evaluateHardnessProtocol(input({ inspection: 'pending' }))).toMatchObject({ step: 'inspect', outcome: 'continue' })
    expect(evaluateHardnessProtocol(input({ planning: 'pending' }))).toMatchObject({ step: 'plan', outcome: 'continue' })
  })

  it('blocks unknown and missing needs before any execution step', () => {
    const unknown = evaluateHardnessProtocol(input({
      route: { kind: 'unknown', considered: [], reasons: ['unknown capability kind: weather'] },
    }))
    const missing = evaluateHardnessProtocol(input({
      route: { kind: 'missing', considered: ['tool:weather'], reasons: ['network permission is not granted'] },
    }))

    expect(unknown).toMatchObject({ step: 'resolve', outcome: 'blocked' })
    expect(missing).toMatchObject({ step: 'resolve', outcome: 'blocked' })
    expect(unknown.allowedActions).not.toContain('execute')
    expect(missing.allowedActions).not.toContain('execute')
  })

  it('requires approval before a routed capability can execute', () => {
    const view = evaluateHardnessProtocol(input())

    expect(view).toMatchObject({ step: 'approve', outcome: 'ask-user' })
    expect(view.allowedActions).toEqual(['request-approval'])
    expect(view.forbiddenActions).toContain('execute')
  })

  it('does not allow a no-approval state to bypass declared permissions', () => {
    const view = evaluateHardnessProtocol(input({ approval: 'not-required' }))

    expect(view).toMatchObject({ step: 'approve', outcome: 'blocked' })
    expect(view.allowedActions).toEqual(['report-policy-conflict'])
    expect(view.forbiddenActions).toContain('execute')
  })

  it('advances through execution, verification, presentation, and audit', () => {
    expect(evaluateHardnessProtocol(input({ approval: 'approved' }))).toMatchObject({ step: 'execute', outcome: 'continue' })
    expect(evaluateHardnessProtocol(input({ approval: 'approved', execution: 'completed' }))).toMatchObject({ step: 'verify', outcome: 'continue' })
    expect(evaluateHardnessProtocol(input({ approval: 'approved', execution: 'completed', verification: 'passed' }))).toMatchObject({ step: 'present', outcome: 'continue' })
    expect(evaluateHardnessProtocol(input({ approval: 'approved', execution: 'completed', verification: 'passed', presentation: 'ready' }))).toMatchObject({ step: 'audit', outcome: 'continue' })
    expect(evaluateHardnessProtocol(input({ approval: 'approved', execution: 'completed', verification: 'passed', presentation: 'ready', audit: 'recorded' }))).toMatchObject({ step: 'audit', outcome: 'complete' })
  })

  it('stops on failed verification and never presents an unverified result as complete', () => {
    const view = evaluateHardnessProtocol(input({ approval: 'approved', execution: 'completed', verification: 'failed' }))

    expect(view).toMatchObject({ step: 'verify', outcome: 'blocked' })
    expect(view.allowedActions).toEqual(['inspect-failure', 'report-failure'])
    expect(view.forbiddenActions).toEqual(['present', 'audit', 'claim-success'])
  })

  it('renders a stable model-facing guide without executable values', () => {
    const rendered = renderHardnessProtocol('en')

    expect(rendered).toContain('<phoenix_hardness_protocol>')
    expect(rendered).toContain('inspect → resolve → plan → approve → execute → verify → present → audit')
    expect(rendered).toContain('Never execute an unresolved, unapproved, or unverified operation.')
    expect(rendered).toContain('only pass with a passing quality gate may enter DONE')
    expect(rendered).not.toContain('function')
    expect(rendered).not.toContain('credential')
    expect(rendered).toBe(renderHardnessProtocol('en'))
  })
})
