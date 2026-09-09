import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { readJsonl } from '../src/read-jsonl.ts'

const roots: string[] = []

async function fixture(text: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'phoenix-jsonl-'))
  roots.push(root)
  const path = join(root, 'ledger.jsonl')
  await writeFile(path, text)
  return path
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('phoenix-jsonl-')) {
      throw new Error('Unexpected fixture directory')
    }
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves physical line numbers and applied rows before malformed JSON', async () => {
  const path = await fixture('\n{"id":1}\n  \ninvalid\n{"id":2}\n')
  const apply = vi.fn()
  await expect(readJsonl(path, 'memory ledger row', apply)).rejects.toMatchObject({
    message: 'memory ledger row 4 is not valid JSON',
    cause: expect.any(SyntaxError) as unknown,
  })
  expect(apply.mock.calls).toEqual([[{ id: 1 }, 2]])
})

it('treats a missing ledger as empty', async () => {
  const path = await fixture('')
  await rm(path)
  const apply = vi.fn()
  await readJsonl(path, 'cognitive memory row', apply)
  expect(apply).not.toHaveBeenCalled()
})

it('propagates row validation failures without applying later rows', async () => {
  const path = await fixture('{}\n{}\n')
  const failure = new Error('Invalid memory record')
  const apply = vi.fn(() => { throw failure })
  await expect(readJsonl(path, 'memory ledger row', apply)).rejects.toBe(failure)
  expect(apply).toHaveBeenCalledTimes(1)
})

it('rejects a directory supplied as the ledger instead of treating it as empty', async () => {
  const path = await fixture('')
  const apply = vi.fn()
  await expect(readJsonl(dirname(path), 'memory ledger row', apply)).rejects.toBeInstanceOf(Error)
  expect(apply).not.toHaveBeenCalled()
})

it('applies valid rows in order through the end of the file', async () => {
  const path = await fixture('1\n\n2\n')
  const apply = vi.fn()
  await readJsonl(path, 'memory ledger row', apply)
  expect(apply.mock.calls).toEqual([[1, 1], [2, 3]])
})
