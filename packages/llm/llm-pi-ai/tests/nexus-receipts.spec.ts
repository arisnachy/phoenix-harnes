import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NexusReceiptStore } from '../src/nexus-receipts.ts'

describe('Nexus durable receipts', () => {
  it('retains measured data across independent stores and concurrent writers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexus-receipts-'))
    try {
      const filename = join(dir, 'receipts.json')
      const first = new NexusReceiptStore(filename)
      const second = new NexusReceiptStore(filename)
      const receipt = { provider: 'openrouter', model: 'test/model', timestamp: Date.now(),
        inputTokens: 10, outputTokens: 5, latencyMs: 50, succeeded: true }
      expect(await first.read(Date.now())).toEqual([])
      await Promise.all([first.record(receipt), second.record({ ...receipt, succeeded: false })])
      const restored = await new NexusReceiptStore(filename).read(Date.now())
      expect(restored).toHaveLength(2)
      expect(restored.map(r => r.succeeded).sort()).toEqual([false, true])
      expect(await first.read(Date.now() + 9 * 24 * 3_600_000)).toEqual([])
      await writeFile(filename, '{"version":2,"receipts":[]}')
      await expect(first.read(Date.now())).rejects.toThrow('Invalid Nexus receipt file')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
