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
import type { NexusFreeRoutePolicy, ResolvedPiAiProviderProfile } from './config.ts'
import {
  chooseNexusRoute, nexusPriceClass, openRouterPriceEvidence, nexusEstimatedQuality,
  type NexusModel, type NexusPriceEvidence, type NexusRoute, type NexusUsage,
} from './nexus.ts'

/** User-visible route, separate from the Codex-only Eclipse coordinator. */
export const NEXUS_PROVIDER = 'phoenix-nexus'
/** Stable synthetic selector id resolved before any provider request. */
export const NEXUS_MODEL = 'nexus-auto'
/** Public ORIÓN alias for the legacy Nexus provider ID (not a second provider). */
export const ORION_PROVIDER = NEXUS_PROVIDER
/** Public ORIÓN alias for the legacy Nexus selector ID (not a second model). */
export const ORION_MODEL = NEXUS_MODEL
const CATALOG_AGE_MS = 300_000
const OPENROUTER_PRICE_URL = 'https://openrouter.ai/api/v1/models'
const FAILURE_COOLDOWN_MS = 180_000
const MAX_POLICY_AGE_MS = 7 * 86_400_000

/** A manual attestation is restricted to an exact explicit HTTPS endpoint and model. */
export function nexusOperatorPolicy(policies: readonly NexusFreeRoutePolicy[], provider: string, model: string,
  baseURL: string | undefined, now: number): NexusFreeRoutePolicy | undefined {
  if (baseURL === undefined || !Number.isFinite(now) || /^(?:phoenix-|ollama|openai-codex|openrouter|opencode-free)/iu.test(provider)) return undefined
  let endpoint: URL
  try { endpoint = new URL(baseURL) } catch { return undefined }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return undefined
  const matches = policies.filter(p => p.provider === provider && p.model === model)
  if (matches.length !== 1) return undefined
  const p = matches[0]!
  if (p.baseURL.replace(/\/+$/u, '') !== baseURL.replace(/\/+$/u, '')
    || p.allChargesZero !== true || p.noOverage !== true || p.supportsTools !== true
    || !Number.isSafeInteger(p.contextWindow) || p.contextWindow < 8_192
    || !Number.isSafeInteger(p.verifiedAt) || !Number.isSafeInteger(p.expiresAt)
    || p.verifiedAt > now || p.expiresAt <= now || p.expiresAt - p.verifiedAt > MAX_POLICY_AGE_MS) return undefined
  return p
}

/** A non-executable selector advertises Nexus without claiming model capabilities. */
export class NexusSelectorAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: 'PHOENIX' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider, id: NEXUS_MODEL,
      name: 'ORIÓN', description: 'Motor de inteligencia adaptativa · calidad, costo y cuotas verificadas' }])
  }

  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new LlmError('ORIÓN debe resolver un proveedor y modelo reales antes de transmitir', 'NEXUS_UNRESOLVED')
  }
}

/** Trusted account quota percentages, not fictional available token counts. */
export interface NexusCodexQuota {
  readonly primaryUsedPercent?: number | undefined
  readonly secondaryUsedPercent?: number | undefined
  readonly resetPrimaryAt?: number
  readonly resetSecondaryAt?: number
  readonly primaryObservedAt?: number
  readonly secondaryObservedAt?: number
}

/**
 * Whether a subscription call stays within the configured reserve.
 * @param quota - native account window observations.
 * @returns Whether both windows have measurable reserve.
 */
export function nexusCodexHasReserve(quota: NexusCodexQuota | undefined): boolean {
  if (quota === undefined) return false
  const primary = quota.primaryUsedPercent
  const secondary = quota.secondaryUsedPercent
  return primary !== undefined && Number.isFinite(primary) && primary >= 0 && primary < 95
    && secondary !== undefined && Number.isFinite(secondary) && secondary >= 0 && secondary < 90
}

const HOUR_MS = 3_600_000

