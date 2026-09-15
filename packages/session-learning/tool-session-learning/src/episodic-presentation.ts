/** Human-safe model context for directed autobiographical and learning recall. */

import type { CognitiveMemoryHit } from '@phoenix-ai/dsh-session-learning'
import type { ResolvedMemoryIntent } from './memory-intent.ts'
import { decodeMissionEpisode, isMissionEpisodeSubject } from './episodic.ts'

const MAX_DIRECTED_RECORDS = 12
const PROFILE_PREFIXES = ['user.identity.', 'user.profile.', 'user.preference.'] as const

/**
 * Render only the evidence needed to answer an explicit history or memory request.
 * Internal storage ids, event names, source URIs, confidence labels, and layer
 * names stay out of the model-facing payload so Phoenix can answer naturally.
 * @param intent - Directed retrieval policy inferred from the current user request.
 * @param hits - Ranked cognitive records selected by the memory service.
 * @returns Bounded model context, or an empty string when no relevant evidence exists.
 */
export function formatDirectedMemoryContext(
  intent: ResolvedMemoryIntent,
  hits: readonly CognitiveMemoryHit[],
): string {
  if (intent.kind === 'ordinary') return ''

  const eligible = hits.filter(hit => !intent.excludeProfileSubjects || !isProfileSubject(hit.record.subject))
  const evidence: object[] = []

  if (intent.kind === 'work-history' || intent.kind === 'backward-task') {
    evidence.push(...workEvidence(eligible))
  } else {
    for (const hit of eligible) {
      if (evidence.length >= MAX_DIRECTED_RECORDS) break

      if (intent.kind === 'learning-history') {
        if (!['lesson', 'skill'].includes(hit.record.kind)) continue
        evidence.push({
          type: 'learning',
          occurred_at: hit.record.provenance.occurredAt,
          project: hit.record.projectId,
          summary: safeText(hit.record.summary),
        })
        continue
      }

      if (intent.kind === 'diagnostic-history') {
        if (!['mission', 'lesson', 'error', 'success'].includes(hit.record.kind)) continue
        const episode = decodeMissionEpisode(hit.record.value)
        evidence.push({
          type: 'diagnostic',
          occurred_at: episode?.endedAt ?? hit.record.provenance.occurredAt,
          project: episode?.projectId ?? hit.record.projectId,
          summary: safeText(episode === undefined
            ? hit.record.summary
            : `${episode.userIntent}${episode.outcome === '' ? '' : ` — ${episode.outcome}`}`),
        })
        continue
      }

      if (intent.kind === 'profile-memory' && isProfileSubject(hit.record.subject)) {
        evidence.push({
          type: 'profile',
          occurred_at: hit.record.provenance.occurredAt,
          summary: safeText(hit.record.summary),
        })
      }
    }
  }

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
  const episodes: object[] = []
  for (const hit of hits) {
    if (episodes.length >= MAX_DIRECTED_RECORDS) break
    if (hit.record.kind !== 'mission' || !isMissionEpisodeSubject(hit.record.subject)) continue
    const episode = decodeMissionEpisode(hit.record.value)
    if (episode === undefined) continue
    episodes.push({
      type: 'work',
      occurred_at: episode.endedAt,
      project: episode.projectId,
      task: safeText(episode.userIntent),
      outcome: safeText(episode.outcome),
      verified: episode.verification === 'verified',
    })
  }
  if (episodes.length > 0) return episodes

  const fallback: object[] = []
  for (const hit of hits) {
    if (fallback.length >= MAX_DIRECTED_RECORDS) break
    if (hit.record.kind !== 'conversation' || hit.record.provenance.sourceEventType !== 'user/message') continue
    const task = stripEventPrefix(hit.record.summary)
    if (task.length < 8) continue
    fallback.push({
      type: 'prior-work-evidence',
      occurred_at: hit.record.provenance.occurredAt,
      project: hit.record.projectId,
      task: safeText(task),
    })
  }
  return fallback
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
