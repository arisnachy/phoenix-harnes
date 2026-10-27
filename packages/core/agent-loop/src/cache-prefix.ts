/**
 * Measure identical leading system-prompt text without retaining model-visible
 * content. OpenAI may reuse this prefix, but only provider-reported cache reads
 * confirm a cache hit. This observer never creates or claims a provider cache.
 */
import { createHash } from 'node:crypto'

interface SegmentSignature {
  readonly hash: string
  readonly end: number
}

/** Bounded in-memory record of the latest rendered prompt per model route. */
export class SystemPrefixObserver {
  private readonly previous = new Map<string, readonly SegmentSignature[]>()
  constructor(private readonly maxRoutes = 16) {}

  /**
   * Compare one system prompt to the preceding prompt sent to the same route.
   * @param provider - Provider route, without credentials.
   * @param model - Model identifier.
   * @param system - Rendered system instruction text.
   * @returns Number of leading characters known to match the prior request.
   */
  observe(provider: string, model: string, system: string): number {
    const key = JSON.stringify([provider, model])
    const parts = system.split('\n\n')
    const signatures: SegmentSignature[] = []
    let end = 0
    for (const [index, part] of parts.entries()) {
      if (index > 0) end += 2
      end += part.length
      signatures.push({ hash: createHash('sha256').update(part).digest('hex'), end })
    }

    const prior = this.previous.get(key)
    let reused = 0
    if (prior !== undefined) {
      for (let i = 0; i < Math.min(prior.length, signatures.length); i++) {
        if (prior[i]?.hash !== signatures[i]?.hash) break
        reused = signatures[i]?.end ?? reused
      }
    }
    this.previous.delete(key)
    this.previous.set(key, signatures)
    if (this.previous.size > this.maxRoutes) {
      const oldest = this.previous.keys().next().value
      if (oldest !== undefined) this.previous.delete(oldest)
    }
    return reused
  }
}