/** Report native percentage windows without inventing total tokens. */
export function nexusQuotaView(quota: NexusCodexQuota | undefined, now: number) {
  const window = (used: number | undefined, reset: number | undefined, observed: number | undefined, duration: number) => {
    const resetAt = reset === undefined ? undefined : reset < 100_000_000_000 ? reset * 1000 : reset
    if (used === undefined || !Number.isFinite(used) || used < 0 || used > 100
      || resetAt === undefined || !Number.isFinite(resetAt) || resetAt <= now || resetAt - now > duration
      || observed === undefined || !Number.isFinite(observed) || observed > now || now - observed > 120_000) return { status: 'unknown' as const }
    return { status: 'reported' as const, usedPercent: used, remainingPercent: 100 - used,
      resetAt: new Date(resetAt).toISOString(), remainingMs: resetAt - now }
  }
  return { fiveHours: window(quota?.primaryUsedPercent, quota?.resetPrimaryAt, quota?.primaryObservedAt, 5 * HOUR_MS),
    sevenDays: window(quota?.secondaryUsedPercent, quota?.resetSecondaryAt, quota?.secondaryObservedAt, 7 * 24 * HOUR_MS),
    exactTokenBalance: null }
}

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
 * @param quota - native window observations.
 * @param now - current time in milliseconds.
 * @returns Whether ordinary work fits both windows.
 */
export function nexusCodexWithinPace(quota: NexusCodexQuota | undefined, now: number): boolean {
  return quota !== undefined && nexusCodexHasReserve(quota)
    && pacedWindow(quota.primaryUsedPercent, quota.resetPrimaryAt, now, 5 * HOUR_MS)
    && pacedWindow(quota.secondaryUsedPercent, quota.resetSecondaryAt, now, 7 * 24 * HOUR_MS)
}


/** Select native subscription windows by their actual duration, never by labels. */
export function nexusReadNativeCodexQuota(telemetry:unknown):NexusCodexQuota|undefined{
  if(!telemetry||typeof telemetry!=='object')return undefined
  type Window={usedPercent?:number;windowDurationMins?:number;resetsAt?:number;observedAt?:number}
  const row=telemetry as {kind?:string;provider?:string;accountType?:string;primaryLimit?:Window;secondaryLimit?:Window}
  if(row.kind!=='account'||typeof row.provider!=='string'||row.provider.toLowerCase()!=='codex'
    ||typeof row.accountType!=='string'||row.accountType.toLowerCase()!=='chatgpt')return undefined
  const windows=[row.primaryLimit,row.secondaryLimit]
  const select=(duration:number)=>{const matches=windows.filter(w=>w?.windowDurationMins===duration);return matches.length===1?matches[0]:undefined}
  const p=select(300),s=select(10080)
  if(!p||!s)return undefined
  return {
    primaryUsedPercent:p.usedPercent,secondaryUsedPercent:s.usedPercent,
    ...(p.resetsAt===undefined?{}:{resetPrimaryAt:p.resetsAt}),
    ...(s.resetsAt===undefined?{}:{resetSecondaryAt:s.resetsAt}),
    ...(p.observedAt===undefined?{}:{primaryObservedAt:p.observedAt}),
    ...(s.observedAt===undefined?{}:{secondaryObservedAt:s.observedAt}),
  }
}
/** Automatic admission requires a fresh native sample and a future reset for BOTH windows. */
export function nexusCodexFreshReserve(quota:NexusCodexQuota|undefined,now:number):boolean{
  if(!quota||!nexusCodexHasReserve(quota))return false
  const valid=(observed:number|undefined,reset:number|undefined,duration:number)=>
    observed!==undefined&&Number.isFinite(observed)&&observed<=now&&now-observed<=120000
    &&reset!==undefined&&Number.isFinite(reset)
    &&(reset<100_000_000_000?reset*1000:reset)>now&&(reset<100_000_000_000?reset*1000:reset)-now<=duration
  return valid(quota.primaryObservedAt,quota.resetPrimaryAt,5*HOUR_MS)
    &&valid(quota.secondaryObservedAt,quota.resetSecondaryAt,7*24*HOUR_MS)
}
/** Use only an effort advertised by the concrete model; complex work retains its default. */
export function nexusEconomyEffort<T extends string>(supported:readonly T[],complex:boolean):T|undefined{
  if(complex)return undefined
  for(const desired of ['low','minimal','off']){
    const effort=supported.find(id=>id.toLowerCase()===desired)
    if(effort!==undefined)return effort
  }
  return undefined
}

