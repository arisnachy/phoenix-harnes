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
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
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
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogProviderIds } from './catalog.ts'
import { assertServiceable, CHATGPT_WEB_PROVIDER, chatgptWebDefaults, Config, resolveProfiles } from './config.ts'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import { installCodexImageGeneration } from './image-generation.ts'
import { registerPiAiFlows } from './login.ts'

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
export { supportedProtocols } from './provider.ts'
export {
  classifyCodexImageFailure,
  codexDoctorSupportsImageGeneration,
  imageGenerationToolDescription,
  installCodexImageGeneration,
  selectFreshGeneratedImage,
} from './image-generation.ts'

export const name = 'llm-pi-ai'
// The host adapter and the agent-plane image-only variant both need the same
// runtime seams. Declaring them here makes direct image registration resolve on
// the mounting agent instead of falling through an unscoped property access.
export const inject = ['llm', 'tools', 'subprocess', 'attachments']

const NS = settingsNamespace('llm-pi-ai')

/** Stable provider id of the built-in offline Phoenix route. */
export const PHOENIX_LOCAL_PROVIDER = 'phoenix-local'
/** Stable model id selected through the same picker as cloud models. */
export const PHOENIX_LOCAL_MODEL = 'phoenix-local'
/** Stable lightweight Host proxy; the heavy llama-server stays behind it. */
export const PHOENIX_LOCAL_BASE_URL = 'http://127.0.0.1:17842/v1'

/** Built-in route injected independently of user settings or cloud credentials. */
function phoenixLocalProfile(): PiAiProviderProfile {
  return {
    displayName: '🔥 Phoenix Local · Offline',
    api: 'openai-completions',
    baseURL: PHOENIX_LOCAL_BASE_URL,
    defaultContextWindow: 8192,
    defaultMaxTokens: 4096,
    defaultInput: ['text'],
    models: [{
      id: PHOENIX_LOCAL_MODEL,
      name: 'Phoenix Local · Qwen3.5-4B',
      contextWindow: 8192,
      maxTokens: 4096,
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
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route, the
 * optional local ChatGPT Web bridge route, plus every user-configurable route
 * the current profiles declare. Phoenix Local is intentionally absent here:
 * its lifecycle has a dedicated Settings card rather than a fake API form.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const knownRoutes = new Set([...catalogProviderIds(), CHATGPT_WEB_PROVIDER])
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      declared: provider === CHATGPT_WEB_PROVIDER || !knownRoutes.has(provider),
    })
  }
  for (const provider of knownRoutes) {
    declare(provider, provider === CHATGPT_WEB_PROVIDER ? chatgptWebDefaults().displayName : provider)
  }
  for (const [provider, profile] of profiles) {
    if (provider === PHOENIX_LOCAL_PROVIDER) continue
    declare(provider, profile.displayName)
  }
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  // The agent-plane image row reuses this package without creating a second
  // provider adapter or settings surface in every mounted session.
  if (config.imageOnly === true) {
    // Preset rows are mounted only after the host services exist. Registering
    // against this exact agent context keeps the tool in the agent layer;
    // ctx.inject would re-enter through the host service context and make the
    // registration invisible to the mounting agent.
    installCodexImageGeneration(ctx)
    return
  }

  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity. The local route is injected last so a user settings
   * document cannot redirect Phoenix Local away from its loopback-only proxy.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles({
      ...(raw.providers ?? {}),
      [PHOENIX_LOCAL_PROVIDER]: phoenixLocalProfile(),
    })
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Phoenix Local deliberately names none and is
    // therefore usable without cloud credentials, API keys, or tokens.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  // One store and one ambient context for the whole plugin instance: both read
  // through `ctx` per call, so they stay correct across the collection rebuilds
  // a configuration change causes, and a sign-in survives one.
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth,
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // Independent of the route set: signing in is what makes a route worth
  // adding, so the flows are offered before any profile names their provider.
  // Scoped to the authorization seam rather than injected outright, because a
  // composition without it (headless, ACP) simply has no surface to sign in
  // from, while everything else this plugin does still works.
  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, auth) })
  // Image generation is registered by the agent-plane `imageOnly` row below.
  // Keeping it out of this host adapter prevents a model-facing tool from
  // leaking into the global layer (and into presets that did not opt in).
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /**
   * The credential a named route already resolves, for an interrogation whose
   * draft carries none. A route being declared for the first time names no
   * profile yet, and a profile that names no credential defers to pi-ai's own
   * discovery, so both answer `undefined` and the endpoint is asked
   * unauthenticated — the same posture a request to that route would take.
   */
  const storedApiKey = async (provider: string | undefined): Promise<string | undefined> => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return resolveApiKey(provider, profile)
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the credential: a configuration surface edits a redacted descriptor
  // and never holds a stored secret, so an already-configured route supplies
  // its own here rather than being interrogated unauthenticated.
  ctx.llm.registerModelDiscovery(NS, request => discoverModels(request, () => storedApiKey(request.provider)))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. Phoenix
  // Local means this adapter always has at least one route even with no user
  // settings or cloud provider configured.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  installSettingsSection(ctx, NS, Config, config, {
    // User-written provider profiles are validated independently. Phoenix
    // Local itself is injected after that validation and cannot be redirected
    // to a non-loopback endpoint by settings.
    validate: assertServiceable,
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      // Named here rather than left to the settings watcher: `assertServiceable`
      // cannot see the llm registry, so a profile claiming a route another
      // adapter family owns is stored successfully and only fails at this swap.
      // Without its own diagnostic that refusal reaches the operator as a
      // generic "settings: watcher failed", naming neither the route nor why it
      // is not serving. The previous routes keep serving either way.
      try {
        ensureRegistrationFacts()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
        ctx.logger.error(error)
      }
      // The directory follows the profiles the registry accepted, so a route
      // that failed to register is not advertised as configurable. A refused
      // directory swap is contained here for the same reason the registry's
      // is: the previous entries keep serving, and `directoryFacts` stays put
      // so returning to a working configuration re-applies.
      try {
        ensureDirectory()
      } catch (error) {
        ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}
