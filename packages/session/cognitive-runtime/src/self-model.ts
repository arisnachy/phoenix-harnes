/** Evidence-based, read-only operational introspection for one PHOENIX session. */
import type { AttentionCandidate, CognitiveState } from './types.ts'

export type SelfEvidenceCategory = 'focus' | 'identity' | 'goal' | 'pending' | 'error' | 'learning'

export interface SelfEvidence {
  readonly category: SelfEvidenceCategory
  readonly summary: string
  readonly sourceUri: string
  readonly eventSeq: number
  readonly confidence: number
  readonly attentionScore: number
}

/**
 * This is an inspectable model of what the agent currently knows about its
 * work, not an assertion of subjective consciousness or personhood.
 */
export interface OperationalSelfModel {
  readonly sessionId: CognitiveState['sessionId']
  readonly projectId?: string
  readonly observedSeq: number
  readonly candidateCount: number
  readonly suppressedCount: number
  readonly focus?: SelfEvidence
  readonly identity: readonly SelfEvidence[]
  readonly goals: readonly SelfEvidence[]
  readonly pending: readonly SelfEvidence[]
  readonly errors: readonly SelfEvidence[]
  readonly learning: readonly SelfEvidence[]
  readonly epistemicStatus: 'operational-model-only'
  readonly subjectiveExperience: 'undetermined'
}

/** Build one detached, strictly session-scoped self-observation without LLM calls. */
export function deriveOperationalSelfModel(
  state: CognitiveState,
  maxPerCategory = 4,
): OperationalSelfModel {
  if (!Number.isSafeInteger(maxPerCategory) || maxPerCategory < 1 || maxPerCategory > 16) {
    throw new TypeError('operational self-model maxPerCategory must be an integer between 1 and 16')
  }

  const candidates = [
    ...state.focus === undefined ? [] : [state.focus],
    ...state.active,
    ...state.background,
  ].filter(candidate =>
    candidate.record.status === 'active'
    && candidate.record.sessionId === String(state.sessionId)
    && candidate.record.provenance.sessionId === String(state.sessionId))

  const pick = (category: SelfEvidenceCategory, predicate: (candidate: AttentionCandidate) => boolean): SelfEvidence[] => {
    const ids = new Set<string>()
    const selected: SelfEvidence[] = []
    for (const candidate of candidates) {
      if (!predicate(candidate) || ids.has(String(candidate.record.id))) continue
      ids.add(String(candidate.record.id))
      selected.push(toEvidence(candidate, category))
      if (selected.length === maxPerCategory) break
    }
    return selected
  }

  const focusCandidate = state.focus !== undefined && candidates.includes(state.focus)
    ? state.focus
    : undefined
  return {
    sessionId: state.sessionId,
    ...state.projectId === undefined ? {} : { projectId: state.projectId },
    observedSeq: state.observedSeq,
    candidateCount: state.candidateCount,
    suppressedCount: state.suppressed.length,
    ...focusCandidate === undefined ? {} : { focus: toEvidence(focusCandidate, 'focus') },
    identity: pick('identity', candidate =>
      /^(?:assistant|phoenix)\.identity\./u.test(candidate.record.subject ?? '')),
    goals: pick('goal', candidate => candidate.record.kind === 'mission'),
    pending: pick('pending', candidate =>
      candidate.record.kind === 'pending' || candidate.record.layers.includes('prospective')),
    errors: pick('error', candidate => candidate.record.kind === 'error'),
    learning: pick('learning', candidate =>
      candidate.record.kind === 'lesson' || candidate.record.kind === 'success'),
    epistemicStatus: 'operational-model-only',
    subjectiveExperience: 'undetermined',
  }
}

function toEvidence(candidate: AttentionCandidate, category: SelfEvidenceCategory): SelfEvidence {
  return {
    category,
    summary: candidate.record.summary.slice(0, 512),
    sourceUri: candidate.record.provenance.sourceUri,
    eventSeq: candidate.record.eventSeq,
    confidence: candidate.record.confidence,
    attentionScore: candidate.score,
  }
}
