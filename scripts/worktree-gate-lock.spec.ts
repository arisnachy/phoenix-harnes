import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireWorktreeGateLock } from './worktree-gate-lock.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'phoenix-gate-lock-'))
  roots.push(value)
  return value
}

describe('worktree gate lock', () => {
  it('retains ownership until the holder releases it', async () => {
    const cwd = await root()
    const first = await acquireWorktreeGateLock(cwd, 'typecheck')
    const waiting = acquireWorktreeGateLock(cwd, 'build', { retryMs: 5, timeoutMs: 2_000 })
    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    await first.release()
    const second = await waiting
    expect(JSON.parse(await readFile(second.path, 'utf8'))).toMatchObject({ mode: 'build' })
    await second.release()
  })

  it('recovers a lock whose owner process no longer exists', async () => {
    const cwd = await root()
    await writeFile(join(cwd, '.phoenix-gates.lock'), JSON.stringify({
      pid: 999_999, token: 'dead', mode: 'old', createdAt: new Date().toISOString(),
    }))
    const lock = await acquireWorktreeGateLock(cwd, 'check-all', { processAlive: () => false })
    expect(JSON.parse(await readFile(lock.path, 'utf8'))).toMatchObject({ mode: 'check-all' })
    await lock.release()
  })

  it('does not delete a live owner when waiting times out', async () => {
    const cwd = await root()
    const first = await acquireWorktreeGateLock(cwd, 'doc-sync')
    await expect(acquireWorktreeGateLock(cwd, 'build', {
      retryMs: 1,
      timeoutMs: 5,
      processAlive: () => true,
    })).rejects.toThrow(/PID .*doc-sync/u)
    expect(await readFile(first.path, 'utf8')).toContain('doc-sync')
    await first.release()
  })
})
