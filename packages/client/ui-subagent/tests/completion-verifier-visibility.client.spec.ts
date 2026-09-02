import { describe, expect, it } from 'vitest'
import { filterVisibleSubagentEntries } from '../src/client/SubagentHeaderLineage.tsx'

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
  it('shows only the active completion judge/tester while preserving ordinary inactive subagents', () => {
    const entries = [
      child('judge-old', 'goal-completion-judge', 'inactive'),
      child('judge-current', 'goal-completion-judge', 'running'),
      child('tester-old', 'goal-adversarial-tester', 'inactive'),
      child('researcher-history', 'researcher', 'inactive'),
    ] as never

    expect(filterVisibleSubagentEntries(entries)).toEqual([
      child('judge-current', 'goal-completion-judge', 'running'),
      child('researcher-history', 'researcher', 'inactive'),
    ])
  })
})
