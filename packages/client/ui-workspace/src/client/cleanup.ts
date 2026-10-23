/**
 * Read-only preview of which Host-visible conversations a user selected.
 * Never deletes by itself. The UI commits exact identities with session.delete.
 */
import type { SessionId, SessionListState } from '@phoenix-ai/dsh-client-runtime/client'

export type SessionCleanupMode = 'selected' | 'before' | 'between' | 'all'

/** Local end-of-day boundary for a date input; invalid/empty dates select nothing. */
function dayLimit(value: string, endOfDay: boolean): number | undefined {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return undefined
  const parsed = new Date(value + (endOfDay ? 'T23:59:59.999' : 'T00:00:00'))
  if (!Number.isFinite(parsed.getTime())) return undefined
  if (parsed.getFullYear() !== Number(value.slice(0, 4))
    || parsed.getMonth() + 1 !== Number(value.slice(5, 7))
    || parsed.getDate() !== Number(value.slice(8, 10))) return undefined
  return parsed.getTime()
}

/** Preview exact session ids, including archived rows, without selecting unknown identities. */
export function cleanupCandidateIds(
  list: Pick<SessionListState, 'ids' | 'byId'>,
  mode: SessionCleanupMode,
  selected: readonly string[],
  before: string,
  after: string,
): SessionId[] {
  const end = dayLimit(before, true)
  const start = dayLimit(after, false)
  if (mode === 'before' && end === undefined) return []
  if (mode === 'between' && (end === undefined || start === undefined || start > end)) return []
  const selectedIds = new Set(selected)
  return list.ids.filter((id) => {
    const row = list.byId[id]
    if (row === undefined) return false
    if (mode === 'all') return true
    if (mode === 'selected') return selectedIds.has(id)
    if (mode === 'before') return row.updatedAt <= (end as number)
    return row.updatedAt >= (start as number) && row.updatedAt <= (end as number)
  })
}
