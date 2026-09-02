import { describe, expect, it } from 'vitest'
import {
  filterCompletionVerifierSessionState,
  filterVisibleSubagentEntries,
} from '../src/client/completion-verifier-visibility.ts'

const child = (
  id: string,
  label: string,
  activity: 'running' | 'inactive',
) => ({
  kind: 'child' as const,
  id,
  label,
  mode: 'one-shot' as const,
  activity,
  hasChildren: false,
})

describe('completion verifier visibility', () => {
  it('shows only active completion workers while preserving ordinary inactive subagents', () => {
    const entries = [
      child('judge-old', 'goal-completion-judge', 'inactive'),
      child('judge-current', 'goal-completion-judge', 'running'),
      child('design-old', 'goal-adversarial-test-design', 'inactive'),
      child('tester-old', 'goal-adversarial-tester', 'inactive'),
      child('researcher-history', 'researcher', 'inactive'),
    ] as never

    expect(filterVisibleSubagentEntries(entries)).toEqual([
      child('judge-current', 'goal-completion-judge', 'running'),
      child('researcher-history', 'researcher', 'inactive'),
    ])
  })

  it('removes settled completion workers from the lineage-only summary view so counters do not linger', () => {
    const state = {
      byId: {
        'judge-old': { id: 'judge-old', origin: 'subagent', parentId: 'parent', running: false },
        'judge-current': { id: 'judge-current', origin: 'subagent', parentId: 'parent', running: true },
        'researcher-history': { id: 'researcher-history', origin: 'subagent', parentId: 'parent', running: false },
      },
      subagentsByParent: {
        parent: {
          entries: [
            child('judge-old', 'goal-completion-judge', 'inactive'),
            child('judge-current', 'goal-completion-judge', 'running'),
            child('researcher-history', 'researcher', 'inactive'),
          ],
          parentAvailable: true,
          state: 'ready',
          error: null,
        },
      },
    } as never

    const visible = filterCompletionVerifierSessionState(state)
    expect(visible.subagentsByParent.parent?.entries).toEqual([
      child('judge-current', 'goal-completion-judge', 'running'),
      child('researcher-history', 'researcher', 'inactive'),
    ])
    expect(visible.byId['judge-old']).toBeUndefined()
    expect(visible.byId['judge-current']).toBeDefined()
    expect(visible.byId['researcher-history']).toBeDefined()
  })
})