/**
 * Select the latest real Codex model in one family, never inventing a model ID.
 * @param ids - available model IDs.
 * @param complex - whether stronger task capability is needed.
 * @returns An advertised model ID, when present.
 */
export function nexusCodexFallback(ids: readonly string[], complex: boolean): string | undefined {
  const candidates = ids.filter(id => complex
    ? /^gpt-\d+(?:\.\d+)?-(?:astra|sol)(?:$|-)/iu.test(id)
    : /^gpt-\d+(?:\.\d+)?-luna(?:$|-)/iu.test(id))
  const collator = new Intl.Collator('en', { numeric: true })
  candidates.sort((left, right) => collator.compare(right, left))
  return candidates[0]
}

/**
 * Decide whether accuracy/tools must take priority over an unbenchmarked free model.
 * @param text - current human request.
 * @returns Whether the request needs a stronger route.
 */
export function nexusRequiresStrongModel(text: string): boolean {
  return text.length > 380
    || /^(?:contin[uú]a|sigue|hazlo|dale|termina|completa|arr[eé]glalo|continue|finish|do it|go ahead)(?:\b|$)/iu.test(text.trim())
    || /\b(?:m[eé]dic\p{L}*|cl[ií]nic\p{L}*|tratamiento|receta|farmac\p{L}*|jur[ií]dic\p{L}*|financ\p{L}*)\b/iu.test(text)
    || /\b(?:implement|refactor|debug|repair|analy[sz]e|develop|deploy|execute|diagnos|clinical|medical|legal|security)\b/iu.test(text)
    || /\b(?:research|audit|architecture|build|program|code|script|arregl\p{L}*|desarroll\p{L}*|implement\p{L}*)\b/iu.test(text)
    || /\b(?:repar\p{L}*|diagnostic\p{L}*|investig\p{L}*|analiz\p{L}*|c[oó]digo|aplicaci[oó]n|sistema|seguridad)\b/iu.test(text)
}

/** Extract only an explicitly quoted exact-answer contract; ordinary text is not graded. */
export function nexusExactResponseTarget(text: string): string | undefined {
  const match = /^(?:(?:reply|respond|answer) (?:with )?(?:exactly|only)|responde (?:exactamente|solo|únicamente))\s*:?\s*["“]([^"”\r\n]{1,120})["”]\.?!?$/iu.exec(text.trim())
  return match?.[1]
}

/** Exact-response quality is scoped to this measurable task family, never general intelligence. */
export function nexusExactResponseQuality(samples: readonly { exactResponseAccepted?: boolean }[]): number | undefined {
  const graded = samples.filter(s => typeof s.exactResponseAccepted === 'boolean')
  if (graded.length < 5) return undefined
  return nexusEstimatedQuality({ attempts: graded.length,
    accepted: graded.filter(s => s.exactResponseAccepted === true).length,
    totalLatencyMs: 0, totalTokens: 0 })
}

/** Independently solve a narrowly scoped integer operation without executing code. */
export function nexusNumericResponseTarget(text: string): string | undefined {
  const m = /^(?:calculate|compute|calcula|calcular|cu[aá]nto es)\s+(-?\d{1,7})\s*([+\-*×])\s*(-?\d{1,7})\s*(?:\?|\.)?\s*(?:(?:answer with only the number|responde solo con el n[uú]mero)\.?|)$/iu.exec(text.trim())
  if (!m) return undefined
  const a = Number(m[1]), b = Number(m[3])
  const result = m[2] === '+' ? a + b : m[2] === '-' ? a - b : a * b
  return Number.isSafeInteger(result) ? String(result) : undefined
}

