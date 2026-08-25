/**
 * Pure deterministic Memory Genome normalization and retrieval helpers.
 * @module @arisnachy/phoenix-continuity/memory
 */

import type { PhoenixMemoryHit, PhoenixMemoryRecord, PhoenixRememberRequest } from './types.ts'

function terms(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(value => value.trim())
    .filter(value => value.length >= 2)
}

/**
 * Normalize one memory request without adding semantic content.
 * @param request - Caller-authored memory fields.
 * @returns trimmed topic/content and stable de-duplicated lowercase tags.
 */
export function normalizeMemoryRequest(request: PhoenixRememberRequest): PhoenixRememberRequest {
  const topic = request.topic.trim()
  const content = request.content.trim()
  if (topic.length === 0) throw new Error('PHOENIX memory topic must not be blank')
  if (content.length === 0) throw new Error('PHOENIX memory content must not be blank')
  const tags = [...new Set((request.tags ?? []).map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0))]
  return { topic, content, tags, source: request.source }
}

/**
 * Rank durable memories lexically without an LLM or embedding request.
 * @param memories - Candidate durable memory entries.
 * @param query - Non-blank retrieval query.
 * @param limit - Positive maximum result count.
 * @returns stable relevance ordering, then recency, then id.
 */
export function recallMemories(
  memories: readonly PhoenixMemoryRecord[],
  query: string,
  limit: number,
): PhoenixMemoryHit[] {
  const queryTerms = [...new Set(terms(query))]
  if (queryTerms.length === 0) return []
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('PHOENIX recall limit must be a positive safe integer')
  const hits: PhoenixMemoryHit[] = []
  for (const memory of memories) {
    const topic = memory.topic.toLowerCase()
    const contentTerms = new Set(terms(memory.content))
    const tags = new Set(memory.tags.map(tag => tag.toLowerCase()))
    let score = 0
    for (const term of queryTerms) {
      if (topic === term) score += 16
      else if (topic.includes(term)) score += 8
      if (tags.has(term)) score += 12
      if (contentTerms.has(term)) score += 2
    }
    if (score > 0) hits.push({ memory, score })
  }
  return hits
    .sort((left, right) => right.score - left.score
      || right.memory.updatedAt - left.memory.updatedAt
      || left.memory.id.localeCompare(right.memory.id))
    .slice(0, limit)
}
