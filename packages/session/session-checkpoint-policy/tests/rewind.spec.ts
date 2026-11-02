import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@phoenix-ai/cordis'
import { apply, findRewindBoundary } from '../src/index.ts'

const event = (type: string, seq: number) => ({ type, seq, time: seq, data: {} })

function threeTurns() {
  return [
    event('turn/start', 0), event('user/message', 1), event('turn/end', 2),
    event('turn/start', 3), event('assistant/message', 4), event('turn/end', 5),
    event('turn/start', 6), event('assistant/message', 7), event('turn/end', 8),
  ]
}

interface CommandDefinition {
  name: string
  handler(input: { agent: { session: { events: unknown[] } }; rawInput: string }): { kind: string; text?: string }
}

function commandHarness() {
  const definitions: CommandDefinition[] = []
  const fork = vi.fn((_source: unknown, boundary: number) => ({ id: `child-${boundary}` }))
  const ctx = {
    sessions: { fork },
    on: vi.fn(),
    inject: (_services: unknown, callback: (child: unknown) => void) => {
      callback({ commands: { register: (definition: CommandDefinition) => definitions.push(definition) } })
    },
  } as unknown as Context
  apply(ctx)
  const command = (name: string): CommandDefinition => {
    const found = definitions.find(definition => definition.name === name)
    if (found === undefined) throw new Error(`missing command ${name}`)
    return found
  }
  return { command, fork }
}

describe('rewind boundary selection', () => {
  it('rewinds by completed turns to a legal between-turn fork boundary', () => {
    const events = threeTurns()
    expect(findRewindBoundary(events as never, 1)).toBe(5)
    expect(findRewindBoundary(events as never, 2)).toBe(2)
    expect(events).toHaveLength(9)
  })

  it('rejects invalid and unavailable rewind depths instead of inventing a pre-log boundary', () => {
    const one = [event('turn/start', 0), event('turn/end', 1)]
    expect(() => findRewindBoundary(one as never, 0)).toThrow(/positive safe-integer/i)
    expect(() => findRewindBoundary(one as never, 1)).toThrow(/completed turn boundary/i)
    expect(() => findRewindBoundary(one as never, 2)).toThrow(/completed turn boundary/i)
  })
})

describe('session navigation commands', () => {
  it('forks at the latest completed boundary or an explicit event seq', () => {
    const { command, fork } = commandHarness()
    const agent = { session: { events: threeTurns() } }

    expect(command('fork').handler({ agent, rawInput: '' })).toEqual({
      kind: 'success',
      text: 'forked session child-8 at event 8; original session preserved',
    })
    expect(command('fork').handler({ agent, rawInput: '5' })).toEqual({
      kind: 'success',
      text: 'forked session child-5 at event 5; original session preserved',
    })
    expect(fork.mock.calls.map(call => call[1])).toEqual([8, 5])
  })

  it('rewinds completed turns non-destructively through the same fork seam', () => {
    const { command, fork } = commandHarness()
    const agent = { session: { events: threeTurns() } }

    expect(command('rewind').handler({ agent, rawInput: '' })).toEqual({
      kind: 'success',
      text: 'rewound 1 turn(s) into session child-5 at event 5; original future preserved',
    })
    expect(command('rewind').handler({ agent, rawInput: '2' })).toEqual({
      kind: 'success',
      text: 'rewound 2 turn(s) into session child-2 at event 2; original future preserved',
    })
    expect(fork.mock.calls.map(call => call[1])).toEqual([5, 2])
  })

  it('returns command errors for malformed or unavailable boundaries', () => {
    const { command } = commandHarness()
    const agent = { session: { events: threeTurns() } }

    expect(command('fork').handler({ agent, rawInput: '-1' })).toMatchObject({ kind: 'error', text: expect.stringMatching(/non-negative integer/i) })
    expect(command('rewind').handler({ agent, rawInput: '0' })).toMatchObject({ kind: 'error', text: expect.stringMatching(/positive integer/i) })
    expect(command('rewind').handler({ agent, rawInput: '99' })).toMatchObject({ kind: 'error', text: expect.stringMatching(/completed turn boundary/i) })
  })

  it('reports that a plain fork needs at least one completed turn', () => {
    const { command } = commandHarness()
    const agent = { session: { events: [] } }
    expect(command('fork').handler({ agent, rawInput: '' })).toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/no completed turn/i),
    })
  })
})
