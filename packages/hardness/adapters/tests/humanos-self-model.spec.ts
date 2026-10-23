import { describe, expect, it, vi } from 'vitest'
import { inspectHumanOSSelfModel, installHumanOSSelfModel, renderHumanOSSelfModel } from '../src/humanos-self-model.ts'
import type { HumanOSAssemblyContext, HumanOSObservationSources } from '../src/humanos-self-model.ts'

type TestEvidence = { readonly descriptorVersion: string; readonly outcome: 'passed' | 'failed' | 'denied' }

function sources(
  statuses: readonly string[],
  tasks: readonly Record<string, unknown>[] = [],
  evidence: Readonly<Record<string, readonly TestEvidence[]>> = {},
): HumanOSObservationSources {
  return {
    hardness: {
      list: () => statuses.map((status, index) => ({
        status, id: `cap-${index}`, version: 'v1', name: `never disclose secret-${index}`,
      })),
      evidenceFor: (id: string) => (evidence[id] ?? []).map((item, index) => ({
        ...item, id: `${id}-proof-${index}`, capabilityId: id, inputSummary: 'secret fixture',
      })),
    },
    tasks: { peek: () => tasks },
  } as unknown as HumanOSObservationSources
}

const time = new Date('2026-10-22T21:00:00.000Z')
const scoped = { agent: { id: 'session-a', options: { provider: 'openai-codex', model: 'model-name' } } }

