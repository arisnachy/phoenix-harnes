import { describe, expect, it } from 'vitest'
import type { CallId } from '@phoenix-ai/dsh-llm/brand'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import {
  subagentActivityProjectionDefinition,
  type ActivityState,
} from '../src/projection.ts'

function fold(events: SessionEvent[]) {
  let state: ActivityState = subagentActivityProjectionDefinition.init()
  for (const item of events) state = subagentActivityProjectionDefinition.apply(state, item)
  return subagentActivityProjectionDefinition.wire.view(state)
}

const event = (type: SessionEvent['type'], seq: number, data: unknown): SessionEvent => ({
  type, seq, time: seq * 10, data,
}) as SessionEvent

function descriptor(seq = 0): SessionEvent {
  return event('subagent/descriptor', seq, {
    version: 1,
    mode: 'one-shot',
    provider: 'subagent',
  })
}

function header(seq: number, provider = 'openai-codex', model = 'gpt-5.6-luna'): SessionEvent {
  return event('request/header', seq, {
    header: { config: { provider, model } },
    reason: 'initial',
  })
}

function result(seq: number, turn: number, callId: CallId): SessionEvent {
  return event('tool/result', seq, {
    turn,
    step: 1,
    message: {
      role: 'tool',
      content: [],
      source: { kind: 'tool', callId },
    },
  })
}

describe('subagent activity projection', () => {
  it('projects the effective model and durable activity phases', () => {
    const callId = 'call-1' as CallId
    expect(fold([
      descriptor(),
      event('turn/start', 1, { turn: 1 }),
      header(2),
    ])).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna', phase: 'preparing' })

    expect(fold([
      descriptor(),
      event('turn/start', 1, { turn: 1 }),
      header(2),
      event('tool/call', 3, { turn: 1, step: 1, callId, name: 'read', arguments: '{}' }),
    ])).toMatchObject({ phase: 'running-tools' })
  })

  it('waits for every pending tool before verifying', () => {
    const c1 = 'call-1' as CallId
    const c2 = 'call-2' as CallId
    const prefix = [
      descriptor(),
      event('turn/start', 1, { turn: 1 }),
      event('tool/call', 2, { turn: 1, step: 1, callId: c1, name: 'read', arguments: '{}' }),
      event('tool/call', 3, { turn: 1, step: 1, callId: c2, name: 'grep', arguments: '{}' }),
    ]
    expect(fold([...prefix, result(4, 1, c1)])).toMatchObject({ phase: 'running-tools' })
    expect(fold([...prefix, result(4, 1, c1), result(5, 1, c2)])).toMatchObject({ phase: 'verifying' })
  })

  it('ignores unknown results and events from another turn', () => {
    const callId = 'call-1' as CallId
    const unknown = 'unknown' as CallId
    expect(fold([
      descriptor(),
      event('turn/start', 1, { turn: 1 }),
      event('tool/call', 2, { turn: 1, step: 1, callId, name: 'read', arguments: '{}' }),
      result(3, 1, unknown),
      result(4, 2, callId),
    ])).toMatchObject({ phase: 'running-tools' })
  })

  it('resets inherited model and phase at the child descriptor', () => {
    expect(fold([
      header(0, 'ancestor', 'ancestor-model'),
      event('turn/start', 1, { turn: 1 }),
      descriptor(2),
    ])).toEqual({ phase: 'idle' })
  })

  it('returns idle safely before a descriptor or valid header', () => {
    expect(fold([])).toEqual({ phase: 'idle' })
    expect(fold([
      event('turn/start', 0, { turn: 1 }),
      event('request/header', 1, { header: { config: {} }, reason: 'initial' }),
    ])).toEqual({ phase: 'idle' })
  })
})
