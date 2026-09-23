import {
  RealityContextEngine,
  type RealityContextConfig,
} from './reality-context.ts'

interface SharedRealityEntry {
  readonly engine: RealityContextEngine
  refs: number
}

const shared = new Map<string, SharedRealityEntry>()

function keyOf(config: RealityContextConfig): string {
  return JSON.stringify({
    refreshMs: config.refreshMs,
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    accuracyMeters: config.accuracyMeters ?? null,
    locationLabel: config.locationLabel ?? null,
    currency: config.currency ?? null,
  })
}

/**
 * Public reality context lease shape.
 */
export interface RealityContextLease {
  readonly engine: RealityContextEngine
  release(): void
}

/**
 * Execute acquire reality context.
 * @param config - The config value.
 * @returns The resulting value.
 */
export function acquireRealityContext(config: RealityContextConfig): RealityContextLease {
  const key = keyOf(config)
  let entry = shared.get(key)
  if (entry === undefined) {
    const engine = new RealityContextEngine(config)
    engine.start()
    entry = { engine, refs: 0 }
    shared.set(key, entry)
  }
  entry.refs += 1
  let released = false
  return {
    engine: entry.engine,
    release() {
      if (released) return
      released = true
      entry!.refs -= 1
      if (entry!.refs === 0) {
        entry!.engine.stop()
        shared.delete(key)
      }
    },
  }
}
