/**
 * Opt-in PHOENIX Nexus dispatch. The synthetic menu route is never sent to a
 * model API: the Agent request waterfall resolves it to a real provider/model
 * before LLM preparation and durable assistant provenance are created.
 * @module @phoenix-ai/dsh-llm-pi-ai/nexus-runtime
 */
import type { Context } from '@phoenix-ai/cordis'
import { LlmAdapter, LlmError } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk, LlmCallConfig } from '@phoenix-ai/dsh-llm'
import type {} from '@phoenix-ai/dsh-agent'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import {
  NexusQuotaGovernor, chooseNexusRoute, openRouterPriceEvidence,
  type NexusModel, type NexusPriceEvidence, type NexusRoute,
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
  readonly primaryUsedPercent?: number
  readonly secondaryUsedPercent?: number
  readonly resetPrimaryAt?: number
  readonly resetSecondaryAt?: number
}

/** Whether a subscription call stays within the configured reserve. */
export function nexusCodexHasReserve(quota: NexusCodexQuota | undefined): boolean {
  return (quota?.primaryUsedPercent ?? 0) < 95 && (quota?.secondaryUsedPercent ?? 0) < 90
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
    || /\b(?:implement|refactor|debug|repair|analy[sz]e|develop|deploy|execute|diagnos|clinical|medical|legal|security|research|audit|architecture|build|program|code|script|arregl\p{L}*|desarroll\p{L}*|implement\p{L}*|repar\p{L}*|diagnostic\p{L}*|investig\p{L}*|analiz\p{L}*|c[oó]digo|aplicaci[oó]n|sistema|seguridad)\b/iu.test(text)
}

/** Last authored user text in the current turn; tool and system notices are excluded. */
function lastHumanText(events: readonly { readonly type: string; readonly data: unknown }[], turn: number): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) continue
    const data = event.data as {
      turn?: unknown
      message?: { source?: { kind?: string }; content?: readonly { type?: string; text?: unknown }[] }
    }
    if (data.turn !== turn || data.message?.source?.kind === 'plugin') continue
    return data.message?.content?.filter(part => part.type === 'text'
      && typeof part.text === 'string').map(part => String(part.text)).join(' ') ?? ''
  }
  return ''
}

