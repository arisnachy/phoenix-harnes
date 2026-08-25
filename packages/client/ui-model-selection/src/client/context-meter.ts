import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'

const OPENAI_CONTEXT_PROVIDERS = new Set(['openai', 'openai-codex'])

/** Exact provider routes whose OpenAI context occupancy is surfaced in the sidebar. */
export function isOpenAiContextProvider(provider: string | undefined): boolean {
  return provider !== undefined && OPENAI_CONTEXT_PROVIDERS.has(provider)
}

/**
 * Remaining next-request context as an integer percentage.
 * Undefined means the host has not supplied enough truthful data yet; callers
 * must show an unknown state instead of manufacturing a percentage.
 */
export function remainingContextPercent(
  pressure: ContextPressureProjection | undefined,
): number | undefined {
  const projected = pressure?.projectedTokens
  const capacity = pressure?.contextWindow
  if (projected === undefined || capacity === undefined || !Number.isFinite(projected)
    || !Number.isFinite(capacity) || capacity <= 0) return undefined
  const usedPercent = (projected / capacity) * 100
  return Math.max(0, Math.min(100, Math.round(100 - usedPercent)))
}
