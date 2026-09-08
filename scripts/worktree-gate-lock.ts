/** Exclusive, ownership-checked lock for build gates sharing one worktree. */

import { randomUUID } from 'node:crypto'
import { access, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface LockRecord {
  readonly pid: number
  readonly token: string
  readonly mode: string
  readonly createdAt: string
}

interface BorrowerRecord {
  readonly pid: number
  readonly token: string
}

interface MutationMutex {
  close(): void
}

const localMutations = new Map<string, Promise<void>>()

/** Held worktree gate lock. Release removes only the caller's own record. */
export interface WorktreeGateLock {
  readonly path: string
  /** Opaque ownership token inherited only by this aggregate's child gates. */
  readonly token: string
  release(): Promise<void>
}

export interface WorktreeGateLockOptions {
  /** Parent aggregate token; valid only while that worktree's owner is alive. */
  readonly inheritedToken?: string | undefined
  readonly retryMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
  readonly processAlive?: (pid: number) => boolean
}

/**
 * Acquire exclusive aggregate ownership, or join a live parent aggregate.
 * Nested borrowers never remove the parent's lock; its scheduler owns their ordering.
 * @param root - Checkout directory whose gates share build artifacts.
 * @param mode - Aggregate name recorded for contention diagnostics.
 * @param options - Parent ownership and bounded waiting controls.
 * @returns Ownership handle released after all child gates have settled.
 */
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
    const mutex = await acquireMutationMutex(path, started, timeoutMs, retryMs, now)
    let waiting = false
    try {
      try {
        const handle = await open(path, 'wx')
        try {
          await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
        } finally {
          await handle.close()
        }
        return {
          path,
          token,
          release: async () => {
            const closingPath = `${path}.closing-${token}`
            await createClosingMarker(closingPath)
            try {
              for (;;) {
                const releaseMutex = await acquireMutationMutex(path, now(), timeoutMs, retryMs, now)
                try {
                  const current = await readLock(path)
                  if (current?.token !== token || current.pid !== process.pid) return
                  if (await liveBorrowerCount(path, token, processAlive) === 0) {
                    await unlink(path).catch(ignoreMissing)
                    return
                  }
                } finally {
                  releaseMutex.close()
                }
                await delay(retryMs)
              }
            } finally {
              await unlink(closingPath).catch(ignoreMissing)
            }
          },
        }
      } catch (error: unknown) {
        if (!isCode(error, 'EEXIST')) throw error
        const current = await readLock(path)
        if (now() - started >= timeoutMs) {
          const owner = current === undefined ? 'unknown owner' : `PID ${current.pid} (${current.mode})`
          throw new Error(`run-gates: timed out waiting for worktree lock held by ${owner}: ${path}`)
        }
        if (current !== undefined && current.token === options.inheritedToken && processAlive(current.pid)) {
          const closingPath = `${path}.closing-${current.token}`
          if (await fileExists(closingPath)) {
            waiting = true
            continue
          }
          const leasePath = await createBorrowerLease(path, current.token)
          const confirmed = await readLock(path)
          if (confirmed?.token === current.token
          && confirmed.pid === current.pid
          && processAlive(confirmed.pid)
          && !(await fileExists(closingPath))) {
            return {
              path,
              token: current.token,
              release: async () => { await unlink(leasePath).catch(ignoreMissing) },
            }
          }
          await unlink(leasePath).catch(ignoreMissing)
          continue
        }
        const age = await lockAge(path, now())
        if ((current === undefined && age >= 60_000)
        || (current !== undefined && !processAlive(current.pid)
          && await liveBorrowerCount(path, current.token, processAlive) === 0)) {
          await unlink(path).catch(ignoreMissing)
          if (current !== undefined) await unlink(`${path}.closing-${current.token}`).catch(ignoreMissing)
          continue
        }
        waiting = true
      }
    } finally {
      mutex.close()
      if (waiting) await delay(retryMs)
    }
  }
}

async function acquireMutationMutex(
  path: string,
  started: number,
  timeoutMs: number,
  retryMs: number,
  now: () => number,
): Promise<MutationMutex> {
  const predecessor = localMutations.get(path) ?? Promise.resolve()
  let finish!: () => void
  const completion = new Promise<void>((resolve) => { finish = resolve })
  const tail = predecessor.then(() => completion)
  localMutations.set(path, tail)
  const releaseLocal = (): void => {
    finish()
    if (localMutations.get(path) === tail) localMutations.delete(path)
  }
  await predecessor
  try {
    for (;;) {
      const database = new DatabaseSync(`${path}.mutex.sqlite`, { timeout: 0 })
      try {
        database.exec('BEGIN IMMEDIATE')
        return {
          close: () => {
            try { database.close() } finally { releaseLocal() }
          },
        }
      } catch (error: unknown) {
        database.close()
        if (typeof error !== 'object' || error === null || !('errcode' in error)
          || typeof error.errcode !== 'number' || (error.errcode & 255) !== 5) throw error
        if (now() - started >= timeoutMs) throw new Error(`run-gates: timed out waiting for lock mutation: ${path}`)
        await delay(Math.min(retryMs, 10))
      }
    }
  } catch (error: unknown) {
    releaseLocal()
    throw error
  }
}

async function createBorrowerLease(path: string, token: string): Promise<string> {
  const leasePath = `${path}.borrower-${randomUUID()}`
  const temporaryPath = `${leasePath}.tmp`
  try {
    const handle = await open(temporaryPath, 'wx')
    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, token } satisfies BorrowerRecord)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, leasePath)
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(ignoreMissing)
    throw error
  }
  return leasePath
}

async function createClosingMarker(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx')
    await handle.close()
  } catch (error: unknown) {
    if (!isCode(error, 'EEXIST')) throw error
  }
}

async function liveBorrowerCount(path: string, token: string, processAlive: (pid: number) => boolean): Promise<number> {
  let entries: string[]
  try {
    entries = await readdir(dirname(path))
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return 0
    throw error
  }
  const prefix = `${basename(path)}.borrower-`
  let count = 0
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || entry.endsWith('.tmp')) continue
    const leasePath = join(dirname(path), entry)
    const borrower = await readBorrowerLease(leasePath)
    if (borrower !== undefined && borrower.token === token && processAlive(borrower.pid)) {
      count += 1
      continue
    }
    await unlink(leasePath).catch(ignoreMissing)
  }
  return count
}

async function readBorrowerLease(path: string): Promise<BorrowerRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    if (!('pid' in value) || typeof value.pid !== 'number') return undefined
    if (!('token' in value) || typeof value.token !== 'string') return undefined
    return value as BorrowerRecord
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT') || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return false
    throw error
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, milliseconds) })
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
