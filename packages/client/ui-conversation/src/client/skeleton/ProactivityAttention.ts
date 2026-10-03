import type { ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import type { ProactivityAttentionItem } from '../contract/slots.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate the loopback attention projection before it reaches React.
 * @param value - Untrusted RPC value.
 * @returns The bounded validated rows, or undefined when the payload is invalid.
 */
export function parseProactivityAttention(value: unknown): readonly ProactivityAttentionItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: ProactivityAttentionItem[] = []
  for (const raw of value.slice(0, 8)) {
    if (!isRecord(raw)
      || typeof raw.id !== 'string' || raw.id.length === 0
      || typeof raw.revision !== 'string' || raw.revision.length === 0
      || typeof raw.taskId !== 'string' || raw.taskId.length === 0
      || (raw.kind !== 'result' && raw.kind !== 'failure' && raw.kind !== 'upcoming')
      || typeof raw.title !== 'string' || raw.title.trim().length === 0
      || (raw.detail !== undefined && typeof raw.detail !== 'string')
      || typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))
      || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return undefined
    rows.push({
      id: raw.id,
      revision: raw.revision,
      taskId: raw.taskId,
      kind: raw.kind,
      title: raw.title.trim(),
      ...(raw.detail === undefined || raw.detail.trim().length === 0 ? {} : { detail: raw.detail.trim() }),
      at: new Date(raw.at).toISOString(),
      score: raw.score,
    })
  }
  return rows
}

function sameAttention(
  left: readonly ProactivityAttentionItem[],
  right: readonly ProactivityAttentionItem[],
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && item.id === candidate.id
      && item.revision === candidate.revision
      && item.taskId === candidate.taskId
      && item.kind === candidate.kind
      && item.title === candidate.title
      && item.detail === candidate.detail
      && item.at === candidate.at
      && item.score === candidate.score
  })
}

/**
 * Pull the local Host's ranked proactive attention rows without disturbing chat when unavailable.
 * @param connection - Current loopback client connection.
 * @param store - Browser snapshot store feeding the Hero.
 */
export async function refreshProactivityAttention(
  connection: ConnectionHandle | undefined,
  store: SnapshotStore<readonly ProactivityAttentionItem[]>,
): Promise<void> {
  if (connection?.rpc === undefined) return
  try {
    const response = await connection.rpc.call('/phoenix-tasks', 'attention', {})
    if (!response.ok) return
    const next = parseProactivityAttention(response.value)
    if (next === undefined || sameAttention(store.getSnapshot(), next)) return
    store.set(next)
  } catch {
    // Hero attention is best-effort local chrome; reconnect/poll retries it without replacing healthy state.
  }
}

/** Persist an acknowledgement before removing the selected row.
 * @param connection Current local host connection.
 * @param store Home-feed store.
 * @param item Exact material revision selected.
 * @param state User action on the revision.
 */
export async function recordProactivityAttention(
  connection: ConnectionHandle | undefined,
  store: SnapshotStore<readonly ProactivityAttentionItem[]>,
  item: ProactivityAttentionItem,
  state: 'handled' | 'dismissed',
): Promise<void> {
  if (connection?.rpc === undefined) return
  try {
    const response = await connection.rpc.call('/phoenix-tasks', 'attention-record', { itemId: item.id, revision: item.revision, state })
    if (response.ok) store.set(store.getSnapshot().filter(row => row.id !== item.id || row.revision !== item.revision))
  } catch {
    // A failed acknowledgement keeps the row available for retry.
  }
}
