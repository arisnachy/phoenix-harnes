/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@phoenix-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @phoenix-ai/dsh-llm-pi-ai
 */

import type { Context } from '@phoenix-ai/cordis'
import { launchEnvironmentOf } from '@phoenix-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@phoenix-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@phoenix-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@phoenix-ai/dsh-settings'
import { PiAiAdapter, type PhoenixLocalModelMetadata } from './adapter.ts'
import { installNexusRuntime } from './nexus-runtime.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { CODEX_PROVIDER, CodexLiveCatalog } from './codex-live-catalog.ts'
import { codexNativeAccessToken } from './codex-auth.ts'
import { assertServiceable, CHATGPT_WEB_PROVIDER, chatgptWebDefaults, Config, DEFAULT_PHOENIX_LOCAL_STREAM_IDLE_TIMEOUT_MS, resolveProfiles } from './config.ts'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import { installCodexAvatarTransform, installCodexImageGeneration } from './image-generation.ts'
import { registerPiAiFlows } from './login.ts'
import { GOOGLE_ACCOUNT_PROVIDER, ANTIGRAVITY_MODEL_PROVIDER, isGoogleAccountRoute, parseGoogleModels, registerGoogleAccountCli, runGoogleCli } from './antigravity-cli.ts'
import { GOOGLE_ANTIGRAVITY_PROVIDER } from './google-antigravity.ts'
import { NvidiaLiveCatalog, NVIDIA_BUILD_BASE_URL, NVIDIA_MODEL_REFRESH_MS } from './nvidia-live-catalog.ts'
import {
  OPENCODE_FREE_PROVIDER,
  createOpenCodeFreeCatalog,
  opencodeFreeProfile,
  startOpenCodeFreeProxy,
} from './opencode-free.ts'

export * from './nexus.ts'
export { NEXUS_PROVIDER, NEXUS_MODEL, ORION_PROVIDER, ORION_MODEL, NexusSelectorAdapter, nexusCodexFallback, nexusCodexHasReserve, nexusRequiresStrongModel } from './nexus-runtime.ts'
export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export { Config } from './config.ts'
export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export {
  CHATGPT_WEB_DEFAULT_API,
  CHATGPT_WEB_DEFAULT_BASE_URL,
  CHATGPT_WEB_LOCAL_AUTHORIZATION,
  CHATGPT_WEB_PROVIDER,
  chatgptWebDefaults,
} from './config.ts'
export { recordKeyFor } from './auth.ts'
export {
  GOOGLE_ANTIGRAVITY_DEFAULT_MODELS,
  GOOGLE_ANTIGRAVITY_DISPLAY_NAME,
  GOOGLE_ANTIGRAVITY_PROVIDER,
} from './google-antigravity.ts'
export { supportedProtocols } from './provider.ts'
export {
  OPENCODE_FREE_BASE_URL,
  OPENCODE_FREE_CATALOG_URL,
  OPENCODE_FREE_PROVIDER,
  OPENCODE_FREE_PROXY_BASE_URL,
  isOpenCodeFreeCandidate,
  parseOpenCodeFreeModels,
} from './opencode-free.ts'
export {
  classifyCodexImageFailure,
  codexDoctorSupportsImageGeneration,
  imageGenerationToolDescription,
  installCodexImageGeneration,
  selectFreshGeneratedImage,
} from './image-generation.ts'

export const name = 'llm-pi-ai'
// The normal model catalog must not wait for image-generation-only services.
// The image-only variant injects its narrower runtime seams inside apply().
export const inject = ['llm']

const NS = settingsNamespace('llm-pi-ai')

/** Stable provider id of the built-in offline Phoenix route. */
export const PHOENIX_LOCAL_PROVIDER = 'phoenix-local'
/** Stable model id selected through the same picker as cloud models. */
export const PHOENIX_LOCAL_MODEL = 'phoenix-local'
/** Stable lightweight Host proxy; the heavy llama-server stays behind it. */
export const PHOENIX_LOCAL_BASE_URL = 'http://127.0.0.1:17842/v1'
/** Non-secret marker that satisfies pi-ai's OpenAI-compatible auth preflight for the loopback-only route. */
export const PHOENIX_LOCAL_AUTHORIZATION = 'Bearer phoenix-local'
/** Conservative shared budget that also fits CPU-first Ollama Qwen 2B. */
export const PHOENIX_LOCAL_CONTEXT_WINDOW = 4_096
/** Limit long responses on older CPU-first Windows devices. */
export const PHOENIX_LOCAL_MAX_TOKENS = 256