/** Grade arithmetic independently of instruction-following observations. */
export function nexusNumericResponseQuality(samples: readonly { numericResponseAccepted?: boolean }[]): number | undefined {
  return nexusExactResponseQuality(samples.map(s => s.numericResponseAccepted === undefined ? {} : { exactResponseAccepted: s.numericResponseAccepted }))
}

type NexusSessionEvent = { readonly type: string; readonly data: unknown }
type NexusMessagePart = { readonly type?: string; readonly text?: unknown }

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

/**
 * Last genuine user text in a turn; durable UserMessage is the event data.
 * @param events - authoritative session events.
 * @param turn - current turn number.
 * @returns Concatenated human text.
 */
export function nexusTurnText(events: readonly NexusSessionEvent[], turn: number): string {
  return humanTurnParts(events, turn).filter(part => part.type === 'text'
    && typeof part.text === 'string').map(part => String(part.text)).join(' ').trim()
}

/**
 * Image detection examines actual author and this turn's message envelope.
 * @param events - authoritative session events.
 * @param turn - current turn number.
 * @returns Whether a human provided an image in this turn.
 */
export function nexusTurnHasHumanImage(events: readonly NexusSessionEvent[], turn: number): boolean {
  return humanTurnParts(events, turn).some(part => part.type === 'image')
}

/** Restrict remote price probes to the provider's published public listing. */
export class NexusOpenRouterPrices {
  private latest = new Map<string, NexusPriceEvidence>()
  private tools = new Set<string>()
  private contexts = new Map<string, number>()
  private validUntil = 0
  private refreshing: Promise<void> | undefined

  /**
 * Refresh at most once per TTL; unavailable evidence never becomes free.
 * @param now - current time in milliseconds.
 */
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
        this.contexts = new Map(Array.isArray(entries) ? entries.flatMap((entry): [string, number][] => {
          if (typeof entry !== 'object' || entry === null) return []
          const row = entry as { id?: unknown; context_length?: unknown }
          return typeof row.id === 'string' && typeof row.context_length === 'number'
            && Number.isSafeInteger(row.context_length) && row.context_length > 0
            ? [[row.id, row.context_length]] : []
        }) : [])
        this.tools = new Set(Array.isArray(entries) ? entries.flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null) return []
          const row = entry as { id?: unknown; supported_parameters?: unknown }
          return typeof row.id === 'string' && Array.isArray(row.supported_parameters)
            && row.supported_parameters.includes('tools') ? [row.id] : []
        }) : [])
      } catch {
        // Fail closed on missing price data; never reuse an expired free claim.
        this.latest.clear()
        this.tools.clear()
        this.contexts.clear()
      } finally {
        this.validUntil = now + CATALOG_AGE_MS
      }
    }
    const promise = run()
    this.refreshing = promise
    try { await promise } finally { this.refreshing = undefined }
  }
  /**
 * Latest price evidence; expiration is checked by the core classifier.
 * @param id - exact model ID.
 * @returns Observed price evidence when available.
 */
  get(id: string): NexusPriceEvidence | undefined { return this.latest.get(id) }
  /**
 * True only when the official entry explicitly advertised function tools.
 * @param id - exact model ID.
 * @returns Whether tools were advertised.
 */
  supportsTools(id: string): boolean { return this.tools.has(id) }
  /** Published context capacity, when supplied by the official listing. */
  contextWindow(id: string): number | undefined { return this.contexts.get(id) }
}

