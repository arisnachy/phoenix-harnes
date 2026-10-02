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
      || typeof raw.taskId !== 'string' || raw.taskId.length === 0
      || (raw.kind !== 'result' && raw.kind !== 'failure' && raw.kind !== 'upcoming')
      || typeof raw.title !== 'string' || raw.title.trim().length === 0
      || (raw.detail !== undefined && typeof raw.detail !== 'string')
      || typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))
      || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return undefined
    rows.push({
      id: raw.id,
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
      && item.taskId === candidate.taskId
      && item.kind === candidate.kind
      && item.title === candidate.title
      && item.detail === candidate.detail
      && item.at === candidate.at
      && item.score === candidate.score
  })
}

const ATTENTION_ACK_STORAGE_KEY = 'phoenix.proactivity.attention.ack.v1'
const ATTENTION_ACK_MAX = 256

function attentionStorage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
  } catch {
    return undefined
  }
}

/**
 * Read durable acknowledgement ids for Hero attention rows.
 * A row id includes its occurrence timestamp, so acknowledging one result never
 * hides a later result from the same recurring task.
 * @returns A detached set of reviewed attention-row ids.
 */
export function acknowledgedProactivityAttentionIds(): ReadonlySet<string> {
  const storage = attentionStorage()
  if (storage === undefined) return new Set()
  try {
    const parsed = JSON.parse(storage.getItem(ATTENTION_ACK_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))
  } catch {
    return new Set()
  }
}

/**
 * Persist one Hero attention row as reviewed without mutating the underlying task.
 * @param id - Stable occurrence-specific attention row id.
 */
export function acknowledgeProactivityAttention(id: string): void {
  const normalized = id.trim()
  if (normalized.length === 0) return
  const storage = attentionStorage()
  if (storage === undefined) return
  try {
    const current = [...acknowledgedProactivityAttentionIds()].filter(value => value !== normalized)
    storage.setItem(ATTENTION_ACK_STORAGE_KEY, JSON.stringify([normalized, ...current].slice(0, ATTENTION_ACK_MAX)))
  } catch {
    // Local acknowledgement is convenience chrome; quota/privacy failures must not affect chat.
  }
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
    const parsed = parseProactivityAttention(response.value)
    if (parsed === undefined) return
    const acknowledged = acknowledgedProactivityAttentionIds()
    const next = parsed.filter(item => !acknowledged.has(item.id))
    if (sameAttention(store.getSnapshot(), next)) return
    store.set(next)
  } catch {
    // Hero attention is best-effort local chrome; reconnect/poll retries it without replacing healthy state.
  }
}
