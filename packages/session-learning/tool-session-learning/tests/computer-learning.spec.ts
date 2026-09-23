import { describe, expect, it } from 'vitest'
import type { CognitiveMemoryRecord, MemoryId } from '@phoenix-ai/dsh-session-learning'
import {
  ComputerLearningProjector,
  filterComputerSearchHits,
  projectComputerEvent,
  type ComputerMemoryStore,
} from '../src/computer-learning.ts'

class MemoryStore implements ComputerMemoryStore {
  readonly rows: CognitiveMemoryRecord[] = []

  timeline(query: { projectId?: string; includeHistory?: boolean } = {}): CognitiveMemoryRecord[] {
    return this.rows.filter(row => (query.projectId === undefined || row.projectId === query.projectId)
      && (query.includeHistory === true || row.status === 'active'))
  }

  async rememberCognitive(input: Parameters<ComputerMemoryStore['rememberCognitive']>[0]): Promise<CognitiveMemoryRecord> {
    for (const row of this.rows) {
      if (row.status === 'active' && row.subject === input.subject && row.projectId === input.projectId) {
        Object.assign(row, { status: 'superseded' })
      }
    }
    const row = {
      id: `computer-${String(this.rows.length + 1)}` as MemoryId,
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      kind: input.kind,
      layers: input.layers,
      content: input.content,
      summary: input.summary,
      subject: input.subject,
      value: input.value,
      ...input.projectId === undefined ? {} : { projectId: input.projectId },
      entities: [],
      relations: [],
      provenance: {
        sessionId: input.sessionId,
        eventSeq: input.eventSeq,
        sourceEventType: input.sourceEventType,
        sourceUri: 'tool-session-learning://computer-learning-test',
        occurredAt: input.occurredAt,
      },
      confidence: input.confidence,
      importance: input.importance,
      frequency: 1,
      validFrom: input.occurredAt,
      recordedAt: input.occurredAt,
      lastObservedAt: input.occurredAt,
      status: 'active' as const,
    }
    this.rows.push(row)
    return row
  }

  async forgetCognitive(id: MemoryId): Promise<void> {
    const row = this.rows.find(candidate => candidate.id === id)
    if (row !== undefined) Object.assign(row, { status: 'forgotten' })
  }
}

function call(sessionId: string, callId: string, argumentsValue: Record<string, unknown>, seq: number) {
  return event(sessionId, 'tool/call', { callId, name: 'computer', arguments: JSON.stringify(argumentsValue) }, seq)
}

function result(sessionId: string, callId: string, seq: number, failed = false, privateText?: string) {
  return event(sessionId, 'tool/result', {
    message: {
      source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', isError: failed, content: privateText ?? 'accepted' }],
    },
  }, seq)
}

function completed(sessionId: string, goalId: string, seq: number) {
  return event(sessionId, 'goal/change', {
    operation: 'complete',
    goal: { id: goalId, phase: 'complete' },
  }, seq)
}

function event(sessionId: string, type: string, data: Record<string, unknown>, seq: number) {
  return { type, seq, time: 1_000 + seq, data, session: { id: sessionId } }
}

async function verifiedFlow(projector: ComputerLearningProjector, sessionId: string, goalId: string, seq: number, projectId = 'phoenix'): Promise<void> {
  await projector.observe({ id: sessionId, header: { cwd: `C:\\work\\${projectId}` } }, call(sessionId, `call-${goalId}`, {
    action: 'browser_open',
    url: 'https://example.com/login?next=/private#form',
  }, seq), projectId)
  await projector.observe({ id: sessionId }, result(sessionId, `call-${goalId}`, seq + 1, false, 'private-form-value'), projectId)
  await projector.observe({ id: sessionId }, completed(sessionId, goalId, seq + 2), projectId)
}

