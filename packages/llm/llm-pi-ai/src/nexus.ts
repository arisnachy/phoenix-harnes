/**
 * PHOENIX Nexus: provider-neutral, evidence-based model economics and routing.
 * No API call is made by this module; hosts supply their authorized catalog and
 * real usage observations. Unknown pricing is never interpreted as free.
 * @module @phoenix-ai/dsh-llm-pi-ai/nexus
 */

/** Whether a price is sufficiently evidenced for autonomous selection. */
export type NexusPriceClass = 'verified-free' | 'limited-free' | 'paid' | 'unknown'
/** Source of a price and its eligibility rules. */
export type NexusPriceSource = 'provider-api' | 'operator-confirmed' | 'catalog-unverified'
/** Provider-specific price evidence, in USD per million tokens. */
export interface NexusPriceEvidence {
  readonly source: NexusPriceSource
  readonly observedAt: number
  readonly expiresAt?: number
  readonly inputPerMillion?: number
  readonly outputPerMillion?: number
  readonly freeAllowance?: boolean
  readonly allowanceRemaining?: number
  readonly allowanceUnit?: 'tokens' | 'requests' | 'credits'
  readonly accountEligible?: boolean
}

/** Complete observed identity; model names are not evidence of prices. */
export interface NexusModel {
  readonly provider: string
  readonly id: string
  readonly label?: string
  readonly configured: boolean
  readonly authorized: boolean
  readonly online: boolean
  readonly local?: boolean
  readonly supportsTools?: boolean
  readonly supportsImages?: boolean
  readonly contextWindow?: number
  readonly thinkingLevels?: readonly string[]
  readonly price?: NexusPriceEvidence
  readonly observedLatencyMs?: number
  readonly observedQuality?: number
  readonly observations?: number
  readonly errorRate?: number
  readonly modelReportedByProvider?: string
}

/** Price evaluation keeps facts, evidence age, and account eligibility separate. */
export function nexusPriceClass(model: Pick<NexusModel, 'price'>, now: number): NexusPriceClass {
  const price = model.price
  if (price === undefined || price.source === 'catalog-unverified'
    || price.observedAt > now || (price.expiresAt !== undefined && price.expiresAt <= now)) return 'unknown'
  if (price.accountEligible === false) return 'unknown'
  const input = price.inputPerMillion
  const output = price.outputPerMillion
  const ratesKnown = input !== undefined && output !== undefined
    && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0
  if (price.freeAllowance === true && price.accountEligible === true
    && price.allowanceRemaining !== undefined && price.allowanceRemaining > 0
    && Number.isFinite(price.allowanceRemaining)) return 'limited-free'
  if (!ratesKnown) return 'unknown'
  return input === 0 && output === 0 ? 'verified-free' : 'paid'
}

/** One measured consumption event, not a guessed token balance. */
export interface NexusUsage {
  readonly provider: string
  readonly model: string
  readonly timestamp: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requests?: number
}
/** A provider/account quota window. Limits can be absent when the API hides them. */
export interface NexusQuotaWindow {
  readonly provider: string
  readonly name: string
  readonly windowMs: number
  readonly limit?: number
  readonly unit: 'tokens' | 'requests'
  readonly anchorAt: number
  readonly source: 'provider-api' | 'user-configured' | 'estimated'
}
/** Forecasts never pretend an unreported limit is an exact balance. */
export interface NexusQuotaForecast {
  readonly name: string
  readonly limit?: number
  readonly observedSpent: number
  readonly remaining?: number
  readonly resetAt: number
  readonly projectedDailyUsage: number
  readonly source: NexusQuotaWindow['source']
  readonly exactBalance: boolean
}

function measuredUnits(event: NexusUsage, unit: NexusQuotaWindow['unit']): number {
  return unit === 'tokens' ? event.inputTokens + event.outputTokens : (event.requests ?? 1)
}

/** In-memory governor over measured, nonnegative token/request usage. */
export class NexusQuotaGovernor {
  private readonly events: NexusUsage[] = []
  /** Add one real usage receipt; no negative balance corrections are inferred. */
  record(event: NexusUsage): void {
    if (!Number.isFinite(event.timestamp)
      || ![event.inputTokens, event.outputTokens, event.requests ?? 1].every(
        value => Number.isSafeInteger(value) && value >= 0,
      )) throw new Error('Nexus usage must have nonnegative integer counts')
    this.events.push({ ...event })
  }

  /** Forecast a rolling or anchored quota window from observed receipts. */
  forecast(window: NexusQuotaWindow, now: number): NexusQuotaForecast {
    if (!Number.isFinite(window.windowMs) || window.windowMs <= 0
      || !Number.isFinite(window.anchorAt)) throw new Error('Invalid Nexus quota window')
    const elapsed = Math.max(0, now - window.anchorAt)
    const resetAt = window.anchorAt + (Math.floor(elapsed / window.windowMs) + 1) * window.windowMs
    const startedAt = resetAt - window.windowMs
    const observedSpent = this.events.filter(event =>
      event.provider === window.provider && event.timestamp >= startedAt
      && event.timestamp <= now).reduce((sum, event) => sum + measuredUnits(event, window.unit), 0)
    const dailyStart = now - 86_400_000
    const daySpent = this.events.filter(event =>
      event.provider === window.provider && event.timestamp > dailyStart
      && event.timestamp <= now).reduce((sum, event) => sum + measuredUnits(event, window.unit), 0)
    const limit = window.limit !== undefined && Number.isFinite(window.limit) && window.limit >= 0
      ? window.limit : undefined
    return {
      name: window.name,
      ...(limit === undefined ? {} : { limit, remaining: Math.max(0, limit - observedSpent) }),
      observedSpent,
      resetAt,
      projectedDailyUsage: daySpent,
      source: window.source,
      // Even a provider-published limit is not an exact account balance unless
      // it reports all use outside Phoenix. It is only local receipt arithmetic.
      exactBalance: false,
    }
  }
}

