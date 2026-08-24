/** Exclusive, ownership-checked lock for build gates sharing one worktree. */

import { randomUUID } from 'node:crypto'
import { open, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

interface LockRecord {
  readonly pid: number
  readonly token: string
  readonly mode: string
  readonly createdAt: string
}

/** Held worktree gate lock. Release removes only the caller's own record. */
export interface WorktreeGateLock {
  readonly path: string
  release(): Promise<void>
}

export interface WorktreeGateLockOptions {
  readonly retryMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
  readonly processAlive?: (pid: number) => boolean
}

/** Acquire one lock without allowing concurrent writers in the same checkout. */
export async function acquireWorktreeGateLock(
  root: string,
  mode: string,
  options: WorktreeGateLockOptions = {},
): Promise<WorktreeGateLock> {
  const path = join(root, '.phoenix-gates.lock')
  const token = randomUUID()
  const now = options.now ?? Date.now
  const retryMs = options.retryMs ?? 500
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  const processAlive = options.processAlive ?? isProcessAlive
  const started = now()
  const record: LockRecord = { pid: process.pid, token, mode, createdAt: new Date(started).toISOString() }

  for (;;) {
    try {
      const handle = await open(path, 'wx')
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
      } finally {
        await handle.close()
      }
      return {
        path,
        release: async () => {
          const current = await readLock(path)
          if (current?.token === token && current.pid === process.pid) await unlink(path).catch(ignoreMissing)
        },
      }
    } catch (error: unknown) {
      if (!isCode(error, 'EEXIST')) throw error
      const current = await readLock(path)
      const age = await lockAge(path, now())
      if ((current === undefined && age >= 60_000)
        || (current !== undefined && !processAlive(current.pid))) {
        await unlink(path).catch(ignoreMissing)
        continue
      }
      if (now() - started >= timeoutMs) {
        const owner = current === undefined ? 'unknown owner' : `PID ${current.pid} (${current.mode})`
        throw new Error(`run-gates: timed out waiting for worktree lock held by ${owner}: ${path}`)
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, retryMs) })
    }
  }
}

async function readLock(path: string): Promise<LockRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    if (!('pid' in value) || typeof value.pid !== 'number') return undefined
    if (!('token' in value) || typeof value.token !== 'string') return undefined
    if (!('mode' in value) || typeof value.mode !== 'string') return undefined
    if (!('createdAt' in value) || typeof value.createdAt !== 'string') return undefined
    return value as LockRecord
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT') || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function lockAge(path: string, now: number): Promise<number> {
  try {
    return Math.max(0, now - (await stat(path)).mtimeMs)
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return 0
    throw error
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return isCode(error, 'EPERM')
  }
}

function ignoreMissing(error: unknown): void {
  if (!isCode(error, 'ENOENT')) throw error
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