/** Refuse image-unsupported routes when current-turn messages contain images. */
function containsHumanImage(events: readonly { readonly type: string; readonly data: unknown }[], turn: number): boolean {
  return events.some(event => {
    if (event.type !== 'user/message' || typeof event.data !== 'object' || event.data === null) return false
    const data = event.data as { turn?: unknown; message?: { content?: readonly { type?: string }[] } }
    return data.turn === turn && data.message?.content?.some(part => part.type === 'image') === true
  })
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
        this.tools = new Set(Array.isArray(entries) ? entries.flatMap(entry => {
          if (typeof entry !== 'object' || entry === null) return []
          const row = entry as { id?: unknown; supported_parameters?: unknown }
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

interface NexusAgentRouteState {
  readonly turn: number
  excluded: Set<string>
  routed?: NexusRoute
  failovers: number
}

/** Runtime collaborators are supplied from the existing authorized Host. */
export interface NexusRuntimeOptions {
  readonly profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  readonly nativeCodexAuthorized: () => Promise<boolean>
}

/**
 * Install the opt-in Nexus selector, real-route dispatch and bounded failover.
 * @param ctx - Host context with existing LLM/auth/Agent capabilities.
 * @param options - Configured provider truth and native Codex token authority.
 */
export function installNexusRuntime(ctx: Context, options: NexusRuntimeOptions): void {
  const governor = new NexusQuotaGovernor()
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
    if (now < quotaReadAt + 60_000) return quotaCache
    quotaReadAt = now
    const auth = ctx.get('authorization')
    if (auth === undefined) return quotaCache
    const codex = auth.list().find(entry => String(entry.key).includes('openai-codex'))
    if (codex === undefined) return quotaCache
    try {
      const timeout = AbortSignal.timeout(2_000)
      const inspection = await auth.inspect(codex.key, AbortSignal.any([signal, timeout]))
      if (inspection?.kind !== 'account') return quotaCache
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
      // The previous provider snapshot is a hint, never a fabricated balance.
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
      const batches = await Promise.all(providers.map(async provider => {
        let advertised: readonly LlmModelInfo[]
        try { advertised = await ctx.llm.listModels(provider.id) } catch { return [] }
        return advertised.map(model => {
          const key = routeKey(provider.id, model.id)
          const evidence = provider.id === 'openrouter' ? prices.get(model.id)
            : provider.id === 'opencode-free'
              ? { source: 'operator-confirmed' as const, observedAt: now,
                expiresAt: now + 60_000, inputPerMillion: 0,
                outputPerMillion: 0, allChargesVerified: true } : undefined
          return {
            provider: provider.id,
            id: model.id,
            label: model.name,
            configured: true,
            authorized: true,
            online: (blockedUntil.get(key) ?? 0) <= now,
            local: false,
            supportsImages: model.inputModalities?.includes('image') === true,
            supportsTools: provider.id === 'openrouter' && prices.supportsTools(model.id),
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

  ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
    const selected = await next()
    if (selected.provider !== NEXUS_PROVIDER || selected.model !== NEXUS_MODEL) return selected
    payload.signal.throwIfAborted()
    const now = Date.now()
    const agent = payload.agent
    const previous = perAgent.get(agent)
    const state = previous?.turn === payload.turn ? previous : {
      turn: payload.turn, excluded: new Set<string>(), failovers: 0,
    }
    perAgent.set(agent, state)
    if (state.routed !== undefined) {
      const { serviceTier: _tier, reasoningEffort: _effort, ...base } = selected
      return { ...base, provider: state.routed.provider, model: state.routed.model }
    }
    const text = lastHumanText(agent.session.events, payload.turn)
    const complex = text.length === 0 || nexusRequiresStrongModel(text)
    const hasImage = containsHumanImage(agent.session.events, payload.turn)
    const models = (await listAuthorizedModels(now)).filter(model =>
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
    let route = free
    if (complex || free === undefined) {
      // A native ChatGPT/Codex seat is a user-existing subscription, not a new
      // API-key billing route. It remains bounded by the reported quota.
      const quota = await getQuota(now, payload.signal)
      const ids = models.filter(model => model.provider === 'openai-codex'
        && !state.excluded.has(routeKey(model.provider, model.id))).map(model => model.id)
      const candidate = nexusCodexFallback(ids, complex)
      if (candidate !== undefined && nexusCodexHasReserve(quota)
        && await options.nativeCodexAuthorized()) {
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
    state.routed = route
    const { serviceTier: _tier, reasoningEffort: _effort, ...base } = selected
    return { ...base, provider: route.provider, model: route.model }
  })

  // Retry is permitted only before the failed model request has yielded tools;
  // the Agent loop's own request-error seam retries the same step from its
  // durable context, not side-effecting tool calls.
  ctx.on('agent/request-error', async (payload, next) => {
    const state = perAgent.get(payload.agent)
    const active = state?.turn === payload.turn ? state : undefined
    if (active?.routed === undefined || active.routed.provider !== payload.provider
      || active.failovers >= 2
      || !['RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'SERVER', 'AUTH', 'MODEL_NOT_FOUND'].includes(payload.failure.code)) {
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
    return (async function* (): AsyncIterable<StreamChunk> {
      for await (const chunk of upstream) {
        if (chunk.type === 'usage') {
          governor.record({
            provider: request.provider, model: request.model,
            timestamp: Date.now(),
            inputTokens: chunk.usage.inputTokens + (chunk.usage.cacheReadTokens ?? 0)
              + (chunk.usage.cacheWriteTokens ?? 0),
            outputTokens: chunk.usage.outputTokens,
          })
        }
        yield chunk
      }
    })()
  })
}
