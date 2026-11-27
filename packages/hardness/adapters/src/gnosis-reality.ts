import type { RealitySnapshot } from './reality-context.ts'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/.test(value) ? value : null
}
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

/** A minimised, read-only graph of authoritative Reality Context observations.
 * Never return account keys, local paths, device identifiers, coordinates, or raw payloads.
 */
export function projectGnosisReality(snapshot: RealitySnapshot, now = Date.now()) {
  const ai = snapshot.ai
  const expiry = timestamp(ai.expiresAt)
  const fresh = ai.stale === false && expiry !== null && Date.parse(expiry) > now
  const selected = record(ai.activeModel)
  const provider = identifier(selected.provider)
  const model = identifier(selected.model)
  const providers = array(ai.registeredProviders).slice(0, 40).flatMap(value => {
    const id = identifier(record(value).id)
    return id === null ? [] : [{ id, state: fresh ? 'registered-not-probed' : 'stale' }]
  })
  const quotas = array(ai.quotaBudget).slice(0, 16).flatMap(value => {
    const account = record(value)
    const providerId = identifier(account.provider)
    if (providerId === null) return []
    return [{ provider: providerId, windows: array(account.windows).slice(0, 2).map(value => {
      const window = record(value)
      const reset = timestamp(window.resetsAt)
      const observed = fresh && window.status === 'observed' && (reset === null || Date.parse(reset) > now)
      const remaining = number(window.remainingPercent)
      return {
        window: window.window === 'primaryLimit' || window.window === 'secondaryLimit' ? window.window : null,
        state: observed ? 'observed' : 'requires-refresh',
        remainingPercent: observed && remaining !== null && remaining <= 100 ? remaining : null,
        durationMinutes: number(window.durationMinutes),
        resetsAt: reset,
      }
    }) }]
  })
  const internet = record(snapshot.network.internetReachable)
  const internetExpiry = timestamp(internet.expiresAt)
  const internetFresh = internet.stale === false && internetExpiry !== null && Date.parse(internetExpiry) > now
  return {
    source: 'reality-context',
    observedAt: timestamp(ai.observedAt),
    telemetryFresh: fresh,
    nodes: {
      host: { os: identifier(snapshot.device.os), architecture: identifier(snapshot.device.architecture), logicalCores: number(snapshot.device.cpuLogicalCores), memoryTotalBytes: number(snapshot.device.memoryTotalBytes) },
      selectedModel: provider === null || model === null ? null : { provider, model, basis: 'selection-not-execution' },
      providers, quotas,
      internet: { state: internetFresh && typeof internet.value === 'boolean' ? internet.value ? 'reachable' : 'unreachable' : 'unknown', scope: 'existing-probe-target-only' },
    },
    relations: provider === null || model === null ? [] : [{ from: 'current-agent', type: 'selected-model', to: provider + '/' + model }],
    limitations: ['No quota inference from reset countdowns', 'No authorization or execution claims', 'No app or file inventory in this projection'],
  }
}
