import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryLedger } from '../src/ledger.ts'

const roots: string[] = []

async function ledger(): Promise<MemoryLedger> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-'))
  roots.push(root)
  const value = new MemoryLedger(join(root, 'memory.jsonl'))
  await value.load()
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('MemoryLedger', () => {
  it('persists searchable learning records and restores them after reload', async () => {
    const first = await ledger()
    const record = await first.remember({
      sessionId: 'session-1',
      eventSeq: 4,
      kind: 'error',
      summary: 'The sandbox command timed out',
      sourceEventType: 'tool/result',
      confidence: 0.8,
      occurredAt: 100,
    })

    expect(record.id).toMatch(/^memory-/u)
    expect(await first.search('sandbox timed')).toEqual([record])

    const second = new MemoryLedger(first.path)
    await second.load()
    expect(await second.search('SANDBOX')).toEqual([record])
  })

  it('keeps durable high-confidence memories ahead of newer noise', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-learning-recall-'))
    const value = new MemoryLedger(join(root, 'memory.jsonl'))
    await value.remember({ sessionId: 's', eventSeq: 1, kind: 'preference', summary: 'Always use the isolated sandbox', sourceEventType: 'user/message', confidence: 0.95, occurredAt: 1 })
    for (let eventSeq = 2; eventSeq <= 12; eventSeq += 1) {
      await value.remember({ sessionId: 's', eventSeq, kind: 'success', summary: `Recent task ${String(eventSeq)}`, sourceEventType: 'turn/end', confidence: 0.85, occurredAt: eventSeq })
    }

    expect(value.recall(3).map(record => record.summary)).toEqual([
      'Always use the isolated sandbox', 'Recent task 12', 'Recent task 11',
    ])
  })

  it('deduplicates one source event and supports reversible forgetting', async () => {
    const value = await ledger()
    const input = {
      sessionId: 'session-2',
      eventSeq: 1,
      kind: 'success' as const,
      summary: 'The build passed',
      sourceEventType: 'turn/end',
      confidence: 1,
      occurredAt: 200,
    }

    const original = await value.remember(input)
    const duplicate = await value.remember(input)
    expect(duplicate).toEqual(original)
    expect((await value.search('build')).length).toBe(1)

    await value.forget(original.id)
    expect(await value.search('build')).toEqual([])
    expect((await readFile(value.path, 'utf8')).trim().split('\n')).toHaveLength(2)
  })

  it('persists the active-record limit across reloads', async () => {
    const value = new MemoryLedger((await ledger()).path, 1)
    await value.load()
    await value.remember({ sessionId: 's', eventSeq: 1, kind: 'success', summary: 'first', sourceEventType: 'turn/end', confidence: 1, occurredAt: 1 })
    await value.remember({ sessionId: 's', eventSeq: 2, kind: 'success', summary: 'second', sourceEventType: 'turn/end', confidence: 1, occurredAt: 2 })
    const restored = new MemoryLedger(value.path, 1)
    await restored.load()
    expect(await restored.search('first')).toEqual([])
    expect((await restored.search('second'))).toHaveLength(1)
  })
})
