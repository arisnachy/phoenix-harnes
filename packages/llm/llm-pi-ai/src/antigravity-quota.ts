/** Official agy /usage JSON. Never extract credentials or infer unreported quotas. */
import type { AuthorizationAccountTelemetry } from '@phoenix-ai/dsh-authorization'

type Groups = NonNullable<AuthorizationAccountTelemetry['quotaGroups']>
type Execute = (args: readonly string[], input?: string, signal?: AbortSignal) => Promise<string>
const obj = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Native headless /usage was introduced in 1.1.11. Older CLI may run inference. */
export function supportsNativeQuota(version: string): boolean {
  const m = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/u)
  if (!m) return false
  const [major, minor, patch] = m.slice(1).map(Number)
  return major! > 1 || (major === 1 && (minor! > 1 || (minor === 1 && patch! >= 11)))
}

export function parseAntigravityQuota(raw: string, observedAt: number): Groups | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return undefined }
  const root = obj(parsed), command = obj(root?.command), data = obj(command?.data)
  if (root?.status !== 'SUCCESS' || root.num_turns !== 0 || command?.name !== 'usage'
    || obj(root.usage)?.total_tokens !== 0 || !Array.isArray(data?.groups)) return undefined
  const groups: Groups = []
  for (const entry of data.groups.slice(0, 32)) {
    const group = obj(entry)
    if (typeof group?.name !== 'string' || group.name.length > 128 || !Array.isArray(group.buckets)) continue
    const buckets: Groups[number]['buckets'] = []
    for (const item of group.buckets.slice(0, 32)) {
      const b = obj(item)
      if (typeof b?.id !== 'string' || !/^[a-z0-9_-]{1,100}$/iu.test(b.id)) continue
      const fraction = b.remaining_fraction
      const reset = typeof b.reset_time === 'string' ? Date.parse(b.reset_time) : NaN
      const window = typeof b.window === 'string' ? b.window.toLowerCase() : ''
      const durationMinutes = window === 'weekly' || /-weekly$/u.test(b.id) ? 10080
        : ['five_hour', 'five-hour', '5h', '5-hour'].includes(window) || /-5h$/u.test(b.id) ? 300 : undefined
      buckets.push({ id: b.id, observedAt,
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
        ...(typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? { remainingPercent: fraction * 100 } : {}),
        ...(Number.isFinite(reset) && reset > 0 ? { resetsAt: Math.floor(reset / 1000) } : {}),
        ...(b.disabled === true ? { disabled: true } : {}),
      })
    }
    if (buckets.length) groups.push({ name: group.name, buckets })
  }
  return groups.length ? groups : undefined
}

/** Coalesce concurrent reads. A cached sample keeps its original observation time. */
export function createAntigravityQuotaReader(execute: Execute) {
  let lastAttempt = -Infinity
  let last: Groups | undefined
  let pending: Promise<Groups | undefined> | undefined
  return async (signal?: AbortSignal): Promise<Groups | undefined> => {
    if (signal?.aborted) return undefined
    if (pending) return pending
    if (Date.now() - lastAttempt < 60_000) return last
    lastAttempt = Date.now()
    last = undefined
    const deadline = AbortSignal.timeout(12_000)
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    pending = (async () => {
      try {
        if (!supportsNativeQuota(await execute(['--version'], '', combined))) return undefined
        const result = await execute(['-p', '/usage', '--output-format', 'json'], '', combined)
        if (combined.aborted) return undefined
        last = parseAntigravityQuota(result, Date.now())
        return last
      } catch { return undefined }
    })()
    try { return await pending } finally { pending = undefined }
  }
}
