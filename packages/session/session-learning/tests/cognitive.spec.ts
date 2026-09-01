import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CognitiveMemoryLedger } from '../src/cognitive.ts'
import type { CognitiveMemoryInput } from '../src/cognitive.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function input(overrides: Partial<CognitiveMemoryInput> = {}): CognitiveMemoryInput {
  return {
    sessionId: 'session-1',
    eventSeq: 1,
    kind: 'preference',
    layers: ['autobiographical', 'semantic', 'temporal', 'associative'],
    content: 'The user prefers concise answers.',
    summary: 'User prefers concise answers.',
    sourceEventType: 'user/message',
    occurredAt: 100,
    projectId: 'phoenix',
    subject: 'user.preference.response_style',
    value: 'short',
    entities: [{ type: 'concept', value: 'concise', normalized: 'concise' }],
    confidence: 0.95,
    importance: 0.95,
    ...overrides,
  }
}

async function ledger(): Promise<CognitiveMemoryLedger> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-cognitive-'))
  roots.push(root)
  const value = new CognitiveMemoryLedger(join(root, 'cognitive.jsonl'))
  await value.load()
  return value
}

describe('CognitiveMemoryLedger', () => {
  it('keeps every canonical event and restores provenance after restart', async () => {
    const first = await ledger()
    const preference = await first.remember(input())
    await first.remember(input({
      eventSeq: 2,
      kind: 'event',
      layers: ['autobiographical', 'episodic', 'temporal'],
      content: 'A later task completed after the sandbox was used.',
      summary: 'A later task completed after the sandbox was used.',
      sourceEventType: 'turn/end',
      occurredAt: 200,
      entities: [{ type: 'concept', value: 'sandbox', normalized: 'sandbox' }],
    }))

    const restored = new CognitiveMemoryLedger(first.path)
    await restored.load()
    expect(restored.allRecords()).toHaveLength(2)
    expect(restored.allRecords().map(record => record.provenance.sourceUri)).toEqual([
      `session:${preference.sessionId}#event:1`,
      'session:session-1#event:2',
    ])
    expect(restored.search({ query: 'short answers', projectId: 'phoenix' })[0]?.record.id).toBe(preference.id)
    expect(restored.search({ query: 'sandbox', projectId: 'other' })).toEqual([])
    expect(restored.timeline({ projectId: 'phoenix', from: 150, to: 250 })[0]?.eventSeq).toBe(2)
    expect((await readFile(restored.path, 'utf8')).trim().split('\n')).toHaveLength(2)
  })

  it('preserves contradictions as history and supersedes only the active value', async () => {
    const value = await ledger()
    const concise = await value.remember(input())
    const detailed = await value.remember(input({
      eventSeq: 2,
      content: 'The user prefers detailed answers.',
      summary: 'User prefers detailed answers.',
      occurredAt: 200,
      value: 'long',
      entities: [{ type: 'concept', value: 'detailed', normalized: 'detailed' }],
    }))

    expect(detailed.supersedes).toBe(concise.id)
    expect(value.history('user.preference.response_style', 'phoenix').map(record => record.status)).toEqual(['superseded', 'active'])
    expect(value.search({ query: 'answers', projectId: 'phoenix' }).map(hit => hit.record.id)).toEqual([detailed.id])
  })

  it('reinforces duplicate facts without duplicating source events and forgets only explicitly', async () => {
    const value = await ledger()
    const first = await value.remember(input())
    const duplicateSource = await value.remember(input())
    const repeatedFact = await value.remember(input({ sessionId: 'session-2', eventSeq: 4, occurredAt: 400 }))

    expect(duplicateSource.id).toBe(first.id)
    expect(repeatedFact.id).toBe(first.id)
    expect(value.allRecords()[0]?.frequency).toBe(2)
    expect(value.search({ query: 'concise', projectId: 'phoenix' })).toHaveLength(1)

    await value.forget(first.id)
    expect(value.search({ query: 'concise', projectId: 'phoenix' })).toEqual([])
    expect(value.allRecords()[0]?.status).toBe('forgotten')
  })
})
