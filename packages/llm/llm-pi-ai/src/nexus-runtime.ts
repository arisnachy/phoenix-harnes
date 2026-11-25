/**
 * Opt-in PHOENIX Nexus dispatch. The synthetic menu route is never sent to a
 * model API: the Agent request waterfall resolves it to a real provider/model
 * before LLM preparation and durable assistant provenance are created.
 * @module @phoenix-ai/dsh-llm-pi-ai/nexus-runtime
 */
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { NexusReceiptStore } from './nexus-receipts.ts'
import type { Context } from '@phoenix-ai/cordis'
import { LlmAdapter, LlmError } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk, LlmCallConfig } from '@phoenix-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import {
  chooseNexusRoute, nexusPriceClass, openRouterPriceEvidence,
  type NexusModel, type NexusPriceEvidence, type NexusRoute, type NexusUsage,
} from './nexus.ts'

/** User-visible route, separate from the Codex-only Eclipse coordinator. */
export const NEXUS_PROVIDER = 'phoenix-nexus'
/** Stable synthetic selector id resolved before any provider request. */
export const NEXUS_MODEL = 'nexus-auto'
const CATALOG_AGE_MS = 300_000
const OPENROUTER_PRICE_URL = 'https://openrouter.ai/api/v1/models'
const FAILURE_COOLDOWN_MS = 180_000

/** A non-executable selector advertises Nexus without claiming model capabilities. */
export class NexusSelectorAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: 'PHOENIX Nexus' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: NEXUS_MODEL,
      name: 'PHOENIX Nexus', description: 'Inteligencia adaptativa · costo y calidad' }])
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new LlmError('Nexus must resolve a concrete provider/model before streaming', 'NEXUS_UNRESOLVED')
  }
}

/** Trusted account quota percentages, not fictional available token counts. */
export interface NexusCodexQuota {
  readonly primaryUsedPercent?: number | undefined
  readonly secondaryUsedPercent?: number | undefined
  readonly resetPrimaryAt?: number
  readonly resetSecondaryAt?: number
}

/** Whether a subscription call stays within the configured reserve. */
export function nexusCodexHasReserve(quota: NexusCodexQuota | undefined): boolean {
  if (quota === undefined) return false
  const primary = quota.primaryUsedPercent
  const secondary = quota.secondaryUsedPercent
  return primary !== undefined && Number.isFinite(primary) && primary >= 0 && primary < 95
    && secondary !== undefined && Number.isFinite(secondary) && secondary >= 0 && secondary < 90
}

const HOUR_MS = 3_600_000

function pacedWindow(used: number | undefined, reset: number | undefined, now: number, duration: number): boolean {
  if (used === undefined || reset === undefined || !Number.isFinite(reset)) return false
  // Account receipts can express UNIX timestamps in seconds or milliseconds.
  const resetMs = reset < 100_000_000_000 ? reset * 1_000 : reset
  const remainingMs = resetMs - now
  if (remainingMs <= 0 || remainingMs > duration) return false
  const elapsedFraction = 1 - remainingMs / duration
  // A small burst is permitted, without allowing an early window to be exhausted.
  const allowedPercent = Math.min(90, 10 + elapsedFraction * 85)
  return used < allowedPercent
}

/**
 * Admit ordinary subscription work only when both native windows have usable
 * reset timestamps and consumption is within a conservative elapsed-time budget.
 * Difficult work may use the separate hard reserve, never an unknown quota.
 */
export function nexusCodexWithinPace(quota: NexusCodexQuota | undefined, now: number): boolean {
  return quota !== undefined && nexusCodexHasReserve(quota)
    && pacedWindow(quota.primaryUsedPercent, quota.resetPrimaryAt, now, 5 * HOUR_MS)
    && pacedWindow(quota.secondaryUsedPercent, quota.resetSecondaryAt, now, 7 * 24 * HOUR_MS)
}

/** Select the latest real Codex model in one family, never inventing a model ID. */
export function nexusCodexFallback(ids: readonly string[], complex: boolean): string | undefined {
  const candidates = ids.filter(id => complex
    ? /^gpt-\d+(?:\.\d+)?-(?:astra|sol)(?:$|-)/iu.test(id)
    : /^gpt-\d+(?:\.\d+)?-luna(?:$|-)/iu.test(id))
  const collator = new Intl.Collator('en', { numeric: true })
  candidates.sort((left, right) => collator.compare(right, left))
  return candidates[0]
}

