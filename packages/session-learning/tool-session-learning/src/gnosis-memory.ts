import type { CognitiveMemoryHit } from '@phoenix-ai/dsh-session-learning'

/** Build a bounded relational view of active, explicitly scoped search results.
 * Relations are stored assertions, not independently verified facts.
 * The canonical ledger remains the authority for forgetting and supersession.
 */
export function projectGnosisMemory(hits: readonly CognitiveMemoryHit[], sessionId: string, now = Date.now()) {
  const eligible = hits.filter(({record}) => record.sessionId === sessionId && record.status === 'active'
    && (record.validUntil === undefined || record.validUntil > now)
    && (record.kind === 'lesson' || record.kind === 'skill' || record.kind === 'preference' || record.kind === 'decision' || record.kind === 'fact' || record.kind === 'error' || record.kind === 'success'))
    .slice(0, 8)
  const refs = new Set(eligible.map(({record}) => String(record.id)))
  const nodes = eligible.map(({record}) => {
    // Only technical entities are included; personal and file entities remain in canonical memory_search.
    const entities = record.entities.filter(entity => (entity.type === 'tool' || entity.type === 'model')
      && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/.test(entity.normalized)).slice(0, 8)
    const endpoints = new Set(entities.map(entity => entity.normalized))
    const known = (value: string) => refs.has(value) || endpoints.has(value)
    return {
      id: String(record.id), kind: record.kind,
      source: { eventSeq: record.eventSeq, occurredAt: record.provenance.occurredAt },
      confidence: record.confidence, basis: 'stored-memory-not-independent-proof',
      entities: entities.map(entity => ({ type: entity.type, id: entity.normalized })),
      relations: record.relations.filter(relation => known(relation.from) && known(relation.to)).slice(0, 12)
        .map(relation => ({ type: relation.type, from: relation.from, to: relation.to, evidence: 'stored-unverified-relation' })),
      storedRelationCount: record.relations.length,
    }
  })
  return { scope: 'owning-session-only', nodes, resultCount: nodes.length,
    note: 'Use memory_search or original session evidence for factual content. No hidden, forgotten, superseded, raw transcript or private entity values are exported.' }
}