/** Read selection from the built-in Host without starting the inference backend. */
async function resolvePhoenixLocalModel(
  profile: ResolvedPiAiProviderProfile,
  signal?: AbortSignal,
): Promise<PhoenixLocalModelMetadata | undefined> {
  if (profile.baseURL !== PHOENIX_LOCAL_BASE_URL) return undefined
  const deadline = AbortSignal.timeout(2_000)
  try {
    const response = await fetch(`${PHOENIX_LOCAL_BASE_URL}/phoenix-local/metadata`, {
      headers: { Authorization: PHOENIX_LOCAL_AUTHORIZATION },
      redirect: 'error',
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return undefined
    }
    const metadata = await response.json() as Partial<PhoenixLocalModelMetadata> | null
    if (metadata === null || typeof metadata.selectedModelId !== 'string'
      || !/^[a-z0-9][a-z0-9.-]*$/u.test(metadata.selectedModelId)
      || typeof metadata.contextWindow !== 'number' || !Number.isSafeInteger(metadata.contextWindow)
      || metadata.contextWindow < 4_096
      || typeof metadata.maxTokens !== 'number' || !Number.isSafeInteger(metadata.maxTokens)
      || metadata.maxTokens < 1 || metadata.maxTokens >= metadata.contextWindow) return undefined
    return {
      selectedModelId: metadata.selectedModelId,
      contextWindow: metadata.contextWindow,
      maxTokens: metadata.maxTokens,
    }
  } catch {
    // Earlier or unavailable Hosts still use the bounded built-in fallback.
    signal?.throwIfAborted()
    return undefined
  }
}

/** Built-in route injected independently of user settings or cloud credentials. @internal */
export function phoenixLocalProfile(): PiAiProviderProfile {
  return {
    displayName: '🔥 Phoenix Local · Offline',
    api: 'openai-completions',
    baseURL: PHOENIX_LOCAL_BASE_URL,
    defaultContextWindow: PHOENIX_LOCAL_CONTEXT_WINDOW,
    defaultMaxTokens: PHOENIX_LOCAL_MAX_TOKENS,
    defaultInput: ['text'],
    headers: { Authorization: PHOENIX_LOCAL_AUTHORIZATION },
    // Ollama's OpenAI-compatible /chat/completions consumes max_tokens.
    // Do not let pi-ai's generic OpenAI compatibility choose a different field.
    compat: { maxTokensField: 'max_tokens', supportsStore: false },
    // The Host can spend 60s starting llama-server and up to 10m on inference.
    // Leave headroom for that bounded request; do not mask the local idle default.
    timeoutMs: 12 * 60_000,
    streamIdleTimeoutMs: DEFAULT_PHOENIX_LOCAL_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: { mode: 'normal', maxRetries: 0, retryableCodes: ['TIMEOUT', 'TRANSPORT', 'SERVER'] },
    models: [{
      id: PHOENIX_LOCAL_MODEL,
      name: 'Phoenix Local · Device model',
      contextWindow: PHOENIX_LOCAL_CONTEXT_WINDOW,
      maxTokens: PHOENIX_LOCAL_MAX_TOKENS,
      input: ['text'],
    }],
  }
}

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: built-ins with their own lifecycle UI
 * are intentionally omitted so Settings never asks for a fake API credential.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const knownRoutes = new Set([...catalogProviderIds(), CHATGPT_WEB_PROVIDER])
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string): void => {
    entries.set(provider, {
      provider,
      displayName: provider === 'openai-codex' && displayName === provider ? 'OpenAI Codex' : displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      declared: provider === CHATGPT_WEB_PROVIDER || !knownRoutes.has(provider),
    })
  }
  for (const provider of knownRoutes) {
    const defaultName = provider === CHATGPT_WEB_PROVIDER
      ? chatgptWebDefaults().displayName
      : catalogProvider(provider)?.name ?? provider
    declare(provider, defaultName)
  }
  for (const [provider, profile] of profiles) {
    if (provider === PHOENIX_LOCAL_PROVIDER || provider === OPENCODE_FREE_PROVIDER) continue
    declare(provider, profile.displayName)
  }
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  if (config.imageOnly === true) {
    ctx.inject(['tools', 'subprocess', 'attachments'], (imageCtx) => {
      installCodexImageGeneration(imageCtx)
      imageCtx.inject(['connection'], (connectionCtx) => {
        installCodexAvatarTransform(connectionCtx)
      })
    })
    return
  }

  registerGoogleAccountCli(ctx)

  const EMPTY_NEXUS_POLICIES = Object.freeze([])
  const openCodeCatalog = createOpenCodeFreeCatalog()
  let openCodeCatalogRevision = 0
  const codexCatalog = new CodexLiveCatalog({ logger: ctx.logger })
  const nvidiaCatalog = new NvidiaLiveCatalog({ logger: ctx.logger })
  const officialNvidiaRoute = (): boolean => {
    const route = current().providers?.nvidia
    return route !== undefined
      && (route.baseURL === undefined || route.baseURL.replace(/[/]+$/u, '') === NVIDIA_BUILD_BASE_URL)
  }
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastCatalogRevision = -1
  let lastCodexCatalogRevision = -1
  let lastNvidiaCatalogRevision = -1
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined

  /**
   * Built-in local and free routes are injected last, so user settings cannot
   * redirect their loopback seams or turn an anonymous route into a paid one.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (
      raw === lastRaw
      && lastCatalogRevision === openCodeCatalogRevision
      && lastCodexCatalogRevision === codexCatalog.revision
      && lastNvidiaCatalogRevision === nvidiaCatalog.revision
      && memoized !== undefined
    ) return memoized

    const providers = { ...nvidiaCatalog.overlayProviders(codexCatalog.overlayProviders(raw.providers ?? {})) }
    // The native CLI owns this route; never register it as a generic API model.
    delete providers[GOOGLE_ACCOUNT_PROVIDER]
    delete providers[ANTIGRAVITY_MODEL_PROVIDER]
    const next = resolveProfiles({
      ...providers,
      [PHOENIX_LOCAL_PROVIDER]: phoenixLocalProfile(),
      [OPENCODE_FREE_PROVIDER]: opencodeFreeProfile(openCodeCatalog.models()),
    })
    lastRaw = raw
    lastCatalogRevision = openCodeCatalogRevision
    lastCodexCatalogRevision = codexCatalog.revision
    lastNvidiaCatalogRevision = nvidiaCatalog.revision
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    // openai-codex is the native ChatGPT/Codex session route. Ask Codex
    // itself for the current ChatGPT access JWT; never consult OPENAI_API_KEY
    // or a stale apiKeyEnv for this route. Codex owns login and refresh.
    if (provider === CODEX_PROVIDER) return codexNativeAccessToken()
    // A configured API-key reference must never override the direct OAuth grant.
    if (provider === GOOGLE_ANTIGRAVITY_PROVIDER) return undefined
    const ref = profile.apiKeyEnv
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth,
    refreshModels: (provider, force) => {
      if (provider === 'nvidia') {
        if (!officialNvidiaRoute()) return Promise.resolve(undefined)
        return nvidiaCatalog.refresh(force)
      }
      return codexCatalog.refresh(provider, current().providers?.[provider], force)
    },
    preferredModel: (provider, model, needsImage) =>
      provider === 'nvidia' && officialNvidiaRoute()
        ? nvidiaCatalog.preferredModel(model, needsImage)
        : undefined,
    onModelUnavailable: async (provider, model, needsImage) => {
      if (provider !== 'nvidia' || !officialNvidiaRoute()) return undefined
      const alternative = await nvidiaCatalog.markUnavailable(model, needsImage)
      if (alternative !== undefined) {
        ctx.logger.warn(`nvidia: model "${model}" returned HTTP 410; switching this turn to "${alternative}"`)
      }
      return alternative
    },
    reasoningForModel: (provider, model) => {
      if (provider !== CODEX_PROVIDER) return undefined
      const configured = current().providers?.[provider]?.models?.find(candidate => candidate.id === model)
      // A person can still explicitly disable reasoning on a pinned Codex row.
      // Every other Codex capability comes from app-server so autocarga rows
      // keep inheriting current efforts as the model evolves.
      if (configured?.reasoningEfforts === false) return undefined
      return codexCatalog.reasoningForModel(model)
    },
    resolveLocalModel: resolvePhoenixLocalModel,
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })

  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, auth) })

  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()

  const storedApiKey = async (provider: string | undefined): Promise<string | undefined> => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return resolveApiKey(provider, profile)
  }
  ctx.llm.registerModelDiscovery(NS, async (request) => {
    if (isGoogleAccountRoute(request.provider)) {
      const models = parseGoogleModels(await runGoogleCli(['models']))
      if (models.length === 0) throw new LlmError('Antigravity CLI no informó modelos disponibles. Conecta tu cuenta Google primero.', 'NO_MODELS')
      return models.map(id => ({ id, name: 'Gemini · ' + id }))
    }
    if (request.provider === 'nvidia'
      && (request.baseURL === undefined || request.baseURL.replace(/[/]+$/u, '') === NVIDIA_BUILD_BASE_URL)) {
      await nvidiaCatalog.refresh(true)
      const live = nvidiaCatalog.visibleModels()
      if (live !== undefined) {
        return live.map(model => ({
          id: model.id,
          name: model.name ?? model.id,
          ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
        }))
      }
    }
    return discoverModels(request, () => storedApiKey(request.provider))
  })

  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  const inspectNexus = installNexusRuntime(ctx, {
    profiles,
    freeRoutePolicies: () => current().nexusFreeRoutes ?? EMPTY_NEXUS_POLICIES,
    providerAuthorized: async (provider, profile) => {
      try { return (await resolveApiKey(provider, profile)) !== undefined }
      catch { return false }
    },
    nativeCodexAuthorized: async () => {
      try { return (await codexNativeAccessToken()).length > 0 }
      catch { return false }
    },
  })

  // Model-facing self-inspection uses only metadata, never credentials or prompt contents.
  ctx.inject(['tools'], (toolCtx) => {
    type InspectionRegistry = {
      tools: { register(definition: {
        name: string; description: string; parameters: Record<string, unknown>
        output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }
        timeoutMs: number
        execute(args: unknown, exec: { signal: AbortSignal; agent?: { session?: { id?: string } } }): Promise<unknown>
      }): () => void }
    }
    const registry = (toolCtx as unknown as InspectionRegistry).tools
    registry.register({
      name: 'phoenix_nexus_inspect',
      description: 'Read-only PHOENIX self-inspection: actual model inventory, provider authorization status, pricing evidence class, supported reasoning efforts, native Codex 5h/7d percentages and reset times. No generation or paid probe. Results are paginated; unknown data is not zero. Last dispatched route is not a provider-verified response model.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        provider: { type: 'string', description: 'Optional exact provider ID' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset; 25 models per page' },
      } },
      output: { schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      timeoutMs: 30_000,
      execute: async (args, exec) => {
        const query = args !== null && typeof args === 'object' ? args as { provider?: unknown; offset?: unknown } : {}
        const sessionId = exec.agent?.session?.id
        return inspectNexus(exec.signal, {
          ...(typeof query.provider === 'string' ? { provider: query.provider } : {}),
          ...(typeof query.offset === 'number' ? { offset: query.offset } : {}),
          ...(typeof sessionId === 'string' ? { sessionId } : {}),
        })
      },
    })
  })

  // The bridge is loopback-only. It gives pi-ai the local Authorization marker
  // it requires, then strips that marker before the request leaves Phoenix.
  // The same Cordis effect owns catalog refresh and port cleanup across reloads.
  void ctx.effect(async () => {
    let server: Awaited<ReturnType<typeof startOpenCodeFreeProxy>> | undefined
    try {
      server = await startOpenCodeFreeProxy()
    } catch (error: unknown) {
      ctx.logger.error('opencode-free: loopback proxy could not start')
      ctx.logger.error(error)
    }

    const refresh = async (force = false): Promise<void> => {
      const changed = await openCodeCatalog.refresh(force)
      if (!changed) return
      openCodeCatalogRevision += 1
      // Re-resolve immediately so existing adapter snapshots observe a new
      // profile identity on the next list/resolve/call operation.
      memoized = undefined
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('opencode-free: refreshed catalog could not be registered; keeping previous routes')
        ctx.logger.error(error)
      }
    }

    await refresh(true)
    const timer = setInterval(() => { void refresh() }, 60_000)
    timer.unref()
    return async () => {
      clearInterval(timer)
      if (server === undefined) return
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close((error) => {
          if (error !== undefined) ctx.logger.error(error)
          resolve()
        })
      })
    }
  }, 'OpenCode free model bridge')

  // NVIDIA's hosted model IDs change independently of PHOENIX releases.
  // Poll in the Host and invalidate profile snapshots only when the live list changes.
  void ctx.effect(async () => {
    if (officialNvidiaRoute()) void nvidiaCatalog.refresh(true)
    const timer = setInterval(() => {
      if (officialNvidiaRoute()) void nvidiaCatalog.refresh()
    }, NVIDIA_MODEL_REFRESH_MS)
    timer.unref()
    return () => { clearInterval(timer) }
  }, 'NVIDIA live model catalog')

  installSettingsSection(ctx, NS, Config, config, {
    validate: assertServiceable,
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
        ctx.logger.error(error)
      }
      try {
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
