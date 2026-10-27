/**
 * Privacy-safe local comparison of system-instruction prefixes.
 * Checkpoints include paragraph boundaries and fixed-size positions, so an
 * edit inside a long paragraph cannot erase an otherwise stable prefix.
 * Digests are process-local; neither prompt text nor fingerprints are saved.
 * Provider cache hits must still come from provider usage metadata.
 */
import { createHash } from 'node:crypto'

interface PrefixSignature {
  readonly hash: string
  readonly end: number
}

export interface PrefixObservation {
  readonly reusedChars: number
  /** False for the first request on a route (also after a Host restart/eviction). */
  readonly comparable: boolean
}

/** Bounded, in-memory fingerprints of the latest prompt per provider/model. */
export class SystemPrefixObserver {
  private readonly previous = new Map<string, readonly PrefixSignature[]>()
  constructor(private readonly maxRoutes = 16) {}

  /**
   * Backward-compatible numeric comparison. A zero here may mean no baseline;
   * use observeWithStatus for telemetry and never interpret it as a cache miss.
   */
  observe(provider: string, model: string, system: string): number {
    return this.observeWithStatus(provider, model, system).reusedChars
  }

  /** Lower bound of matching prefix characters with explicit baseline status. */
  observeWithStatus(provider: string, model: string, system: string): PrefixObservation {
    const key = JSON.stringify([provider, model])
    // Include exact paragraph boundaries for existing tests/diagnostics plus
    // absolute checkpoints to detect stable prefixes *within* long sections.
    const checkpoints = new Set<number>([system.length])
    for (let offset = 128; offset < system.length; offset += 128) checkpoints.add(offset)
    let paragraph = system.indexOf('\n\n')
    while (paragraph >= 0) {
      if (paragraph > 0) checkpoints.add(paragraph)
      paragraph = system.indexOf('\n\n', paragraph + 2)
    }

    const signatures: PrefixSignature[] = []
    const hash = createHash('sha256')
    let offset = 0
    for (const end of [...checkpoints].sort((a, b) => a - b)) {
      hash.update(system.slice(offset, end))
      signatures.push({ end, hash: hash.copy().digest('hex') })
      offset = end
    }

    const prior = this.previous.get(key)
    const previousHashes = new Map(prior?.map(item => [item.end, item.hash]) ?? [])
    let reusedChars = 0
    for (const signature of signatures) {
      if (previousHashes.get(signature.end) === signature.hash) {
        reusedChars = signature.end
      }
    }

    this.previous.delete(key)
    this.previous.set(key, signatures)
    if (this.previous.size > this.maxRoutes) {
      const oldest = this.previous.keys().next().value
      if (oldest !== undefined) this.previous.delete(oldest)
    }
    return { reusedChars, comparable: prior !== undefined }
  }
}

/** Track which fully rendered system section first changed on the same model route.
 * Section identifiers and SHA-256 signatures remain in process memory only.
 */
export class SystemSectionObserver {
  private readonly previous = new Map<string, readonly { name: string, hash: string }[]>()
  constructor(private readonly maxRoutes = 16) {}

  observe(
    provider: string,
    model: string,
    sections: readonly { readonly name: string, readonly text: string }[],
  ): string | undefined {
    const key = JSON.stringify([provider, model])
    const current = sections.map(section => ({
      name: section.name,
      hash: createHash('sha256').update(section.text).digest('hex'),
    }))
    const prior = this.previous.get(key)
    let firstChanged: string | undefined
    if (prior !== undefined) {
      for (let i = 0; i < Math.max(prior.length, current.length); i++) {
        if (prior[i]?.name !== current[i]?.name || prior[i]?.hash !== current[i]?.hash) {
          firstChanged = current[i]?.name ?? prior[i]?.name
          break
        }
      }
    }
    this.previous.delete(key)
    this.previous.set(key, current)
    if (this.previous.size > this.maxRoutes) {
      const oldest = this.previous.keys().next().value
      if (oldest !== undefined) this.previous.delete(oldest)
    }
    return firstChanged
  }
}
