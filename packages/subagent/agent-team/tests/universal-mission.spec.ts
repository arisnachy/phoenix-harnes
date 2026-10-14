import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@phoenix-ai/dsh-session'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { TeamJournal } from '../src/journal.ts'
import { TeamId } from '../src/types.ts'
import {
  UniversalMissionLedger,
  replayUniversalMission,
  universalMissionAcceptsEvent,
  universalMissionTerminal,
  type UniversalMissionSnapshot,
} from '../src/universal-mission.ts'

const original: UniversalMissionSnapshot = {
  id: 'lead:mission:human-1', teamId: TeamId('lead'), userMessageId: 'human-1',
  objective: 'Crear aplicación', origin: 'chat', phase: 'running',
  revision: 1, cancellationEpoch: 0, maxTeammates: 5,
  evidenceIds: [], blockers: [], verified: false,
}
function event(snapshot: UniversalMissionSnapshot, teamId = 'lead'): SessionEvent {
  return { type: 'team/mission', data: { version: 1, teamId: TeamId(teamId), snapshot } } as SessionEvent
}

describe('universal mission durable replay', () => {
  it('returns no mission before Team starts real work and filters cross-root data', () => {
    expect(replayUniversalMission('lead', [])).toBeUndefined()
    expect(replayUniversalMission('lead', [event(original, 'other')])).toBeUndefined()
  })

  it('enforces exact revisions and refuses forged resurrection after cancellation', () => {
    const cancelled = { ...original, revision: 2, cancellationEpoch: 1, phase: 'cancelled' as const }
    const fake = { ...original, revision: 3, phase: 'running' as const }
    const output = replayUniversalMission('lead', [event(original), event(cancelled), event(fake)])
    expect(output).toEqual(cancelled)
    expect(universalMissionAcceptsEvent(output, original.id, 0)).toBe(false)
    expect(universalMissionTerminal(output?.phase ?? 'running')).toBe(true)
  })

  it('accepts a separate real human-request identity after prior closure', () => {
    const cancelled = { ...original, revision: 2, cancellationEpoch: 1, phase: 'cancelled' as const }
    const next = { ...original, id: 'lead:mission:human-2', userMessageId: 'human-2' }
    expect(replayUniversalMission('lead', [event(original), event(cancelled), event(next)])).toEqual(next)
    expect(universalMissionAcceptsEvent(next, next.id, 0)).toBe(true)
    expect(universalMissionAcceptsEvent(next, original.id, 0)).toBe(false)
  })

  it('does not close a newer mission when a stale earlier turn ends after it', async () => {
    const events: SessionEvent[] = [event(original)]
    const root = { id: 'lead', session: { events } } as unknown as Agent
    const journal = {
      transact: async (_id: unknown, operation: () => Promise<unknown>) => await operation(),
      appendAndFlush: async (_root: unknown, type: string, data: unknown) => {
        events.push({ type, data } as SessionEvent)
      },
    } as unknown as TeamJournal
    const ledger = new UniversalMissionLedger(journal)
    const stale = await ledger.close(root, true, { verified: false, evidenceIds: [] }, 'old-mission')
    expect(stale).toEqual(original)
    expect(ledger.read(root)).toEqual(original)
    const closed = await ledger.close(root, true, { verified: false, evidenceIds: [] }, original.id)
    expect(closed?.phase).toBe('cancelled')
    expect(closed?.cancellationEpoch).toBe(1)
    expect(universalMissionAcceptsEvent(ledger.read(root), original.id, 0)).toBe(false)
  })

  it('rejects skipped revisions, stale epochs and unrelated roots', () => {
    const skipped = { ...original, revision: 3, cancellationEpoch: 1 }
    const stale = { ...original, revision: 2, cancellationEpoch: -1 }
    expect(replayUniversalMission('lead', [event(original), event(skipped), event(stale)])).toEqual(original)
    expect(universalMissionAcceptsEvent(original, original.id, 1)).toBe(false)
    expect(replayUniversalMission('other', [event(original)])).toBeUndefined()
  })
})
