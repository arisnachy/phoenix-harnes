/** Task-aware automatic recall for Phoenix model context. */

import type {
  CognitiveMemoryHit,
  CognitiveMemoryQuery,
  MemoryRecord,
} from '@phoenix-ai/dsh-session-learning'

/** Minimal memory-service surface needed by automatic model recall. */
export interface AutomaticMemorySource {
  /** Read durable continuity memory for fallback context. */
  recall(limit?: number): MemoryRecord[]
  /** Read ranked cognitive memory scoped by the service to the current project. */
  recallCognitive(query?: Omit<CognitiveMemoryQuery, 'limit'> & { limit?: number }): CognitiveMemoryHit[]
  /** Current project isolation key, when known. */
  currentProjectId(): string | undefined
}

/** One record that can be projected into automatic model context. */
export type AutomaticMemoryRecord = MemoryRecord | CognitiveMemoryHit

const NON_ACTIONABLE_KINDS = new Set(['conversation', 'interaction'])

/**
 * Prefer cognitive memories relevant to the task currently being executed.
 * Fall back to durable continuity memory only when no useful task match exists.
 * This keeps old unrelated profile/context records from crowding out a verified
 * lesson that actually applies to the current request.
 *
 * @param source - Learning memory service or a compatible test seam.
 * @param taskContext - Current bounded user task when known.
 * @param limit - Maximum automatic context records.
 * @returns Task-relevant cognitive hits or durable fallback memories.
 */
export function selectAutomaticMemory(
  source: AutomaticMemorySource,
  taskContext: string | undefined,
  limit = 8,
): readonly AutomaticMemoryRecord[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('automatic memory limit must be a positive safe integer')
  const query = taskContext?.replace(/\s+/gu, ' ').trim()
  if (query !== undefined && query !== '') {
    const projectId = source.currentProjectId()
    const hits = source.recallCognitive({
      query,
      limit,
      layers: ['episodic', 'semantic', 'procedural', 'prospective', 'associative'],
      ...projectId === undefined ? {} : { projectId },
    })
    if (hits.some(hit => !NON_ACTIONABLE_KINDS.has(hit.record.kind))) return hits
  }
  return source.recall(limit)
}
