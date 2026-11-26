import { describe, expect, it } from 'vitest'
import { SessionToolFactory } from '../src/session-tool-factory.ts'

const definition = {
  id: 'double', title: 'Double a value',
  program: { inputs: ['x'], steps: [{ id: 'double-step', dependsOn: [], output: 'y',
    expression: { op: 'mul', args: [{ var: 'x' }, 2] } }] },
  fixtures: [{ inputs: { x: 1 }, expected: { y: 2 } },
    { inputs: { x: 2 }, expected: { y: 4 } },
    { inputs: { x: 3 }, expected: { y: 6 } }],
}
describe('session tool factory', () => {
  it('creates, discovers, executes and removes fixture-tested tools without persistence', () => {
    const factory = new SessionToolFactory()
    expect(factory.execute('session-a', 'create', JSON.stringify(definition))).toMatchObject({
      id: 'double', fixturesPassed: 3, persistent: false, externalPermissions: false,
    })
    expect(factory.execute('session-a', 'create', JSON.stringify(definition))).toMatchObject({ reused: true })
    expect(factory.execute('session-a', 'list', '{}')).toMatchObject({ tools: [{ id: 'double' }] })
    expect(factory.execute('session-a', 'run', '{"id":"double","inputs":{"x":9}}')).toMatchObject({
      results: { y: 18 }, deterministic: true, externalValidation: false,
    })
    expect(factory.execute('session-b', 'list', '{}')).toEqual({ tools: [] })
    expect(() => factory.execute('session-b', 'run', '{"id":"double","inputs":{"x":9}}')).toThrow('FACTORY_TOOL_NOT_FOUND')
    expect(factory.execute('session-a', 'remove', '{"id":"double"}')).toEqual({ id: 'double', removed: true })
    expect(factory.execute('session-a', 'list', '{}')).toEqual({ tools: [] })
  })
  it('rejects failed fixtures and conflicting definitions rather than promoting them', () => {
    const factory = new SessionToolFactory()
    const broken = { ...definition, fixtures: [...definition.fixtures.slice(0, 2), { inputs: { x: 3 }, expected: { y: 999 } }] }
    expect(() => factory.execute('session-a', 'create', JSON.stringify(broken))).toThrow('AMPLIFIER_RECIPE_FIXTURE_FAILED')
    expect(factory.execute('session-a', 'list', '{}')).toEqual({ tools: [] })
    factory.execute('session-a', 'create', JSON.stringify(definition))
    expect(() => factory.execute('session-a', 'create', JSON.stringify({ ...definition, title: 'Changed' }))).toThrow('FACTORY_ID_EXISTS')
  })
})
