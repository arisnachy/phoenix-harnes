import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AttentionStore } from '../src/proactivity-attention-store.ts'

describe('durable attention receipts', () => {
  it('retains concurrent receipts across restart and keeps new revisions eligible', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-attention-'))
    try {
      const path = join(directory, 'receipts.json')
      const store = new AttentionStore(path)
      await Promise.all([
        store.record({ itemId: 'a', revision: 'one', state: 'handled' }),
        store.record({ itemId: 'b', revision: 'two', state: 'dismissed' }),
      ])
      const restarted = new AttentionStore(path)
      expect(await restarted.read()).toHaveLength(2)
      expect(await restarted.filter([{ id: 'a', revision: 'one' }, { id: 'a', revision: 'new' }])).toEqual([{ id: 'a', revision: 'new' }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
