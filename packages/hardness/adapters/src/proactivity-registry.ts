import type { ProactivityExecution, ProactivityExecutionResult, ProactivityExecutor } from './proactivity-engine.ts'
import {
  JsonProactivityStore,
  MemoryProactivityStore,
  ProactivityDeferredError,
  ProactivityEngine,
} from './proactivity-engine.ts'

class DelegatingProactivityExecutor implements ProactivityExecutor {
  private readonly delegates = new Map<symbol, ProactivityExecutor>()

  bind(owner: symbol, executor: ProactivityExecutor): void {
    this.delegates.delete(owner)
    this.delegates.set(owner, executor)
  }

  unbind(owner: symbol): void {
    this.delegates.delete(owner)
  }

  async execute(input: ProactivityExecution): Promise<ProactivityExecutionResult> {
    const delegates = [...this.delegates.values()]
    const executor = delegates[delegates.length - 1]
    if (executor === undefined) {
      throw new ProactivityDeferredError('Phoenix proactive runtime is not currently available')
    }
    return executor.execute(input)
  }
}

interface SharedProactivityEntry {
  readonly executor: DelegatingProactivityExecutor
  readonly engine: ProactivityEngine
  refs: number
}

const shared = new Map<string, SharedProactivityEntry>()

/** A scoped reference to the process-global proactive task engine for one ledger. */
export interface ProactivityEngineLease {
  readonly engine: ProactivityEngine
  bindExecutor(executor: ProactivityExecutor): void
  release(): void
}

/**
 * Share one in-process engine per durable ledger so host and model-facing Cordis
 * scopes never cache competing snapshots of the same task file.
 */
export function acquireProactivityEngine(ledgerPath: string): ProactivityEngineLease {
  const key = ledgerPath.trim()
  if (key.length === 0) throw new Error('task ledger path must be a non-empty string')

  let entry = shared.get(key)
  if (entry === undefined) {
    const executor = new DelegatingProactivityExecutor()
    const store = key === ':memory:' ? new MemoryProactivityStore() : new JsonProactivityStore(key)
    entry = { executor, engine: new ProactivityEngine(store, executor), refs: 0 }
    shared.set(key, entry)
  }
  entry.refs += 1

  const owner = Symbol('proactivity-engine-lease')
  let released = false
  return {
    engine: entry.engine,
    bindExecutor(executor) {
      if (released) throw new Error('proactivity engine lease is already released')
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
