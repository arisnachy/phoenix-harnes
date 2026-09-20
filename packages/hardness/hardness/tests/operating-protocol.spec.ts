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
    expect(unknown.allowedActions).toEqual(expect.arrayContaining(['inspect-alternatives', 'acquire-or-build-capability']))
    expect(missing.allowedActions).toEqual(expect.arrayContaining(['inspect-alternatives', 'acquire-or-build-capability']))
    expect(unknown.forbiddenActions).toContain('execute')
    expect(missing.forbiddenActions).toContain('execute')
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

  it('repairs failed verification and never presents an unverified result as complete', () => {
    const view = evaluateHardnessProtocol(input({ approval: 'approved', execution: 'completed', verification: 'failed' }))

    expect(view).toMatchObject({ step: 'verify', outcome: 'continue' })
    expect(view.allowedActions).toEqual(['inspect-failure', 'repair-result', 'replan', 'verify-result'])
    expect(view.forbiddenActions).toEqual(['present', 'audit', 'claim-success'])
  })

  it('renders cognitive routing before execution planning without changing execution authority', () => {
    const rendered = renderHardnessProtocol('en')
    const spanish = renderHardnessProtocol('es')

    expect(rendered).toContain('<phoenix_hardness_protocol>')
    expect(rendered).toContain('inspect → resolve → plan → approve → execute → verify → present → audit')
    expect(rendered).toContain('classify the mission and select or adapt the HARDNESS cognitive workflow')
    expect(rendered).toContain('For every non-trivial mission call hardness_workflow')
    expect(rendered).toContain('Never preface a user-facing reply by saying that you are following guidance')
    expect(spanish).toContain('Nunca antepongas a una respuesta que estás siguiendo una guía')
    expect(rendered).toContain('workflow selection never grants execution authority')
    expect(rendered).toContain('Never execute an unresolved, unapproved, or unverified operation.')
    expect(rendered).toContain('final quality review against the original objective')
    expect(rendered).toContain('For HTML, websites, landing pages, and dashboards require production quality')
    expect(rendered).toContain('visually inspect it on desktop and mobile')
    expect(spanish).toContain('revisión final de calidad contra el objetivo original')
    expect(spanish).toContain('Para HTML, webs, landing pages y dashboards exige calidad de producción')
    expect(rendered).toContain('only pass with a passing quality gate may enter DONE')
    expect(spanish).toContain('clasifica la misión y selecciona o adapta el workflow cognitivo HARDNESS')
    expect(spanish).toContain('usa hardness_workflow')
    expect(spanish).toContain('nunca concede autoridad de ejecución')
    expect(rendered).not.toContain('function')
    expect(rendered).not.toContain('credential')
    expect(rendered).toBe(renderHardnessProtocol('en'))
  })
})
