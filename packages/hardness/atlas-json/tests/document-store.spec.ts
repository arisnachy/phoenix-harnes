import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonDocumentStore } from '../src/index.ts'

let root: string | undefined
afterEach(async () => { if (root !== undefined) await rm(root, { recursive: true, force: true }); root = undefined })

describe('durable JSON document store', () => {
  it('round-trips validated lab state atomically', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-document-'))
    const store = new JsonDocumentStore(join(root, 'lab.json'), (value) => {
      if (typeof value !== 'object' || value === null || !('version' in value)) throw new Error('invalid lab')
      return value as { version: number }
    })
    await store.save({ version: 1 })
    await expect(store.load()).resolves.toEqual({ version: 1 })
  })
})
