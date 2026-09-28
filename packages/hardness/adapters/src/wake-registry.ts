import type { WakeExecution, WakeExecutionResult, WakeExecutor } from './wake-engine.ts'
import { JsonWakeStore, MemoryWakeStore, WakeEngine } from './wake-engine.ts'

class DelegatingWakeExecutor implements WakeExecutor {
  private readonly delegates = new Map<symbol, WakeExecutor>()

  bind(owner: symbol, executor: WakeExecutor): void {
    this.delegates.delete(owner)
    this.delegates.set(owner, executor)
  }

  unbind(owner: symbol): void {
    this.delegates.delete(owner)
  }

  async execute(input: WakeExecution): Promise<WakeExecutionResult> {
    const delegates = [...this.delegates.values()]
    const executor = delegates[delegates.length - 1]
    if (executor === undefined) throw new Error('Phoenix wake runtime is not currently available')
    return executor.execute(input)
  }
}

interface SharedWakeEntry {
  readonly executor: DelegatingWakeExecutor
  readonly engine: WakeEngine
  refs: number
}

const shared = new Map<string, SharedWakeEntry>()

/** Shared wake-engine lease with executor binding and reference-counted release. */
export interface WakeEngineLease {
  readonly engine: WakeEngine
  bindExecutor(executor: WakeExecutor): void
  release(): void
}

/**
 * Acquire the process-shared wake engine for one durable ledger path.
 * @param ledgerPath - JSON ledger path, or `:memory:` for ephemeral state.
 * @returns Reference-counted lease over the shared engine.
 */
export function acquireWakeEngine(ledgerPath: string): WakeEngineLease {
  const key = ledgerPath.trim()
  if (key.length === 0) throw new Error('wake ledger path must be a non-empty string')

  let entry = shared.get(key)
  if (entry === undefined) {
    const executor = new DelegatingWakeExecutor()
    const store = key === ':memory:' ? new MemoryWakeStore() : new JsonWakeStore(key)
    entry = { executor, engine: new WakeEngine(store, executor), refs: 0 }
    shared.set(key, entry)
  }
  entry.refs += 1

  const owner = Symbol('wake-engine-lease')
  let released = false
  return {
    engine: entry.engine,
    bindExecutor(executor) {
      if (released) throw new Error('wake engine lease is already released')
      entry!.executor.bind(owner, executor)
    },
    release() {
      if (released) return
      released = true
      entry!.executor.unbind(owner)
      entry!.refs -= 1
      if (entry!.refs === 0) shared.delete(key)
    },
  }
}
