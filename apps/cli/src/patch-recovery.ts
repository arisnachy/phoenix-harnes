import { createHash } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs'

/**
 * Cold-boot recovery for mutable PHOENIX patch layers.
 *
 * A patch becomes last-known-good only after the complete profile boot has
 * succeeded. If a later candidate bricks cold boot, PHOENIX moves that exact
 * candidate aside, restores the verified generation, removes listeners left
 * by the failed startup attempt, and retries once. A second failure restores
 * the candidate and remains fail-loud: recovery must never hide a core defect.
 */

const LKG_SUFFIX = '.last-known-good'
const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const

type Listener = (...args: any[]) => void
interface ListenerSnapshot { readonly listeners: ReadonlyMap<string, ReadonlySet<Listener>> }

export interface PatchRollback {
  readonly activePath: string
  readonly rejectedPath: string
}

export function lastKnownGoodPath(patchPath: string): string {
  return `${patchPath}${LKG_SUFFIX}`
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function filesMatch(left: string, right: string): boolean {
  return existsSync(left) && existsSync(right) && digest(left) === digest(right)
}

function harden(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows ACLs do not map cleanly to POSIX modes. The file remains in the
    // same already-private profile directory; never fail boot over chmod.
  }
}

function atomicCopy(source: string, destination: string): void {
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`
  try {
    copyFileSync(source, temporary)
    harden(temporary)
    renameSync(temporary, destination)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}

/** Promote the current patch generation only after a complete successful boot. */
export function promotePatchGeneration(patchPaths: readonly string[]): void {
  for (const patchPath of new Set(patchPaths)) {
    const lkg = lastKnownGoodPath(patchPath)
    if (!existsSync(patchPath)) {
      if (existsSync(lkg)) unlinkSync(lkg)
      continue
    }
    if (!filesMatch(patchPath, lkg)) atomicCopy(patchPath, lkg)
  }
}

/**
 * Roll back changed patch candidates that have a verified sidecar. The failed
 * candidate is moved, not copied, so recovery does not create another copy of
 * potentially sensitive configuration material.
 */
export function rollbackChangedPatches(patchPaths: readonly string[]): PatchRollback[] {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rollbacks: PatchRollback[] = []
  for (const patchPath of new Set(patchPaths)) {
    const lkg = lastKnownGoodPath(patchPath)
    if (!existsSync(patchPath) || !existsSync(lkg) || filesMatch(patchPath, lkg)) continue

    const rejectedPath = `${patchPath}.rejected-${stamp}-${digest(patchPath).slice(0, 12)}`
    renameSync(patchPath, rejectedPath)
    try {
      atomicCopy(lkg, patchPath)
    } catch (error) {
      renameSync(rejectedPath, patchPath)
      throw error
    }
    rollbacks.push({ activePath: patchPath, rejectedPath })
  }
  return rollbacks
}

/** Restore the candidate when the known-good retry also fails. */
export function restoreRejectedPatches(rollbacks: readonly PatchRollback[]): void {
  for (const { activePath, rejectedPath } of [...rollbacks].reverse()) {
    if (!existsSync(rejectedPath)) continue
    if (existsSync(activePath)) unlinkSync(activePath)
    renameSync(rejectedPath, activePath)
  }
}

function snapshotProcessListeners(): ListenerSnapshot {
  const emitter = process as unknown as EventEmitter
  return {
    listeners: new Map(PROCESS_EVENTS.map(event => [
      event,
      new Set(emitter.rawListeners(event) as Listener[]),
    ])),
  }
}

/** Remove only listeners installed by a failed runProfile attempt. */
function restoreProcessListeners(snapshot: ListenerSnapshot): void {
  const emitter = process as unknown as EventEmitter
  for (const event of PROCESS_EVENTS) {
    const before = snapshot.listeners.get(event) ?? new Set<Listener>()
    for (const listener of emitter.rawListeners(event) as Listener[]) {
      if (!before.has(listener)) emitter.removeListener(event, listener)
    }
  }
}

/**
 * Run a cold boot transaction with one bounded last-known-good retry.
 *
 * The first success seeds/promotes LKG. On failure, only changed candidates
 * with an existing verified LKG are eligible. The failed run's process-level
 * listeners are removed before retry so recovery cannot accumulate signal or
 * fatal-rejection handlers. If the retry also fails, the candidate is restored
 * and both failures are surfaced.
 */
export async function runWithColdPatchRecovery<T>(
  patchPaths: readonly string[],
  run: () => Promise<T>,
): Promise<T> {
  const firstListeners = snapshotProcessListeners()
  try {
    const value = await run()
    promotePatchGeneration(patchPaths)
    return value
  } catch (firstError) {
    restoreProcessListeners(firstListeners)
    const rollbacks = rollbackChangedPatches(patchPaths)
    if (rollbacks.length === 0) throw firstError

    process.stderr.write(
      `dsh: cold boot rejected ${String(rollbacks.length)} changed patch generation(s); retrying last-known-good once\n`,
    )

    const retryListeners = snapshotProcessListeners()
    try {
      const value = await run()
      promotePatchGeneration(patchPaths)
      return value
    } catch (retryError) {
      restoreProcessListeners(retryListeners)
      restoreRejectedPatches(rollbacks)
      throw new AggregateError(
        [firstError, retryError],
        'dsh: cold boot recovery failed; rejected patch candidate restored',
      )
    }
  }
}
