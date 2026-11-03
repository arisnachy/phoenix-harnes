import { describe, expect, it } from 'vitest'
import type { SessionListState } from '@phoenix-ai/dsh-client-runtime/client'
import { cleanupCandidateIds } from '../src/client/cleanup.ts'

type Roster = Pick<SessionListState, 'ids' | 'byId'>
const roster: Roster = {
  ids: ['older', 'recent', 'current'] as SessionListState['ids'],
  byId: {
    older: { id: 'older', updatedAt: new Date(2025, 3, 2, 12).getTime() },
    recent: { id: 'recent', updatedAt: new Date(2026, 8, 1, 12).getTime() },
    current: { id: 'current', updatedAt: new Date(2026, 9, 22, 12).getTime(), running: true },
  } as unknown as SessionListState['byId'],
}

describe('user-governed session cleanup preview', () => {
  it('selects exact identities, not forged or missing rows', () => {
    expect(cleanupCandidateIds(roster, 'selected', ['current', 'forged'], '', '')).toEqual(['current'])
    expect(cleanupCandidateIds(roster, 'selected', [], '', '')).toEqual([])
  })

  it('includes an active session under all and honors an inclusive last-activity cutoff', () => {
    expect(cleanupCandidateIds(roster, 'all', [], '', '')).toEqual(roster.ids)
    expect(cleanupCandidateIds(roster, 'before', [], '2025-04-02', '')).toEqual(['older'])
    expect(cleanupCandidateIds(roster, 'between', [], '2026-10-22', '2026-09-01'))
      .toEqual(['recent', 'current'])
  })

  it('rejects empty, invalid or reversed dates rather than deleting a broader set', () => {
    for (const invalid of ['', '2026-13-01', '2026-02-30', 'tomorrow']) {
      expect(cleanupCandidateIds(roster, 'before', [], invalid, '')).toEqual([])
    }
    expect(cleanupCandidateIds(roster, 'between', [], '2026-01-01', '2026-05-01')).toEqual([])
  })
})