/** Decide whether accuracy/tools must take priority over an unbenchmarked free model. */
export function nexusRequiresStrongModel(text: string): boolean {
  return text.length > 380
    || /\b(?:implement|refactor|debug|repair|analy[sz]e|develop|deploy|execute|diagnos|clinical|medical|legal|security)\b/iu.test(text)
    || /\b(?:research|audit|architecture|build|program|code|script|arregl\p{L}*|desarroll\p{L}*|implement\p{L}*)\b/iu.test(text)
    || /\b(?:repar\p{L}*|diagnostic\p{L}*|investig\p{L}*|analiz\p{L}*|c[oó]digo|aplicaci[oó]n|sistema|seguridad)\b/iu.test(text)
}

type NexusSessionEvent = { readonly type: string, readonly data: unknown }
type NexusMessagePart = { readonly type?: string, readonly text?: unknown }

function humanTurnParts(events: readonly NexusSessionEvent[], turn: number): NexusMessagePart[] {
  const parts: NexusMessagePart[] = []
  let active = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (active) break
      active = (event.data as { turn?: number }).turn === turn
      continue
    }
    if (!active || event.type !== 'user/message') continue
    const message = event.data as {
      readonly source?: { readonly kind?: string }
      readonly content?: readonly NexusMessagePart[]
    }
    if (message.source?.kind === 'user' && message.content !== undefined) {
      parts.push(...message.content)
    }
  }
  return parts
}

/** Last genuine user text in a turn; durable UserMessage is the event data. */
export function nexusTurnText(events: readonly NexusSessionEvent[], turn: number): string {
  return humanTurnParts(events, turn).filter(part => part.type === 'text'
    && typeof part.text === 'string').map(part => String(part.text)).join(' ').trim()
}

/** Image detection examines actual author and this turn's message envelope. */
export function nexusTurnHasHumanImage(events: readonly NexusSessionEvent[], turn: number): boolean {
  return humanTurnParts(events, turn).some(part => part.type === 'image')
}

/** Restrict remote price probes to the provider's published public listing. */
export class NexusOpenRouterPrices {
  private latest = new Map<string, NexusPriceEvidence>()
  private tools = new Set<string>()
  private validUntil = 0
  private refreshing: Promise<void> | undefined

  /** Refresh at most once per TTL; unavailable evidence never becomes free. */
  async refresh(now: number): Promise<void> {
    if (now < this.validUntil) return
    if (this.refreshing !== undefined) return this.refreshing
    const run = async (): Promise<void> => {
      try {
        const response = await fetch(OPENROUTER_PRICE_URL, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(6_000),
        })
        if (!response.ok) throw new Error('OpenRouter price listing unavailable')
        const body = await response.text()
        if (body.length > 8_000_000) throw new Error('OpenRouter listing exceeded size limit')
        const payload: unknown = JSON.parse(body)
        this.latest = new Map(openRouterPriceEvidence(payload, now, CATALOG_AGE_MS))
        const entries = typeof payload === 'object' && payload !== null && 'data' in payload
          ? (payload as { data?: unknown }).data : undefined
        this.tools = new Set(Array.isArray(entries) ? entries.flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null) return []
          const row = entry as { id?: unknown, supported_parameters?: unknown }
          return typeof row.id === 'string' && Array.isArray(row.supported_parameters)
            && row.supported_parameters.includes('tools') ? [row.id] : []
        }) : [])
      } catch {
        // Fail closed on missing price data; never reuse an expired free claim.
        this.latest.clear()
        this.tools.clear()
      } finally {
        this.validUntil = now + CATALOG_AGE_MS
      }
    }
    const promise = run()
    this.refreshing = promise
    try { await promise } finally { this.refreshing = undefined }
  }
  /** Latest price evidence; expiration is checked by the core classifier. */
  get(id: string): NexusPriceEvidence | undefined { return this.latest.get(id) }
  /** True only when the official entry explicitly advertised function tools. */
  supportsTools(id: string): boolean { return this.tools.has(id) }
}