describe('safe Computer projection', () => {
  it('keeps only a closed action and canonical HTTPS origin', () => {
    const eventValue = call('s', 'c', {
      action: 'browser_fill_form',
      origin: 'https://example.com/login?next=/private#form',
      fields: [{ field: 0, value: 'private-form-value' }],
    }, 1)
    expect(projectComputerEvent(eventValue)).toEqual({ action: 'browser_fill_form', origin: 'https://example.com' })
    expect(JSON.stringify(projectComputerEvent(eventValue))).not.toContain('private-form-value')
    expect(projectComputerEvent(call('s', 'inspect', { action: 'browser_inspect' }, 1))).toEqual({ action: 'browser_inspect' })
    const login = projectComputerEvent(call('s', 'login', {
      action: 'browser_login',
      origin: 'https://example.com/login?next=/private',
      account: 'private-account',
      secret: 'private-password',
    }, 1))
    expect(login).toEqual({ action: 'browser_login', origin: 'https://example.com' })
    expect(JSON.stringify(login)).not.toContain('private-account')
    expect(JSON.stringify(login)).not.toContain('private-password')
    expect(projectComputerEvent(call('s', 'forget', {
      action: 'browser_forget_credentials', origin: 'https://example.com/login',
    }, 1))).toEqual({ action: 'browser_forget_credentials', origin: 'https://example.com' })
    expect(projectComputerEvent(call('s', 'c2', { action: 'type', text: 'private-form-value' }, 2))).toBeUndefined()
    expect(projectComputerEvent(call('s', 'c3', { action: 'browser_open', url: 'http://example.com/private' }, 3))).toBeUndefined()
    expect(projectComputerEvent(call('s', 'c4', { action: 'browser_open', url: 'https://example.com:444/private' }, 4))).toBeUndefined()
  })

  it('does not persist an accepted result before verified goal completion', async () => {
    const store = new MemoryStore()
    const projector = new ComputerLearningProjector(store)
    const session = { id: 'candidate-session', header: { cwd: 'C:\\work\\phoenix' } }
    await projector.observe(session, call(session.id, 'c1', { action: 'browser_open', url: 'https://example.com/private' }, 1), 'phoenix')
    await projector.observe(session, result(session.id, 'c1', 2, false, 'password=synthetic'), 'phoenix')
    expect(store.rows).toHaveLength(0)
    await projector.observe(session, completed(session.id, 'goal-1', 3), 'phoenix')
    expect(store.rows).toHaveLength(1)
    expect(JSON.stringify(store.rows)).not.toContain('password=synthetic')
  })

  it('drops failed, cleared, ambiguous, and invalid-origin traces', async () => {
    const store = new MemoryStore()
    const projector = new ComputerLearningProjector(store)
    const session = { id: 'invalid-session', header: { cwd: 'C:\\work\\phoenix' } }
    await projector.observe(session, call(session.id, 'bad', { action: 'browser_open', url: 'https://example.com' }, 1), 'phoenix')
    await projector.observe(session, result(session.id, 'bad', 2, true), 'phoenix')
    await projector.observe(session, completed(session.id, 'failed-goal', 3), 'phoenix')
    await projector.observe(session, call(session.id, 'clear', { action: 'browser_open', url: 'https://example.com' }, 4), 'phoenix')
    await projector.observe(session, { ...event(session.id, 'goal/change', { operation: 'clear' }, 5) }, 'phoenix')
    await projector.observe(session, completed(session.id, 'cleared-goal', 6), 'phoenix')
    await projector.observe(session, call(session.id, 'http', { action: 'browser_open', url: 'http://example.com' }, 7), 'phoenix')
    await projector.observe(session, completed(session.id, 'http-goal', 8), 'phoenix')
    expect(store.rows).toHaveLength(0)
  })

  it('requires two distinct verified goals in one project before retaining a preference', async () => {
    const store = new MemoryStore()
    const projector = new ComputerLearningProjector(store)
    await verifiedFlow(projector, 's1', 'goal-a', 1)
    expect(store.rows.filter(row => row.subject?.includes('preference'))).toHaveLength(0)
    await verifiedFlow(projector, 's2', 'goal-b', 10)
    const preference = store.rows.find(row => row.subject?.includes('preference'))
    expect(preference).toBeDefined()
    expect(preference?.projectId).toBe('phoenix')
    expect(preference?.value).toContain('preferEmbeddedBrowser')

    await verifiedFlow(projector, 's3', 'goal-b', 20, 'other-project')
    expect(store.rows.filter(row => row.projectId === 'other-project' && row.subject?.includes('preference'))).toHaveLength(0)
  })

  it('exposes safe review fields and forgets through a durable tombstone', async () => {
    const store = new MemoryStore()
    const projector = new ComputerLearningProjector(store)
    await verifiedFlow(projector, 's', 'goal-review', 1)
    const review = projector.review('phoenix')
    expect(review).toHaveLength(1)
    expect(review[0]).toMatchObject({ actions: ['browser_open'], origin: 'https://example.com' })
    expect(JSON.stringify(review)).not.toContain('private')
    expect(await projector.forget(review[0]!.id, 'phoenix')).toBe(true)
    expect(projector.review('phoenix')).toEqual([])
    expect(store.rows[0]?.status).toBe('forgotten')
    expect(filterComputerSearchHits(store.rows.map(record => ({ record })))).toEqual([])
  })
})
