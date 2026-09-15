/** Human-safe model context for directed autobiographical and learning recall. */

import type { CognitiveMemoryHit } from '@phoenix-ai/dsh-session-learning'
import type { ResolvedMemoryIntent } from './memory-intent.ts'
import { decodeMissionEpisode, isMissionEpisodeSubject } from './episodic.ts'

const MAX_DIRECTED_RECORDS = 12
const PROFILE_PREFIXES = ['user.identity.', 'user.profile.', 'user.preference.'] as const

/**
 * Render only the evidence needed to answer an explicit history/memory request.
 * Internal storage ids, event names, source URIs, confidence labels, and layer
 * names stay out of the model-facing payload so Phoenix can answer naturally.
 */
export function formatDirectedMemoryContext(
  intent: ResolvedMemoryIntent,
  hits: readonly CognitiveMemoryHit[],
): string {
  if (intent.kind === 'ordinary') return ''

  const eligible = hits.filter(hit => !intent.excludeProfileSubjects || !isProfileSubject(hit.record.subject))
  const evidence = intent.kind === 'work-history' || intent.kind === 'backward-task'
    ? workEvidence(eligible)
    : eligible.flatMap((hit) => {
      if (intent.kind === 'learning-history') {
        if (!['lesson', 'skill'].includes(hit.record.kind)) return []
        return [{
          type: 'learning' as const,
          occurred_at: hit.record.provenance.occurredAt,
          project: hit.record.projectId,
          summary: safeText(hit.record.summary),
        }]
      }

      if (intent.kind === 'diagnostic-history') {
        if (!['mission', 'lesson', 'error', 'success'].includes(hit.record.kind)) return []
        const episode = decodeMissionEpisode(hit.record.value)
        return [{
          type: 'diagnostic' as const,
          occurred_at: episode?.endedAt ?? hit.record.provenance.occurredAt,
          project: episode?.projectId ?? hit.record.projectId,
          summary: safeText(episode === undefined ? hit.record.summary : `${episode.userIntent}${episode.outcome === '' ? '' : ` — ${episode.outcome}`}`),
        }]
      }

      if (intent.kind === 'profile-memory') {
        if (!isProfileSubject(hit.record.subject)) return []
        return [{
          type: 'profile' as const,
          occurred_at: hit.record.provenance.occurredAt,
          summary: safeText(hit.record.summary),
        }]
      }

      return []
    }).slice(0, MAX_DIRECTED_RECORDS)

  if (evidence.length === 0) return ''

  return [
    '## Relevant prior evidence',
    'The user explicitly asked about prior work, learning, diagnostics, or profile memory.',
    'Answer directly and conversationally from the evidence below. Do not mention a memory system, ledger, retrieval step, ids, confidence scores, event names, layers, source URIs, or internal plumbing.',
    'Do not claim that nothing happened when evidence exists. If evidence is incomplete, say so naturally instead of inventing details.',
    '<phoenix-directed-memory>',
    JSON.stringify({ kind: intent.kind, evidence }),
    '</phoenix-directed-memory>',
  ].join('\n')
}

function workEvidence(hits: readonly CognitiveMemoryHit[]): readonly object[] {
  const episodes = hits.flatMap((hit) => {
    if (hit.record.kind !== 'mission' || !isMissionEpisodeSubject(hit.record.subject)) return []
    const episode = decodeMissionEpisode(hit.record.value)
    if (episode === undefined) return []
    return [{
      type: 'work' as const,
      occurred_at: episode.endedAt,
      project: episode.projectId,
      task: safeText(episode.userIntent),
      outcome: safeText(episode.outcome),
      verified: episode.verification === 'verified',
    }]
  }).slice(0, MAX_DIRECTED_RECORDS)
  if (episodes.length > 0) return episodes

  // Compatibility bridge: installations upgraded to Memory v2 can answer about
  // pre-v2 work immediately from already-durable user-message events. This is
  // intentionally bounded and only used when no structured mission exists.
  return hits.flatMap((hit) => {
    if (hit.record.kind !== 'conversation' || hit.record.provenance.sourceEventType !== 'user/message') return []
    const task = stripEventPrefix(hit.record.summary)
    if (task.length < 8) return []
    return [{
      type: 'prior-work-evidence' as const,
      occurred_at: hit.record.provenance.occurredAt,
      project: hit.record.projectId,
      task: safeText(task),
    }]
  }).slice(0, MAX_DIRECTED_RECORDS)
}

function stripEventPrefix(value: string): string {
  return value.replace(/^user\/message:\s*/iu, '').trim()
}

function isProfileSubject(subject: string | undefined): boolean {
  return subject !== undefined && PROFILE_PREFIXES.some(prefix => subject.startsWith(prefix))
}

function safeText(value: string): string {
  return value.replaceAll('{{', '{ {').replaceAll('}}', '} }').replace(/\s+/gu, ' ').trim().slice(0, 2_048)
}
