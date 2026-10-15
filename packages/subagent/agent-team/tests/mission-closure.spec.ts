import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import { teamMissionClosed, unfinishedMissionTodos, unfinishedMissionGoal, unfinishedMissionTeamTasks, unfinishedMissionWork } from '../src/mission-closure.ts'

const start = { type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent
const finished = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent
const cancelled = { type: 'turn/end', data: {
  turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
} } as unknown as SessionEvent
const peer = { type: 'user/message', data: {
  source: { kind: 'team-message' }, content: [{ type: 'text', text: 'Review again' }],
} } as unknown as SessionEvent
const human = { type: 'user/message', data: {
  source: { kind: 'user' }, content: [{ type: 'text', text: 'New request' }],
} } as unknown as SessionEvent

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

const checklist = (...statuses: ('pending' | 'in_progress' | 'completed')[]): SessionEvent => ({
  type: 'todo/write',
  data: { todos: statuses.map((status, index) => ({ content: `step ${index + 1}`, status })) },
}) as unknown as SessionEvent

const goalChange = (phase: 'active' | 'complete'): SessionEvent => ({
  type: 'goal/change', data: {
    operation: phase === 'active' ? 'create' : 'complete',
    goal: { id: 'goal-1', objective: 'Publica el juego', phase },
  },
}) as unknown as SessionEvent
const mission = (id = 'mission-1'): SessionEvent => ({
  type: 'team/mission', data: { version: 1, teamId: 'lead',
    snapshot: { id, teamId: 'lead', revision: 1, phase: 'running' } },
}) as unknown as SessionEvent
const teamTask = (status: 'pending' | 'in_progress' | 'completed', revision: number): SessionEvent => ({
  type: 'team/task', data: {
    version: 1, teamId: 'lead',
    task: { id: 'task-1', revision, status },
  },
}) as unknown as SessionEvent

describe('Kira Team closure after verified completion', () => {
  it('does not equate a model turn end with completion of an active durable Goal', () => {
    expect(unfinishedMissionGoal([human, goalChange('active')])).toBe(true)
    expect(unfinishedMissionWork([human, goalChange('active')])).toBe(true)
    expect(teamMissionClosed([human, start, goalChange('active'), finished])).toBe(false)
    expect(teamMissionClosed([human, start, goalChange('active'),
      browserCall('send', 'mcp__phoenix_browser__submit_form'), browserResult('send'),
      browserCall('check', 'mcp__phoenix_browser__wait_for'), browserResult('check'),
      kiraAnswer('No queda trabajo pendiente que justifique delegar.')])).toBe(false)
    expect(teamMissionClosed([human, start, goalChange('active'), cancelled])).toBe(true)
    expect(unfinishedMissionGoal([human, goalChange('active'), goalChange('complete')])).toBe(false)
    expect(teamMissionClosed([human, start, goalChange('active'), goalChange('complete'), finished])).toBe(true)
  })

  it('does not cancel assigned Team tasks until the current mission completes', () => {
    const pending = [human, mission(), teamTask('pending', 1), start]
    expect(unfinishedMissionTeamTasks(pending)).toBe(true)
    expect(teamMissionClosed([...pending, finished])).toBe(false)
    expect(unfinishedMissionTeamTasks([...pending, teamTask('in_progress', 2)])).toBe(true)
    expect(unfinishedMissionTeamTasks([...pending, teamTask('completed', 2)])).toBe(false)
    expect(teamMissionClosed([...pending, teamTask('completed', 2), finished])).toBe(true)
    expect(teamMissionClosed([...pending, cancelled])).toBe(true)
  })

  it('retains unfinished checklist items across steering messages in one mission', () => {
    const active = [human, mission(), checklist('pending'), human]
    expect(unfinishedMissionTodos(active)).toBe(true)
    expect(teamMissionClosed([...active, finished])).toBe(false)
    expect(unfinishedMissionTodos([...active, checklist('completed')])).toBe(false)
    expect(unfinishedMissionTeamTasks([
      human, mission('old'), teamTask('pending', 1),
      { type: 'team/mission', data: { snapshot: {
        id: 'old', revision: 2, phase: 'partial',
      } } } as unknown as SessionEvent,
      human,
    ])).toBe(false)
  })

  it('preserves an unfinished mission despite a completed model turn or premature closing prose', () => {
    const todo = checklist('in_progress', 'pending', 'pending')
    expect(unfinishedMissionTodos([human, start, todo])).toBe(true)
    expect(teamMissionClosed([human, start, todo, finished])).toBe(false)
    expect(teamMissionClosed([
      human, start, todo,
      browserCall('send', 'mcp__phoenix_browser__submit_form'), browserResult('send'),
      browserCall('check', 'mcp__phoenix_browser__wait_for'), browserResult('check'),
      kiraAnswer('No queda trabajo pendiente que justifique delegar.'),
    ])).toBe(false)
    expect(teamMissionClosed([human, start, todo, cancelled])).toBe(true)
    expect(unfinishedMissionTodos([human, start, todo, checklist('completed', 'completed')])).toBe(false)
    expect(teamMissionClosed([human, start, todo, checklist('completed', 'completed'), finished])).toBe(true)
    expect(unfinishedMissionTodos([human, todo, finished, human])).toBe(false)
  })

  it('prevents the redundant Selenium review in the SAME turn after real submit and wait_for receipts', () => {
    const verified = [
      start, browserCall('send', 'mcp__phoenix_browser__submit_form'), browserResult('send'),
      browserCall('check', 'mcp__phoenix_browser__wait_for'), browserResult('check'),
      kiraAnswer('El formulario ya quedó enviado y verificado. No queda trabajo pendiente que justifique delegar.'),
    ]
    expect(teamMissionClosed(verified)).toBe(true)
    expect(teamMissionClosed([...verified, peer])).toBe(true)
    expect(teamMissionClosed([...verified, kiraAnswer('Haré otra revisión y delegaré a Aegis.')])).toBe(true)
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
    // A model-initiated turn/start alone must never revive a closed task.
    expect(teamMissionClosed([start, finished, { ...start, data: { turn: 2 } } as unknown as SessionEvent])).toBe(true)
    expect(teamMissionClosed([start, finished, human, { ...start, data: { turn: 2 } } as unknown as SessionEvent])).toBe(false)
    expect(teamMissionClosed([start])).toBe(false)
    expect(teamMissionClosed([])).toBe(false)
  })
})
