/** Resident consolidation of the canonical learning ledger.
 * Derived snapshots contain only counts; no model calls or extra memory store. */
import type { CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import { decodeExperienceAggregate } from './experience.ts'
import { reviewCognition } from './cognitive-review.ts'

const LIMIT = 256
type Review = ReturnType<typeof reviewCognition>

/** Consolidate current active evidence for one owning conversation. */
export function consolidateScope(records: readonly CognitiveMemoryRecord[], owner: string, projectId: string | undefined, now: number) {
  const active = records.filter(record => record.sessionId === owner && record.projectId === projectId
    && record.status === 'active' && (record.validUntil === undefined || record.validUntil > now))
    .sort((a, b) => b.lastObservedAt - a.lastObservedAt).slice(0, LIMIT)
  const seen = new Set<string>()
  const reviews: Review[] = []
  for (const record of active) {
    const experience = decodeExperienceAggregate(record)
    if (experience === undefined || experience.projectId !== projectId || seen.has(experience.key)) continue
    seen.add(experience.key)
    reviews.push(reviewCognition(experience))
  }
  const count = (action: Review['agency']['next']) => reviews.filter(review => review.agency.next === action).length
  const pending = active.filter(record => record.kind === 'pending' || record.kind === 'mission').length
  return {
    schema: 'phoenix.cognition.consolidation.v1', observedAt: now, sampledRecords: active.length,
    autobiographical: active.filter(record => record.layers.includes('autobiographical')).length,
    prospective: pending, technicalEpisodes: reviews.length,
    qualityVerified: reviews.reduce((sum, review) => sum + review.evidence.verified, 0),
    reusable: count('reuse'), diagnose: count('diagnose'), verify: count('verify'), compare: count('compare'),
    curiosity: count('diagnose') > 0 ? 'investigate-recurring-friction' : pending > 0 ? 'review-existing-missions' : count('compare') > 0 ? 'compare-verified-alternatives' : 'no-evidence-backed-opportunity',
    source: 'canonical-active-memory', autonomousExternalActions: false,
  } as const
}

/** Maintains a bounded resident projection; each read rechecks canonical active memory
 * so forgotten or superseded records cannot survive in model-facing output. */
export class ResidentConsolidation {
  private readonly scopes = new Map<string, { owner: string; projectId: string | undefined }>()
  private readonly snapshots = new Map<string, ReturnType<typeof consolidateScope>>()
  private completedCycles = 0

  constructor(private readonly read: () => readonly CognitiveMemoryRecord[]) {}

  observe(owner: string, projectId: string | undefined): void {
    const key = JSON.stringify([owner, projectId ?? null])
    this.scopes.delete(key)
    this.scopes.set(key, { owner, projectId })
    if (this.scopes.size > 32) {
      const oldest = this.scopes.keys().next().value
      if (oldest !== undefined) { this.scopes.delete(oldest); this.snapshots.delete(oldest) }
    }
  }

  /** One cheap local cycle; no network, tool execution or model inference. */
  cycle(now = Date.now()): void {
    if (this.scopes.size === 0) return
    const records = this.read()
    for (const [key, scope] of this.scopes) {
      this.snapshots.set(key, consolidateScope(records, scope.owner, scope.projectId, now))
    }
    this.completedCycles += 1
  }

  /** Expose scoped fresh evidence and whether a resident cycle actually ran. */
  inspect(owner: string, projectId: string | undefined, now = Date.now()) {
    const key = JSON.stringify([owner, projectId ?? null])
    const lastCycleAt = this.snapshots.get(key)?.observedAt ?? null
    return { ...consolidateScope(this.read(), owner, projectId, now), lastCycleAt, completedCycles: this.completedCycles }
  }

  clear(): void { this.scopes.clear(); this.snapshots.clear(); this.completedCycles = 0 }
}

/** Adapt interaction to explicit current instructions; never infer private mental states. */
export function explicitInteractionSignals(text: string) {
  const source = text.slice(0, 2048).normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const correction = /^(?:eso (?:esta mal|es incorrecto)|corrijo\b|te dije que no\b|that is wrong\b|correction\b)/u.test(source.trim())
  const action = /^(?:termina|completa|arregla|corrige|implementa|dejalo|finish|complete|fix|implement)\b/u.test(source.trim())
  const feeling = /^(?:estoy (?:frustrado|frustrada|molesto|molesta)|i am (?:frustrated|upset))\b/u.test(source.trim())
  return { correction, action, explicitFrustration: feeling, inferredEmotion: false } as const
}

export function interactionGuidance(text: string): string {
  const signals = explicitInteractionSignals(text)
  return [
    signals.correction ? 'The current user explicitly corrects a prior result. Recheck the concrete result before reusing it.' : '',
    signals.action ? 'The current user explicitly requests execution or completion. Prefer authorized concrete work over a proposal; report verified results and real blockers.' : '',
    signals.explicitFrustration ? 'The user explicitly expresses frustration. Acknowledge briefly and focus on resolving the issue; do not infer additional emotions.' : '',
  ].filter(Boolean).join(' ')
}
