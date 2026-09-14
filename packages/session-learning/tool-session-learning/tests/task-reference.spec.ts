import { describe, expect, it } from 'vitest'
import { RecentTaskLedger, resolveTaskReference } from '../src/task-reference.ts'

describe('resolveTaskReference', () => {
  it('resolves a vague previous-problem request to the most recent substantive task, not an older unrelated task', () => {
    const tasks = [
      { id: 'tv', sessionId: 's', text: 'Fix LG TV reads so connect happens before request', projectId: 'phoenix', observedAt: 1_000, verified: true },
      { id: 'brand', sessionId: 's', text: 'Continue the Brand Institute BrandPoll survey browser workflow and repair the blocked step', projectId: 'phoenix', observedAt: 2_000, verified: true },
    ] as const

    const resolved = resolveTaskReference('Tengo otro problema parecido al anterior. Resuélvelo de la forma más eficiente que conozcas.', tasks, 'phoenix')
    expect(resolved?.task.id).toBe('brand')
    expect(resolved?.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('does not invent a referent when no prior substantive task exists', () => {
    expect(resolveTaskReference('Hazlo como el problema anterior.', [], 'phoenix')).toBeUndefined()
  })
})

describe('RecentTaskLedger', () => {
  it('keeps referential follow-ups attached to the resolved prior task instead of storing the vague message as a new task', () => {
    const ledger = new RecentTaskLedger()
    ledger.observeUserMessage('s', 'Fix the Brand Institute BrandPoll browser flow.', { projectId: 'phoenix', occurredAt: 1_000 })
    ledger.complete('s', 1_100)
    ledger.observeUserMessage('s', 'Tengo otro problema parecido al anterior. Resuélvelo.', { projectId: 'phoenix', occurredAt: 1_200 })

    expect(ledger.currentTask('s')).toBe('Fix the Brand Institute BrandPoll browser flow.')
    expect(ledger.resolvedReference('s')?.task.text).toContain('Brand Institute')
    expect(ledger.tasks('s')).toHaveLength(1)
  })

  it('does not resolve across a known different project when a project-specific task is requested', () => {
    const ledger = new RecentTaskLedger()
    ledger.observeUserMessage('a', 'Repair the BrandPoll flow.', { projectId: 'brand', occurredAt: 1_000 })
    ledger.complete('a', 1_100)
    ledger.observeUserMessage('b', 'Fix Phoenix UI transcript ordering.', { projectId: 'phoenix', occurredAt: 1_200 })
    ledger.complete('b', 1_300)

    expect(resolveTaskReference('Hazlo como el anterior.', ledger.tasks(), 'other-project')).toBeUndefined()
  })
})
