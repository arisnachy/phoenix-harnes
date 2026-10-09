import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { teamMissionClosed } from '../src/mission-closure.ts'

const start = { type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent
const finished = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent
const cancelled = { type: 'turn/end', data: {
  turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
} } as unknown as SessionEvent
const peer = { type: 'user/message', data: {
  source: { kind: 'team-message' }, content: [{ type: 'text', text: 'Review again' }],
} } as unknown as unknown as SessionEvent
const human = { type: 'user/message', data: {
  source: { kind: 'user' }, content: [{ type: 'text', text: 'New request' }],
} } as unknown as unknown as SessionEvent

const browserCall = (id: string, name: string) => ({
  type: 'tool/call', data: { callId: id, name, arguments: '{}' },
}) as unknown as SessionEvent
const browserResult = (id: string) => ({
  type: 'tool/result', data: {
    message: { source: { callId: id }, content: [{ type: 'tool-result', isError: false }] },
  },
}) as unknown as SessionEvent
const kiraAnswer = (text: string) => ({
  type: 'assistant/message', data: {
    message: { content: [{ type: 'text', text }] },
  },
}) as unknown as SessionEvent

describe('Kira Team closure after verified completion', () => {
  it('prevents the redundant Selenium review in the SAME turn after real submit and wait_for receipts', () => {
    const verified = [
      start, browserCall('send', 'mcp__phoenix_browser__submit_form'), browserResult('send'),
      browserCall('check', 'mcp__phoenix_browser__wait_for'), browserResult('check'),
      kiraAnswer('El formulario ya quedó enviado y verificado. No queda trabajo pendiente que justifique delegar.'),
    ]
    expect(teamMissionClosed(verified)).toBe(true)
    expect(teamMissionClosed([...verified, peer])).toBe(true)
    expect(teamMissionClosed([...verified, human])).toBe(false)
  })

  it('never trusts a completion claim without actual action and verification receipts', () => {
    const claim = kiraAnswer('No queda trabajo pendiente que justifique delegar.')
    expect(teamMissionClosed([start, claim])).toBe(false)
    expect(teamMissionClosed([start, browserCall('a', 'mcp__phoenix_browser__submit_form'),
      browserResult('a'), claim])).toBe(false)
    expect(teamMissionClosed([start, browserCall('a', 'mcp__phoenix_browser__wait_for'),
      browserResult('a'), claim])).toBe(false)
  })

  it('closes on successful turn/end and never reopens for a late Aegis review', () => {
    expect(teamMissionClosed([start, finished])).toBe(true)
    expect(teamMissionClosed([start, finished, peer])).toBe(true)
  })

  it('closes on user cancellation without waking the old mission', () => {
    expect(teamMissionClosed([start, cancelled, peer])).toBe(true)
  })

  it('admits subsequent genuine human turns without reusing the old closure', () => {
    expect(teamMissionClosed([start, finished, human])).toBe(false)
    expect(teamMissionClosed([start, finished, { ...start, data: { turn: 2 } } as unknown as SessionEvent])).toBe(false)
    expect(teamMissionClosed([start])).toBe(false)
    expect(teamMissionClosed([])).toBe(false)
  })
})
