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
      snapshot: () => ({
        formatVersion: 1,
        capabilities: statuses.map((status, index) => ({
          status, id: `cap-${index}`, version: 'v1', name: `never disclose secret-${index}`,
        })),
        evidence: Object.entries(evidence).flatMap(([id, rows]) => rows.map((item, index) => ({
          ...item, id: `${id}-proof-${index}`, capabilityId: id, inputSummary: 'secret fixture',
        }))),
      }),
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
    expect(result?.attention).toBe('verify-before-use')
    expect(result?.verification).toEqual({
      examinedCapabilities: 4, unexaminedCapabilities: 0,
      samplePage: 0, totalPages: 1, sampleStrategy: 'current-evidence-first',
      currentPasses: 1, currentFailures: 1,
      currentDenials: 1, outdatedVersionRecords: 2, capabilitiesWithoutCurrentEvidence: 2,
      capabilitiesWithConflictingEvidence: 1,
    })
    const rendered = renderHumanOSSelfModel(input, scoped, time)
    expect(rendered).not.toContain('secret fixture')
    expect(rendered).not.toContain('cap-0')
    expect(rendered).not.toContain('v1')
  })

  it('requests rechecking when a verified descriptor has failed evidence', () => {
    const result = inspectHumanOSSelfModel(sources(['verified'], [], {
      'cap-0': [{ descriptorVersion: 'v1', outcome: 'failed' }],
    }), scoped, time)
    expect(result?.atlas.brokenOrQuarantined).toBe(0)
    expect(result?.verification.currentFailures).toBe(1)
    expect(result?.attention).toBe('verify-before-use')
  })

  it('uses only the most recent bounded evidence for each descriptor', () => {
    const input = sources(['verified'], [], {
      'cap-0': [
        { descriptorVersion: 'v1', outcome: 'failed' },
        ...Array.from({ length: 12 }, () => ({
          descriptorVersion: 'v1', outcome: 'passed' as const,
        })),
      ],
    })
    const result = inspectHumanOSSelfModel(input, scoped, time)
    expect(result?.verification).toMatchObject({
      examinedCapabilities: 1,
      currentPasses: 12,
      currentFailures: 0,
      capabilitiesWithConflictingEvidence: 0,
    })
  })

  it('bounds verification work and explicitly discloses unexamined capabilities', () => {
    const input = sources(Array.from({ length: 70 }, () => 'verified'))
    const snapshot = vi.fn(() => input.hardness.snapshot())
    const model = inspectHumanOSSelfModel({ ...input, hardness: { snapshot } }, scoped, time)
    expect(model?.atlas.registered).toBe(70)
    expect(model?.verification.examinedCapabilities).toBe(64)
    expect(model?.verification.unexaminedCapabilities).toBe(6)
    expect(model?.verification.capabilitiesWithoutCurrentEvidence).toBe(64)
    expect(snapshot).toHaveBeenCalledOnce()
  })

  it('discovers current-version evidence outside the first 64 registrations and pages without duplicates', () => {
    const many = sources(Array.from({ length: 70 }, () => 'testing'), [], {
      'cap-69': [{ descriptorVersion: 'v1', outcome: 'passed' }],
      'cap-68': [{ descriptorVersion: 'v0', outcome: 'failed' }],
    })
    const first = inspectHumanOSSelfModel(many, scoped, time)
    const second = inspectHumanOSSelfModel(many, scoped, time, 1)
    expect(first?.verification).toMatchObject({
      samplePage: 0, totalPages: 2, sampleStrategy: 'current-evidence-first',
      examinedCapabilities: 64, unexaminedCapabilities: 6,
      currentPasses: 1, currentFailures: 0,
    })
    expect(second?.verification).toMatchObject({
      samplePage: 1, totalPages: 2,
      examinedCapabilities: 6, unexaminedCapabilities: 64,
      currentPasses: 0, currentFailures: 0, outdatedVersionRecords: 1,
    })
    expect(inspectHumanOSSelfModel(many, scoped, time, 100)?.verification.samplePage).toBe(1)
    expect(inspectHumanOSSelfModel(many, scoped, time, -1)?.verification.samplePage).toBe(0)
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

  it('reflects restored atlas state on the next context assembly without retaining a private ledger', () => {
    let active = sources(['testing'])
    const observed: HumanOSObservationSources = {
      hardness: { snapshot: () => active.hardness.snapshot() },
      tasks: { peek: () => active.tasks.peek() },
    }
    expect(inspectHumanOSSelfModel(observed, scoped, time)?.atlas.experimentalOrTesting).toBe(1)
    active = sources(['verified', 'verified', 'broken'])
    expect(inspectHumanOSSelfModel(observed, scoped, time)?.atlas).toMatchObject({
      registered: 3, declaredVerified: 2, brokenOrQuarantined: 1,
    })
    expect(inspectHumanOSSelfModel(observed, scoped, time)?.attention).toBe('verify-before-use')
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
