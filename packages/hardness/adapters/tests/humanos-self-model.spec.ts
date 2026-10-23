import { describe, expect, it, vi } from 'vitest'
import { inspectHumanOSSelfModel, installHumanOSSelfModel, renderHumanOSSelfModel } from '../src/humanos-self-model.ts'
import type { HumanOSAssemblyContext, HumanOSObservationSources } from '../src/humanos-self-model.ts'

function sources(
  statuses: readonly string[],
  tasks: readonly Record<string, unknown>[] = [],
): HumanOSObservationSources {
  return {
    hardness: { list: () => statuses.map((status, index) => ({
      status, id: `cap-${index}`, name: `never disclose secret-${index}`,
    })) },
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
    expect(text).toContain('Resolve and verify the exact tool')
    expect(text).not.toContain('secret-0')
    expect(text).not.toContain('model-name')
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

  it('does not project operational state outside an agent scope', () => {
    const current = sources(['verified'])
    expect(inspectHumanOSSelfModel(current, {}, time)).toBeUndefined()
    expect(renderHumanOSSelfModel(current, {}, time)).toBe('')
    expect(renderHumanOSSelfModel(current, { agent: { id: '   ' } }, time)).toBe('')
  })

  it('uses the model-visible context registry without installing a new store or tool', () => {
    const dispose = vi.fn()
    const context = vi.fn((_section: { readonly name: string; readonly order: number; readonly text: string | ((assembly: HumanOSAssemblyContext) => string); readonly interpolateVariables?: boolean }) => dispose)
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