/** Task constraints and permissions passed by the owner of the selection. */
export interface NexusTask {
  readonly needsTools?: boolean
  readonly needsImages?: boolean
  readonly inputTokens?: number
  readonly minimumQuality?: number
  readonly maximumLatencyMs?: number
  readonly allowedProviders?: readonly string[]
  readonly allowPaid?: boolean
  readonly allowLocal?: boolean
  readonly allowedThinkingLevels?: readonly string[]
}
/** Auditable selection with a stated price class and estimated input/output cost. */
export interface NexusRoute {
  readonly provider: string
  readonly model: string
  readonly priceClass: NexusPriceClass
  readonly estimatedUsd?: number
  readonly reason: string
}

function estimatedUsd(model: NexusModel, input: number, output: number): number | undefined {
  const price = model.price
  if (price === undefined || price.inputPerMillion === undefined || price.outputPerMillion === undefined) return undefined
  return (input * price.inputPerMillion + output * price.outputPerMillion) / 1_000_000
}

/** Strict fail-closed filtering before deterministic quality/cost/latency ranking. */
export function chooseNexusRoute(
  models: readonly NexusModel[],
  task: NexusTask,
  now: number,
): NexusRoute | undefined {
  const requiredInput = Math.max(0, task.inputTokens ?? 0)
  const minimumQuality = task.minimumQuality ?? 0
  const list = models.flatMap(model => {
    if (!model.configured || !model.authorized || !model.online) return []
    if (model.local && task.allowLocal !== true) return []
    if (task.allowedProviders !== undefined && !task.allowedProviders.includes(model.provider)) return []
    if (task.needsTools && model.supportsTools !== true) return []
    if (task.needsImages && model.supportsImages !== true) return []
    if (model.contextWindow !== undefined && requiredInput > model.contextWindow) return []
    if (model.observedQuality !== undefined && model.observedQuality < minimumQuality) return []
    if (task.maximumLatencyMs !== undefined && model.observedLatencyMs !== undefined
      && model.observedLatencyMs > task.maximumLatencyMs) return []
    if (task.allowedThinkingLevels !== undefined
      && !task.allowedThinkingLevels.some(level => model.thinkingLevels?.includes(level))) return []
    const priceClass = nexusPriceClass(model, now)
    if (priceClass === 'unknown' || priceClass === 'paid') {
      if (task.allowPaid !== true) return []
    }
    const cost = priceClass === 'verified-free' || priceClass === 'limited-free'
      ? 0 : estimatedUsd(model, requiredInput, 2_048)
    if (cost === undefined && task.allowPaid !== true) return []
    // An unmeasured model is not assumed to be high quality. Sufficient quality
    // always wins before price optimizations that could degrade the answer.
    const quality = Math.max(0, Math.min(1, model.observedQuality ?? 0.5))
    const failure = Math.max(0, Math.min(1, model.errorRate ?? 0.2))
    const latency = Math.max(0, model.observedLatencyMs ?? 10_000)
    const ranking = quality * 100 - failure * 25 - Math.log1p(latency) - (cost ?? 10) * 10
    return [{ model, priceClass, cost, ranking }]
  })
  list.sort((a, b) => b.ranking - a.ranking
    || a.model.provider.localeCompare(b.model.provider)
    || a.model.id.localeCompare(b.model.id))
  const selected = list[0]
  if (selected === undefined) return undefined
  return {
    provider: selected.model.provider,
    model: selected.model.id,
    priceClass: selected.priceClass,
    ...(selected.cost === undefined ? {} : { estimatedUsd: selected.cost }),
    reason: 'authorized; capable; ranked on observed quality, failure rate, latency and expected cost',
  }
}

/** Bayesian-smoothed empirical score; unknown models stay conservative. */
export interface NexusCalibration {
  readonly attempts: number
  readonly accepted: number
  readonly totalLatencyMs: number
  readonly totalTokens: number
}
/** Record whether an output passed deterministic acceptance checks. */
export function updateNexusCalibration(
  prior: NexusCalibration | undefined,
  accepted: boolean,
  latencyMs: number,
  tokens: number,
): NexusCalibration {
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || !Number.isSafeInteger(tokens) || tokens < 0) {
    throw new Error('Invalid Nexus calibration receipt')
  }
  return {
    attempts: (prior?.attempts ?? 0) + 1,
    accepted: (prior?.accepted ?? 0) + Number(accepted),
    totalLatencyMs: (prior?.totalLatencyMs ?? 0) + latencyMs,
    totalTokens: (prior?.totalTokens ?? 0) + tokens,
  }
}
/** Prior-weighted success estimate; a single lucky run is not proof. */
export function nexusEstimatedQuality(calibration: NexusCalibration): number {
  return (calibration.accepted + 2) / (calibration.attempts + 4)
}

/** Flatten the actual authorized provider directory without inventing models. */
export function nexusInventory(groups: readonly {
  readonly id: string
  readonly name?: string
  readonly models: readonly { readonly id: string; readonly name?: string }[]
}[]): NexusModel[] {
  return groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    id: model.id,
    ...(model.name === undefined ? {} : { label: model.name }),
    configured: true,
    authorized: false,
    online: false,
    local: group.id === 'phoenix-local',
  })))
}