/** Narrow Agent events bridge avoids importing Agent source into the LLM package. */
interface NexusAgentEventBridge {
  on(event: 'agent/request', listener: (
    payload: { agent: NexusAgentHandle, turn: number, step: number, signal: AbortSignal },
    next: () => Promise<LlmCallConfig>,
  ) => Promise<LlmCallConfig>): void
  on(event: 'agent/request-error', listener: (
    payload: { agent: NexusAgentHandle, turn: number, step: number,
      provider: string, failure: { code: string }, signal: AbortSignal },
    next: () => Promise<{ kind: 'retry' } | undefined>,
  ) => Promise<{ kind: 'retry' } | undefined>): void
}
/** Only the authoritative session log is read; no mutable Agent internals. */
interface NexusAgentHandle {
  readonly session: { readonly id: string; readonly events: readonly { readonly type: string; readonly data: unknown }[] }
}

interface NexusAgentRouteState {
  readonly turn: number
  excluded: Set<string>
  routed?: NexusRoute | undefined
  failovers: number
}

/** Runtime collaborators are supplied from the existing authorized Host. */
export interface NexusRuntimeOptions {
  readonly profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  readonly nativeCodexAuthorized: () => Promise<boolean>
  readonly providerAuthorized: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<boolean>
}

/**
 * Install the opt-in Nexus selector, real-route dispatch and bounded failover.
 * @param ctx - Host context with existing LLM/auth/Agent capabilities.
 * @param options - Configured provider truth and native Codex token authority.
 */