describe('Phoenix HumanOS grounded self-model', () => {
  it('counts real registry metadata without claiming verified descriptors are live tools', () => {
    const model = inspectHumanOSSelfModel(
      sources(['verified', 'testing', 'experimental', 'broken', 'quarantined', 'deprecated']),
      scoped,
      time,
    )
    expect(model).toMatchObject({
      schema: 1,
      identity: 'kira',
      modelSelection: { providerSpecified: true, modelSpecified: true },
      atlas: {
        registered: 6, declaredVerified: 1, experimentalOrTesting: 2,
        brokenOrQuarantined: 2, deprecated: 1,
      },
      attention: 'verify-before-use',
    })
    const text = renderHumanOSSelfModel(sources(['verified']), scoped, time)
    expect(text).toContain('not subjective consciousness, live tool availability')
    expect(text).toContain('Resolve the exact capability')
    expect(text).not.toContain('secret-0')
    expect(text).not.toContain('model-name')
  })

  it('calibrates self-knowledge using versioned success, failure and denial evidence', () => {
    const input = sources(['verified', 'testing', 'broken', 'verified'], [], {
      'cap-0': [
        { descriptorVersion: 'v0', outcome: 'passed' },
        { descriptorVersion: 'v1', outcome: 'passed' },
        { descriptorVersion: 'v1', outcome: 'failed' },
      ],
      'cap-1': [{ descriptorVersion: 'v1', outcome: 'denied' }],
      'cap-2': [{ descriptorVersion: 'v0', outcome: 'failed' }],
    })
    const result = inspectHumanOSSelfModel(input, scoped, time)
    expect(result?.verification).toEqual({
      examinedCapabilities: 4, unexaminedCapabilities: 0, currentPasses: 1, currentFailures: 1,
      currentDenials: 1, outdatedVersionRecords: 2, capabilitiesWithoutCurrentEvidence: 2,
      capabilitiesWithConflictingEvidence: 1,
    })
    const rendered = renderHumanOSSelfModel(input, scoped, time)
    expect(rendered).not.toContain('secret fixture')
    expect(rendered).not.toContain('cap-0')
    expect(rendered).not.toContain('v1')
  })

  it('bounds verification work and explicitly discloses unexamined capabilities', () => {
    const consulted: string[] = []
    const input = sources(Array.from({ length: 70 }, () => 'verified'))
    const instrumented: HumanOSObservationSources = {
      ...input,
      hardness: {
        list: input.hardness.list,
        evidenceFor: (id) => {
          consulted.push(id)
          return input.hardness.evidenceFor(id)
        },
      },
    }
    const model = inspectHumanOSSelfModel(instrumented, scoped, time)
    expect(model?.atlas.registered).toBe(70)
    expect(model?.verification.examinedCapabilities).toBe(64)
    expect(model?.verification.unexaminedCapabilities).toBe(6)
    expect(model?.verification.capabilitiesWithoutCurrentEvidence).toBe(64)
    expect(consulted).toHaveLength(64)
  })

  it('filters other-agent tasks and counts only visible agent/global tasks', () => {
    const model = inspectHumanOSSelfModel(sources([], [
      { status: 'failed', targetAgentId: 'session-b', title: 'secret other task' },
      { status: 'running', targetAgentId: 'session-a', title: 'secret current task' },
      { status: 'scheduled', targetAgentId: 'session-a', nextRunAt: '2026-10-22T20:00:00.000Z' },
      { status: 'scheduled', nextRunAt: '2026-10-22T22:00:00.000Z' },
      { status: 'paused', targetAgentId: 'session-a' },
      { status: 'failed', targetAgentId: 'session-a' },
    ]), scoped, time)
    expect(model?.tasks).toEqual({ scheduled: 2, running: 1, failed: 1, paused: 1, due: 1 })
    expect(model?.attention).toBe('inspect-failure')
    const text = renderHumanOSSelfModel(sources([], [
      { status: 'failed', targetAgentId: 'session-b', title: 'other secret' },
    ]), scoped, time)
    expect(text).not.toContain('other secret')
    expect(text).not.toContain('session-b')
  })

  it('prioritizes due work without treating old completed tasks as obligations', () => {
    const input = sources(['verified'], [
      { status: 'completed', targetAgentId: 'session-a' },
      { status: 'cancelled', targetAgentId: 'session-a' },
      { status: 'scheduled', targetAgentId: 'session-a', nextRunAt: '2026-10-22T19:00:00.000Z' },
    ])
    const model = inspectHumanOSSelfModel(input, scoped, time)
    expect(model?.tasks).toEqual({ scheduled: 1, running: 0, failed: 0, paused: 0, due: 1 })
    expect(model?.attention).toBe('check-due-work')
  })

  it('preserves Kira identity across model switches without exposing model ids', () => {
    const input = sources(['verified'])
    const a = renderHumanOSSelfModel(input, {
      agent: { id: 'session-a', options: { provider: 'vendor-one', model: 'model-one' } },
    }, time)
    const b = renderHumanOSSelfModel(input, {
      agent: { id: 'session-a', options: { provider: 'vendor-two', model: 'model-two' } },
    }, time)
    expect(a).toBe(b)
    expect(a).toContain('"identity":"kira"')
    expect(a).not.toContain('vendor-one')
    expect(a).not.toContain('model-one')
    const unselected = inspectHumanOSSelfModel(input, {
      agent: { id: 'session-a', options: { provider: ' ', model: '' } },
    }, time)
    expect(unselected?.modelSelection).toEqual({ providerSpecified: false, modelSpecified: false })
    expect(inspectHumanOSSelfModel(input, { agent: { id: 'session-a' } }, time)?.modelSelection)
      .toEqual({ providerSpecified: false, modelSpecified: false })
  })

  it('does not project operational state outside an agent scope', () => {
    const current = sources(['verified'])
    expect(inspectHumanOSSelfModel(current, {}, time)).toBeUndefined()
    expect(renderHumanOSSelfModel(current, {}, time)).toBe('')
    expect(renderHumanOSSelfModel(current, { agent: { id: '   ' } }, time)).toBe('')
  })

  it('uses the model-visible context registry without installing a new store or tool', () => {
    const dispose = vi.fn()
    const context = vi.fn((_section: {
      readonly name: string
      readonly order: number
      readonly text: string | ((assembly: HumanOSAssemblyContext) => string)
      readonly interpolateVariables?: boolean
    }) => dispose)
    const installer = installHumanOSSelfModel({ context }, sources(['verified']))
    expect(context).toHaveBeenCalledOnce()
    const section = context.mock.calls[0]?.[0]
    expect(section).toMatchObject({
      name: 'hardness:humanos-self-model',
      order: 24,
      interpolateVariables: false,
    })
    if (typeof section?.text !== 'function') throw new Error('expected a dynamic HumanOS context provider')
    expect(section.text(scoped)).toContain('<phoenix_humanos_self_model>')
    installer()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
