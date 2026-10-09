import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { teamMissionClosed } from '../src/mission-closure.ts'

const start = { type: 'turn/start', data: { turn: 1 } } as SessionEvent
const finished = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as SessionEvent
const cancelled = { type: 'turn/end', data: {
  turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
} } as SessionEvent
const peer = { type: 'user/message', data: {
  source: { kind: 'team-message' }, content: [{ type: 'text', text: 'Review again' }],
} } as unknown as SessionEvent
const human = { type: 'user/message', data: {
  source: { kind: 'user' }, content: [{ type: 'text', text: 'New request' }],
} } as unknown as SessionEvent

describe('Kira Team closure after verified completion', () => {
  it('closes on successful turn/end and never reopens for a late Aegis review', () => {
    expect(teamMissionClosed([start, finished])).toBe(true)
    expect(teamMissionClosed([start, finished, peer])).toBe(true)
  })

  it('closes on user cancellation without waking the old mission', () => {
    expect(teamMissionClosed([start, cancelled, peer])).toBe(true)
  })

  it('admits subsequent genuine human turns without reusing the old closure', () => {
    expect(teamMissionClosed([start, finished, human])).toBe(false)
    expect(teamMissionClosed([start, finished, { ...start, data: { turn: 2 } } as SessionEvent])).toBe(false)
    expect(teamMissionClosed([start])).toBe(false)
    expect(teamMissionClosed([])).toBe(false)
  })
})