export function installNexusRuntime(ctx: Context, options: NexusRuntimeOptions): void {
  const receipts = new NexusReceiptStore(dshHomePath('nexus-receipts-v1.json'))
  const activeSessions = new Map<string, string>()
  const prices = new NexusOpenRouterPrices()
  const perAgent = new WeakMap<object, NexusAgentRouteState>()
  const blockedUntil = new Map<string, number>()
  let quotaCache: NexusCodexQuota | undefined
  let quotaReadAt = 0
  let modelsCache: readonly NexusModel[] = []
  let catalogReadAt = 0
  let catalogInFlight: Promise<readonly NexusModel[]> | undefined
  const routeKey = (provider: string, model: string) => provider + '/' + model

  const getQuota = async (now: number, signal: AbortSignal): Promise<NexusCodexQuota | undefined> => {
    if (now < quotaReadAt + 60_000 && quotaCache !== undefined) return quotaCache
    quotaReadAt = now
    const auth = ctx.get('authorization')
    if (auth === undefined) { quotaCache = undefined; return undefined }
    const codex = auth.list().find(entry => String(entry.key).includes('openai-codex'))
    if (codex === undefined) { quotaCache = undefined; return undefined }
    try {
      const timeout = AbortSignal.timeout(2_000)
      const inspection = await auth.inspect(codex.key, AbortSignal.any([signal, timeout]))
      if (inspection?.kind !== 'account') { quotaCache = undefined; return undefined }
      const p = inspection.primaryLimit
      const s = inspection.secondaryLimit
      const valid = (v: number | undefined) => v !== undefined && Number.isFinite(v)
        && v >= 0 && v <= 100
      quotaCache = {
        ...(valid(p?.usedPercent) ? { primaryUsedPercent: p?.usedPercent } : {}),
        ...(valid(s?.usedPercent) ? { secondaryUsedPercent: s?.usedPercent } : {}),
        ...(p?.resetsAt === undefined ? {} : { resetPrimaryAt: p.resetsAt }),
        ...(s?.resetsAt === undefined ? {} : { resetSecondaryAt: s.resetsAt }),
      }
    } catch {
      // A failed refresh must not authorize additional subscription usage.
      quotaCache = undefined
    }
    return quotaCache
  }

  const listAuthorizedModels = async (now: number): Promise<readonly NexusModel[]> => {
    if (now < catalogReadAt + 60_000 && modelsCache.length > 0) return modelsCache
    if (catalogInFlight !== undefined) return catalogInFlight
    const read = async (): Promise<readonly NexusModel[]> => {
      const authorized = options.profiles()
      const providers = ctx.llm.listProviders().filter(entry =>
        entry.id !== NEXUS_PROVIDER && entry.id !== 'phoenix-local' && authorized.has(entry.id))
      await prices.refresh(now)
      const batches = await Promise.all(providers.map(async (provider) => {
        let advertised: readonly LlmModelInfo[]
        try { advertised = await ctx.llm.listModels(provider.id) } catch { return [] }
        const profile = authorized.get(provider.id)
        if (profile === undefined) return []
        const authenticated = await options.providerAuthorized(provider.id, profile).catch(() => false)
        const officialOpenRouter = provider.id === 'openrouter' && (profile.baseURL === undefined
          || profile.baseURL.replace(/\/+$/u, '') === 'https://openrouter.ai/api/v1')
        return advertised.map((model) => {
          const key = routeKey(provider.id, model.id)
          // Provider names are not price evidence; unverified catalogs stay unknown.
          const evidence = officialOpenRouter ? prices.get(model.id) : undefined
          return {
            provider: provider.id,
            id: model.id,
            label: model.name,
            configured: true,
            authorized: authenticated,
            online: (blockedUntil.get(key) ?? 0) <= now,
            local: false,
            supportsImages: model.inputModalities?.includes('image') === true,
            supportsTools: officialOpenRouter && prices.supportsTools(model.id),
            ...(evidence === undefined ? {} : { price: evidence }),
          } satisfies NexusModel
        })
      }))
      modelsCache = batches.flat()
      catalogReadAt = now
      return modelsCache
    }
    const promise = read()
    catalogInFlight = promise
    try { return await promise } finally { catalogInFlight = undefined }
  }

  ctx.llm.registerAdapter([NEXUS_PROVIDER], new NexusSelectorAdapter())

  const agentEvents = ctx as unknown as NexusAgentEventBridge
  agentEvents.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
    const selected = await next()
    if (selected.provider !== NEXUS_PROVIDER || selected.model !== NEXUS_MODEL) {
      activeSessions.delete(payload.agent.session.id)
      return selected
    }
    payload.signal.throwIfAborted()
    const now = Date.now()
    const agent = payload.agent
    const previous = perAgent.get(agent)
    const state = previous?.turn === payload.turn ? previous : {
      turn: payload.turn, excluded: new Set<string>(), failovers: 0,
    }
    perAgent.set(agent, state)
    if (state.routed !== undefined) {
      const route = state.routed
      const profile = options.profiles().get(route.provider)
      const authenticated = profile !== undefined
        && await options.providerAuthorized(route.provider, profile).catch(() => false)
      let eligible = authenticated
      if (route.provider === 'openai-codex') {
        const quota = await getQuota(now, payload.signal)
        eligible = eligible && nexusCodexHasReserve(quota)
      } else {
        const inventory = await listAuthorizedModels(now)
        const model = inventory.find(item => item.provider === route.provider && item.id === route.model)
        eligible = eligible && model !== undefined && nexusPriceClass(model, now) === 'verified-free'
          && route.provider === 'openrouter' && (profile?.baseURL === undefined
            || profile.baseURL.replace(/\/+$/u, '') === 'https://openrouter.ai/api/v1')
      }
      if (!eligible) {
        state.excluded.add(routeKey(route.provider, route.model))
        state.routed = undefined
      } else {
        const { serviceTier: _tier, reasoningEffort: _effort, ...base } = selected
        activeSessions.set(agent.session.id, routeKey(route.provider, route.model))
        return { ...base, provider: route.provider, model: route.model }
      }
    }
    const text = nexusTurnText(agent.session.events, payload.turn)
    const complex = text.length === 0 || nexusRequiresStrongModel(text)
    const hasImage = nexusTurnHasHumanImage(agent.session.events, payload.turn)
    const observations = await receipts.read(now).catch(() => [])
    const models = (await listAuthorizedModels(now)).map((model) => {
      const samples = observations.filter(r => r.provider === model.provider && r.model === model.id)
      if (samples.length === 0) return model
      const failures = samples.filter(r => !r.succeeded).length
      return { ...model, observations: samples.length,
        errorRate: (failures + 1) / (samples.length + 5),
        observedLatencyMs: samples.reduce((sum, r) => sum + r.latencyMs, 0) / samples.length }
    }).filter(model =>
      !state.excluded.has(routeKey(model.provider, model.id))
      && (blockedUntil.get(routeKey(model.provider, model.id)) ?? 0) <= now)
    const free = chooseNexusRoute(models, {
      needsTools: complex,
      needsImages: hasImage,
      inputTokens: 8_192,
      minimumQuality: 0,
      allowPaid: false,
      allowLocal: false,
    }, now)
    let route = complex ? undefined : free
    if (complex || free === undefined) {
      // A native ChatGPT/Codex seat is a user-existing subscription, not a new
      // API-key billing route. It remains bounded by the reported quota.
      const quota = await getQuota(now, payload.signal)
      const ids = models.filter(model => model.provider === 'openai-codex' && model.authorized
        && (!hasImage || model.supportsImages === true)
        && !state.excluded.has(routeKey(model.provider, model.id))).map(model => model.id)
      const candidate = nexusCodexFallback(ids, complex)
      const withinBudget = complex ? nexusCodexHasReserve(quota) : nexusCodexWithinPace(quota, now)
      if (candidate !== undefined && withinBudget && await options.nativeCodexAuthorized()) {
        route = { provider: 'openai-codex', model: candidate, priceClass: 'unknown',
          reason: 'existing authorized Codex subscription; model quality or tool requirements' }
      }
    }
    if (route === undefined) {
      throw new LlmError(
        'Nexus found no verified free model that meets this task, and no Codex subscription route with quota reserve. Choose a model manually or connect a supported free provider.',
        'NEXUS_NO_ELIGIBLE_ROUTE',
      )
    }
    const profile = options.profiles().get(route.provider)
    if (profile === undefined || !await options.providerAuthorized(route.provider, profile).catch(() => false)) {
      throw new LlmError('Nexus route authorization changed before dispatch', 'NEXUS_NO_ELIGIBLE_ROUTE')
    }
    state.routed = route
    if (activeSessions.size >= 512) {
      const oldest = activeSessions.keys().next().value
      if (oldest !== undefined) activeSessions.delete(oldest)
    }
    activeSessions.set(agent.session.id, routeKey(route.provider, route.model))
    const { serviceTier: _tier, reasoningEffort: _effort, ...base } = selected
    return { ...base, provider: route.provider, model: route.model }
  })

  // Retry is permitted only before the failed model request has yielded tools;
  // the Agent loop's own request-error seam retries the same step from its
  // durable context, not side-effecting tool calls.
  agentEvents.on('agent/request-error', async (payload, next) => {
    const state = perAgent.get(payload.agent)
    const active = state?.turn === payload.turn ? state : undefined
    if (active?.routed === undefined || active.routed.provider !== payload.provider
      || active.failovers >= 2
      || !['RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'SERVER', 'AUTH', 'MISSING_CREDENTIAL', 'MODEL_NOT_FOUND'].includes(payload.failure.code)) {
      return next()
    }
    const failed = routeKey(active.routed.provider, active.routed.model)
    active.excluded.add(failed)
    blockedUntil.set(failed, Date.now() + FAILURE_COOLDOWN_MS)
    active.routed = undefined
    active.failovers += 1
    return { kind: 'retry' as const }
  })

  ctx.on('llm/stream', (request, next) => {
    const upstream = next()
    if (request.sessionId === undefined || request.purpose !== undefined
      || activeSessions.get(request.sessionId) !== routeKey(request.provider, request.model)) return upstream
    return (async function* (): AsyncIterable<StreamChunk> {
      const started = Date.now()
      let usage: NexusUsage | undefined
      let succeeded = false
      let terminal = false
      try {
        for await (const chunk of upstream) {
          if (chunk.type === 'usage') {
            usage = {
              provider: request.provider, model: request.model, timestamp: Date.now(),
              inputTokens: chunk.usage.inputTokens + (chunk.usage.cacheReadTokens ?? 0)
                + (chunk.usage.cacheWriteTokens ?? 0),
              outputTokens: chunk.usage.outputTokens,
            }
          } else if (chunk.type === 'finish') {
            terminal = true
            succeeded = chunk.reason.kind === 'stop' || chunk.reason.kind === 'tool-calls'
          }
          yield chunk
        }
      } finally {
        if (terminal && request.signal?.aborted !== true) {
          await receipts.record({
            provider: request.provider, model: request.model, timestamp: Date.now(),
            inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
            latencyMs: Math.max(0, Date.now() - started), succeeded,
          }).catch(() => { ctx.logger.warn('Nexus receipt persistence failed; no balance was inferred') })
        }
      }
    })()
  })
}