/** Narrow Agent events bridge avoids importing Agent source into the LLM package. */
interface NexusAgentEventBridge {
  on(event: 'agent/request', listener: (
    payload: { agent: NexusAgentHandle; turn: number; step: number; signal: AbortSignal },
    next: () => Promise<LlmCallConfig>,
  ) => Promise<LlmCallConfig>): void
  on(event: 'agent/request-error', listener: (
    payload: {
      agent: NexusAgentHandle
      turn: number
      step: number
      provider: string
      failure: { code: string }
      signal: AbortSignal
    },
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
  readonly freeRoutePolicies?: () => readonly NexusFreeRoutePolicy[]
  readonly nativeCodexAuthorized: () => Promise<boolean>
  readonly providerAuthorized: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<boolean>
}

/**
 * Install the opt-in Nexus selector, real-route dispatch and bounded failover.
 * @param ctx - Host context with existing LLM/auth/Agent capabilities.
 * @param options - Configured provider truth and native Codex token authority.
 */
export function installNexusRuntime(ctx: Context, options: NexusRuntimeOptions) {
  const receipts = new NexusReceiptStore(dshHomePath('nexus-receipts-v1.json'))
  const activeSessions = new Map<string, { key: string; exact?: string; numeric?: string; effort?: string }>()
  const prices = new NexusOpenRouterPrices()
  const perAgent = new WeakMap<object, NexusAgentRouteState>()
  const blockedUntil = new Map<string, number>()
  let quotaCache: NexusCodexQuota | undefined
  let quotaReadAt = 0
  let modelsCache: readonly NexusModel[] = []
  let catalogReadAt = 0
  let catalogProfiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  let catalogPolicies: readonly NexusFreeRoutePolicy[] | undefined
  let catalogInFlight: Promise<readonly NexusModel[]> | undefined
  const routeKey = (provider: string, model: string) => provider + '/' + model

  const getQuota = async (now: number, signal: AbortSignal): Promise<NexusCodexQuota | undefined> => {
    if (now < quotaReadAt + 10_000 && nexusCodexFreshReserve(quotaCache,now)) return quotaCache
    quotaReadAt = now
    const auth = ctx.get('authorization')
    if (auth === undefined) { quotaCache = undefined; return undefined }
    const codex = auth.list().find(entry => String(entry.key)==='subagent-codex/account')
    if (codex === undefined) { quotaCache = undefined; return undefined }
    try {
      const timeout = AbortSignal.timeout(2_000)
      const inspection = await auth.inspect(codex.key, AbortSignal.any([signal, timeout]))
      quotaCache=nexusReadNativeCodexQuota(inspection)
    } catch {
      // A failed refresh must not authorize additional subscription usage.
      quotaCache = undefined
    }
    return quotaCache
  }

  const listAuthorizedModels = async (now: number): Promise<readonly NexusModel[]> => {
    const currentProfiles = options.profiles()
    const currentPolicies = options.freeRoutePolicies?.()
    if (now < catalogReadAt + 60_000 && modelsCache.length > 0
      && catalogProfiles === currentProfiles && catalogPolicies === currentPolicies) return modelsCache
    if (catalogInFlight !== undefined) return catalogInFlight
    const read = async (): Promise<readonly NexusModel[]> => {
      const authorized = currentProfiles
      const providers = ctx.llm.listProviders().filter(entry =>
        entry.id !== NEXUS_PROVIDER && authorized.has(entry.id))
      if (providers.some(p => p.id === 'openrouter')) await prices.refresh(now)
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
          const policy = nexusOperatorPolicy(currentPolicies ?? [], provider.id, model.id, profile.baseURL, now)
          const evidence: NexusPriceEvidence | undefined = officialOpenRouter ? prices.get(model.id)
            : policy === undefined ? undefined : { source: 'operator-confirmed', observedAt: policy.verifiedAt,
              expiresAt: policy.expiresAt, inputPerMillion: 0, outputPerMillion: 0,
              allChargesVerified: true, accountEligible: true }
          const contextWindow = officialOpenRouter ? prices.contextWindow(model.id) : policy?.contextWindow
          return {
            provider: provider.id,
            id: model.id,
            label: model.name,
            configured: true,
            authorized: authenticated,
            online: (blockedUntil.get(key) ?? 0) <= now,
            local: /^(?:phoenix-local|ollama)(?:$|[-_/])/iu.test(provider.id),
            supportsImages: model.inputModalities?.includes('image') === true,
            supportsTools: officialOpenRouter ? prices.supportsTools(model.id) : policy?.supportsTools === true,
            ...(evidence === undefined ? {} : { price: evidence }),
            ...(contextWindow === undefined ? {} : { contextWindow }),
          } satisfies NexusModel
        })
      }))
      modelsCache = batches.flat()
      catalogReadAt = now
      catalogProfiles = currentProfiles
      catalogPolicies = currentPolicies
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
    const text = nexusTurnText(agent.session.events, payload.turn)
    const complex = text.length === 0 || nexusRequiresStrongModel(text)
    const hasImage = nexusTurnHasHumanImage(agent.session.events, payload.turn)
    const exact = !hasImage ? nexusExactResponseTarget(text) : undefined
    const numeric = !hasImage && exact === undefined ? nexusNumericResponseTarget(text) : undefined
    const activeRoute = (route: NexusRoute) => ({ key: routeKey(route.provider, route.model),
      ...(exact === undefined ? {} : { exact }), ...(numeric === undefined ? {} : { numeric }) })
    const buildRoute=async(route:NexusRoute):Promise<LlmCallConfig>=>{
      const { serviceTier: _tier, reasoningEffort: _effort, ...base }=selected
      let reasoningEffort:LlmCallConfig['reasoningEffort']
      if(route.provider==='openai-codex'&&!complex&&!hasImage){
        const info=await ctx.llm.resolveModelInfo(route.provider,route.model,payload.signal).catch(()=>undefined)
        reasoningEffort=nexusEconomyEffort(info?.reasoning?.efforts.map(e=>e.id)??[],false)
      }
      const active = activeSessions.get(agent.session.id)
      if (active !== undefined && reasoningEffort !== undefined) active.effort = String(reasoningEffort)
      return {...base,provider:route.provider,model:route.model,...(reasoningEffort===undefined?{}:{reasoningEffort})}
    }
    if (state.routed !== undefined) {
      const route = state.routed
      const profile = options.profiles().get(route.provider)
      const authenticated = profile !== undefined
        && await options.providerAuthorized(route.provider, profile).catch(() => false)
      let eligible = authenticated
      if (route.provider === 'openai-codex') {
        const quota = await getQuota(now, payload.signal)
        eligible = eligible && nexusCodexFreshReserve(quota,Date.now()) && (complex||nexusCodexWithinPace(quota,Date.now())) && await options.nativeCodexAuthorized()
      } else {
        const inventory = await listAuthorizedModels(now)
        const model = inventory.find(item => item.provider === route.provider && item.id === route.model)
        eligible = eligible && model !== undefined && model.online && model.supportsTools === true
          && (!hasImage || model.supportsImages === true)
          && model.contextWindow !== undefined && model.contextWindow >= 8_192
          && nexusPriceClass(model, Date.now()) === 'verified-free'
          && (route.provider === 'openrouter' ? (profile?.baseURL === undefined
            || profile.baseURL.replace(/\/+$/u, '') === 'https://openrouter.ai/api/v1')
            : nexusOperatorPolicy(options.freeRoutePolicies?.() ?? [], route.provider, route.model, profile?.baseURL, Date.now()) !== undefined)
      }
      if (!eligible) {
        state.excluded.add(routeKey(route.provider, route.model))
        state.routed = undefined
      } else {
        activeSessions.set(agent.session.id, activeRoute(route))
        return buildRoute(route)
      }
    }
    const observations = await receipts.read(now).catch(() => [])
    const models = (await listAuthorizedModels(now)).map((model) => {
      const samples = observations.filter(r => r.provider === model.provider && r.model === model.id)
      if (samples.length === 0) return model
      const failures = samples.filter(r => !r.succeeded).length
      const quality = exact !== undefined ? nexusExactResponseQuality(samples)
        : numeric !== undefined ? nexusNumericResponseQuality(samples) : undefined
      return { ...model, observations: samples.length,
        ...(quality === undefined ? {} : { observedQuality: quality }),
        errorRate: (failures + 1) / (samples.length + 5),
        observedLatencyMs: samples.reduce((sum, r) => sum + r.latencyMs, 0) / samples.length }
    }).filter(model =>
      !state.excluded.has(routeKey(model.provider, model.id))
      && (blockedUntil.get(routeKey(model.provider, model.id)) ?? 0) <= now)
    const free = chooseNexusRoute(models, {
      // Even short turns inherit the harness tool schema; only capable routes are safe.
      needsTools: true,
      needsImages: hasImage,
      inputTokens: 8_192,
      minimumQuality: 0,
      allowPaid: false,
      allowLocal: false,
    }, Date.now())
    let route = complex ? undefined : free
    if (complex || free === undefined) {
      // A native ChatGPT/Codex seat is a user-existing subscription, not a new
      // API-key billing route. It remains bounded by the reported quota.
      const quota = await getQuota(now, payload.signal)
      const ids = models.filter(model => model.provider === 'openai-codex' && model.authorized
        && (!hasImage || model.supportsImages === true)
        && !state.excluded.has(routeKey(model.provider, model.id))).map(model => model.id)
      const candidate = nexusCodexFallback(ids, complex)
      const withinBudget = nexusCodexFreshReserve(quota,Date.now()) && (complex || nexusCodexWithinPace(quota,Date.now()))
      if (candidate !== undefined && withinBudget && await options.nativeCodexAuthorized()) {
        route = { provider: 'openai-codex', model: candidate, priceClass: 'unknown',
          reason: 'existing authorized Codex subscription; model quality or tool requirements' }
      }
    }
    if (route === undefined) {
      throw new LlmError(
        'ORIÓN no encontró un modelo gratuito verificado compatible ni una ruta Codex con reserva de cuota. Selecciona un modelo manualmente o conecta un proveedor gratuito compatible.',
        'NEXUS_NO_ELIGIBLE_ROUTE',
      )
    }
    const profile = options.profiles().get(route.provider)
    if (profile === undefined || !await options.providerAuthorized(route.provider, profile).catch(() => false)) {
      throw new LlmError('La autorización de la ruta ORIÓN cambió antes de ejecutarse', 'NEXUS_NO_ELIGIBLE_ROUTE')
    }
    if (route.provider !== 'openai-codex' && route.provider !== 'openrouter'
      && nexusOperatorPolicy(options.freeRoutePolicies?.() ?? [], route.provider, route.model, profile.baseURL, Date.now()) === undefined) {
      throw new LlmError('La validación gratuita de ORIÓN cambió antes de ejecutarse', 'NEXUS_NO_ELIGIBLE_ROUTE')
    }
    if (route.provider === 'openrouter' && ((profile.baseURL !== undefined
      && profile.baseURL.replace(/\/+$/u, '') !== 'https://openrouter.ai/api/v1')
      || nexusPriceClass({ price: prices.get(route.model) }, Date.now()) !== 'verified-free')) {
      throw new LlmError('El precio o endpoint OpenRouter de ORIÓN cambió antes de ejecutarse', 'NEXUS_NO_ELIGIBLE_ROUTE')
    }
    payload.signal.throwIfAborted()
    state.routed = route
    if (activeSessions.size >= 512) {
      const oldest = activeSessions.keys().next().value
      if (oldest !== undefined) activeSessions.delete(oldest)
    }
    activeSessions.set(agent.session.id, activeRoute(route))
    return buildRoute(route)
  })

  // Retry is permitted only before the failed model request has yielded tools;
  // the Agent loop's own request-error seam retries the same step from its
  // durable context, not side-effecting tool calls.
  agentEvents.on('agent/request-error', async (payload, next) => {
    const state = perAgent.get(payload.agent)
    const active = state?.turn === payload.turn ? state : undefined
    if (payload.signal.aborted || active?.routed === undefined || active.routed.provider !== payload.provider
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
    const active = request.sessionId === undefined ? undefined : activeSessions.get(request.sessionId)
    if (request.purpose !== undefined || active === undefined
      || active.key !== routeKey(request.provider, request.model)) return upstream
    return (async function* (): AsyncIterable<StreamChunk> {
      const started = Date.now()
      let usage: NexusUsage | undefined
      let succeeded = false
      let terminal = false
      let exactResponseAccepted: boolean | undefined
      let numericResponseAccepted: boolean | undefined
      let answer = ''
      let overflow = false
      try {
        for await (const chunk of upstream) {
          if (chunk.type === 'usage') {
            usage = {
              provider: request.provider, model: request.model, timestamp: Date.now(),
              inputTokens: chunk.usage.inputTokens + (chunk.usage.cacheReadTokens ?? 0)
                + (chunk.usage.cacheWriteTokens ?? 0),
              outputTokens: chunk.usage.outputTokens,
            }
          } else if ((active.exact !== undefined || active.numeric !== undefined) && chunk.type === 'text-delta') {
            if (answer.length + chunk.text.length > 512) overflow = true
            else if (!overflow) answer += chunk.text
          } else if (chunk.type === 'finish') {
            terminal = true
            succeeded = chunk.reason.kind === 'stop' || chunk.reason.kind === 'tool-calls'
            if (active.exact !== undefined && chunk.reason.kind === 'stop') {
              exactResponseAccepted = !overflow && answer.trim() === active.exact
            }
            if (active.numeric !== undefined && chunk.reason.kind === 'stop') {
              numericResponseAccepted = !overflow && answer.trim() === active.numeric
            }
          }
          yield chunk
        }
      } finally {
        if (terminal && request.signal?.aborted !== true) {
          await receipts.record({
            provider: request.provider, model: request.model, timestamp: Date.now(),
            inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
            usageReported: usage !== undefined,
            latencyMs: Math.max(0, Date.now() - started), succeeded,
            ...(exactResponseAccepted === undefined ? {} : { exactResponseAccepted }),
            ...(numericResponseAccepted === undefined ? {} : { numericResponseAccepted }),
          }).catch(() => { ctx.logger.warn('Nexus receipt persistence failed; no balance was inferred') })
        }
      }
    })()
  })

  // Read-only inspection: no generation, paid probes, credentials or prompt data.
  return async (signal: AbortSignal, query: { provider?: string; offset?: number; sessionId?: string } = {}) => {
    signal.throwIfAborted()
    const listed = await listAuthorizedModels(Date.now())
    const filtered = listed.filter(m => query.provider === undefined || m.provider === query.provider)
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))
    const offset = Number.isSafeInteger(query.offset) && (query.offset ?? 0) >= 0 ? query.offset ?? 0 : 0
    const page = filtered.slice(offset, offset + 25)
    const models = await Promise.all(page.map(async model => {
      signal.throwIfAborted()
      const info = await ctx.llm.resolveModelInfo(model.provider, model.id, signal).catch(() => undefined)
      const { price: _price, online: _online, ...safe } = model
      return { ...safe, priceClass: nexusPriceClass(model, Date.now()),
        contextWindow: model.contextWindow ?? info?.context?.contextWindow ?? null,
        thinkingLevels: info?.reasoning?.efforts.map(e => e.id) ?? [],
        defaultEffort: info?.reasoning?.defaultEffort ?? null,
        readiness: (blockedUntil.get(routeKey(model.provider, model.id)) ?? 0) > Date.now() ? 'cooldown' : 'not-live-probed' }
    }))
    const quota = await getQuota(Date.now(), signal)
    const last = query.sessionId === undefined ? undefined : activeSessions.get(query.sessionId)
    return { models, total: filtered.length, offset, nextOffset: offset + page.length < filtered.length ? offset + page.length : null,
      quota: nexusQuotaView(quota, Date.now()), lastDispatchedRoute: last?.key ?? null,
      lastDispatchedEffort: last?.effort ?? null, localAutomaticRouting: false }
  }
}
