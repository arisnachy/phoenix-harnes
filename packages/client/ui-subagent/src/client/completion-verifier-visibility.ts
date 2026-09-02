import type {
  SessionId, SessionListState, SubagentCatalogSnapshot,
} from '@phoenix-ai/dsh-client-runtime/client'

type CatalogEntry = SubagentCatalogSnapshot['entries'][number]

/** Ephemeral completion workers should disappear after settling. */
const COMPLETION_VERIFIER_LABELS = new Set([
  'goal-adversarial-test-design',
  'goal-adversarial-tester',
  'goal-completion-judge',
])

/**
 * Keep ordinary subagent history, but retire settled completion workers from
 * the lineage surface. A new running verifier remains visible immediately.
 * @param entries - catalog entries visible under one parent session.
 * @returns entries suitable for the active-lineage surface.
 */
export function filterVisibleSubagentEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  return entries.filter(entry => entry.kind !== 'child'
    || entry.activity === 'running'
    || entry.label === undefined
    || !COMPLETION_VERIFIER_LABELS.has(entry.label))
}

/**
 * Produce the lineage-only session view. Hidden verifier ids are removed from
 * `byId` as well as catalog rows so descendant counters cannot retain stale
 * completed judges after the row itself disappears.
 * @param state - unmodified durable client session-list snapshot.
 * @returns a lineage-only view with settled completion workers removed.
 */
export function filterCompletionVerifierSessionState(state: SessionListState): SessionListState {
  const hidden = new Set<SessionId>()
  let changed = false
  const subagentsByParent = { ...state.subagentsByParent }

  for (const [rawParentId, catalog] of Object.entries(state.subagentsByParent)) {
    if (catalog === undefined) continue
    const entries = filterVisibleSubagentEntries(catalog.entries)
    if (entries.length === catalog.entries.length) continue
    changed = true
    const visibleIds = new Set(entries.filter(entry => entry.kind === 'child').map(entry => entry.id))
    for (const entry of catalog.entries) {
      if (entry.kind === 'child' && !visibleIds.has(entry.id)) hidden.add(entry.id)
    }
    subagentsByParent[rawParentId as SessionId] = { ...catalog, entries }
  }

  if (!changed) return state
  const byId = { ...state.byId }
  for (const id of hidden) delete byId[id]
  return { ...state, byId, subagentsByParent }
}