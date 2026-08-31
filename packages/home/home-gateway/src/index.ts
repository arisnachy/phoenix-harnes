/**
 * Home Assistant-backed smart-home capability for PHOENIX. The service exposes
 * only entities and service calls explicitly allowlisted by the deployment;
 * it never discovers or controls arbitrary LAN targets.
 * @module @phoenix-ai/dsh-home-gateway
 */

import { HarnessError } from '@phoenix-ai/dsh-llm'
import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type { JsonValue } from '@phoenix-ai/dsh-session'

/** Default Home Assistant REST API endpoint. */
export const DEFAULT_HOME_ASSISTANT_URL = 'http://homeassistant.local:8123'

/** Default environment variable holding the Home Assistant long-lived token. */
export const DEFAULT_HOME_ASSISTANT_TOKEN_ENV = 'HOME_ASSISTANT_TOKEN'

/** Default per-request network timeout. */
export const DEFAULT_HOME_ASSISTANT_TIMEOUT_MS = 10_000

/** Configuration resolved by the plugin before it constructs the service. */
export interface HomeAssistantConfig {
  readonly baseUrl: string
  readonly tokenEnv: string
  readonly allowedEntities: readonly string[]
  readonly allowedServices: readonly string[]
  readonly requestTimeoutMs: number
}

/** User-facing plugin configuration; defaults are completed by Schemastery. */
export interface Config {
  /** Private or local Home Assistant base URL. */
  readonly baseUrl?: string
  /** Environment variable containing the long-lived Home Assistant token. */
  readonly tokenEnv?: string
  /** Entity ids that state reads may return and control calls may target. */
  readonly allowedEntities?: string[]
  /** Fully qualified service names permitted for control calls. */
  readonly allowedServices?: string[]
  /** Maximum duration of one Home Assistant HTTP request. */
  readonly requestTimeoutMs?: number
}

/** One Home Assistant entity projected without provider-specific control data. */
export interface HomeDevice {
  readonly entityId: string
  readonly state: string
  readonly attributes: Record<string, JsonValue>
}

/** A model-requested service operation over an allowlisted entity. */
export interface HomeControlRequest {
  readonly entityId: string
  readonly service: string
  readonly data: Record<string, JsonValue>
}

/** Bounded result of one approved service operation. */
export interface HomeControlResult {
  readonly entityId: string
  readonly service: string
  readonly status: number
  readonly succeeded: boolean
}

/** Machine-routable Home Assistant failure. */
export class HomeGatewayError extends HarnessError {}

/** HTTP seams kept injectable so capability tests never need a real token. */
export interface HomeAssistantDependencies {
  readonly token: string | (() => string)
  readonly fetch?: typeof fetch
}

function privateHomeHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return true
  if (hostname.endsWith('.local') || !hostname.includes('.')) return true
  if (/^10\./u.test(hostname) || /^192\.168\./u.test(hostname)) return true
  const octets = hostname.split('.').map(Number)
  const first = octets[0]
  const second = octets[1]
  return octets.length === 4 && octets.every(Number.isInteger) && first === 172
    && second !== undefined && second >= 16 && second <= 31
}

/**
 * Validate and normalize a Home Assistant deployment configuration.
 * @param config - endpoint, token reference, allowlists, and timeout settings.
 * @returns normalized configuration with deduplicated allowlists.
 */
export function resolveHomeAssistantConfig(config: HomeAssistantConfig): HomeAssistantConfig {
  let url: URL
  try {
    url = new URL(config.baseUrl)
  } catch {
    throw new Error('home-gateway: baseUrl must be a valid private home endpoint')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !privateHomeHost(url.hostname)
    || url.username !== '' || url.password !== '') {
    throw new Error('home-gateway: baseUrl must be a private home endpoint without embedded credentials')
  }
  if (config.tokenEnv.trim() === '') throw new Error('home-gateway: tokenEnv must be non-empty')
  if (config.allowedEntities.length === 0) throw new Error('home-gateway: allowedEntities must contain at least one entity')
  if (config.allowedServices.length === 0) throw new Error('home-gateway: allowedServices must contain at least one service')
  if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1) {
    throw new Error('home-gateway: requestTimeoutMs must be a positive integer')
  }
  return {
    ...config,
    baseUrl: config.baseUrl.replace(/\/+$/u, ''),
    tokenEnv: config.tokenEnv.trim(),
    allowedEntities: [...new Set(config.allowedEntities)],
    allowedServices: [...new Set(config.allowedServices)],
  }
}

function tokenValue(token: string | (() => string)): string {
  const value = typeof token === 'function' ? token() : token
  if (value.trim() === '') throw new HomeGatewayError('Home Assistant token is not configured', 'HOME_TOKEN_MISSING')
  return value
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HomeGatewayError(`Home Assistant returned invalid ${label}`, 'HOME_INVALID_RESPONSE')
  }
  return value as Record<string, unknown>
}

function asJsonRecord(value: unknown, label: string): Record<string, JsonValue> {
  const record = asRecord(value, label)
  return record as Record<string, JsonValue>
}

/** Host-side Home Assistant REST client enforcing entity and service allowlists. */
export class HomeAssistantGateway {
  private readonly config: HomeAssistantConfig
  private readonly dependencies: HomeAssistantDependencies

  /**
   * @param config - validated private endpoint and explicit allowlists.
   * @param dependencies - token and HTTP seams.
   */
  constructor(config: HomeAssistantConfig, dependencies: HomeAssistantDependencies) {
    this.config = resolveHomeAssistantConfig(config)
    this.dependencies = dependencies
  }

  /**
   * List the allowlisted entity states from Home Assistant.
   * @param signal - optional cancellation signal.
   * @returns allowlisted entity states.
   */
  async listDevices(signal?: AbortSignal): Promise<readonly HomeDevice[]> {
    const value = await this.request('/api/states', 'GET', undefined, signal)
    if (!Array.isArray(value)) throw new HomeGatewayError('Home Assistant returned an invalid state list', 'HOME_INVALID_RESPONSE')
    const allowed = new Set(this.config.allowedEntities)
    return value.flatMap((entry): HomeDevice[] => {
      const record = asRecord(entry, 'entity state')
      const entityId = record.entity_id
      const state = record.state
      if (typeof entityId !== 'string' || typeof state !== 'string' || !allowed.has(entityId)) return []
      return [{ entityId, state, attributes: asJsonRecord(record.attributes ?? {}, 'entity attributes') }]
    })
  }

  /**
   * Invoke one allowlisted Home Assistant service for one allowlisted entity.
   * @param request - allowlisted entity and service request.
   * @param signal - optional cancellation signal.
   * @returns the service outcome.
   */
  async control(request: HomeControlRequest, signal?: AbortSignal): Promise<HomeControlResult> {
    const entityDomain = request.entityId.split('.')[0]
    if (entityDomain === undefined || entityDomain === '') {
      throw new HomeGatewayError(`entity "${request.entityId}" is not allowlisted`, 'HOME_ENTITY_DENIED')
    }
    const service = `${entityDomain}.${request.service}`
    if (!this.config.allowedEntities.includes(request.entityId)) {
      throw new HomeGatewayError(`entity "${request.entityId}" is not allowlisted`, 'HOME_ENTITY_DENIED')
    }
    if (!this.config.allowedServices.includes(service)) {
      throw new HomeGatewayError(`service "${service}" is not allowlisted`, 'HOME_SERVICE_DENIED')
    }
    const value = await this.request(`/api/services/${encodeURIComponent(entityDomain)}/${encodeURIComponent(request.service)}`, 'POST', {
      entity_id: request.entityId,
      ...request.data,
    }, signal)
    return {
      entityId: request.entityId,
      service,
      status: 200,
      succeeded: Array.isArray(value),
    }
  }

  private async request(path: string, method: 'GET' | 'POST', body: Record<string, JsonValue> | undefined, signal?: AbortSignal): Promise<unknown> {
    const response = await (this.dependencies.fetch ?? fetch)(new URL(path, `${this.config.baseUrl}/`), {
      method,
      headers: {
        authorization: `Bearer ${tokenValue(this.dependencies.token)}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      signal: signal ?? AbortSignal.timeout(this.config.requestTimeoutMs),
    })
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new HomeGatewayError(`Home Assistant returned HTTP ${String(response.status)}`, 'HOME_HTTP_ERROR')
    }
    if (!response.ok) throw new HomeGatewayError(`Home Assistant returned HTTP ${String(response.status)}`, 'HOME_HTTP_ERROR')
    return value
  }
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    home: HomeAssistantGatewayService
  }
}

/** Cordis service owner for the Home Assistant gateway. */
export class HomeAssistantGatewayService extends Service {
  static Config: z<Config> = z.object({
    baseUrl: z.string().default(DEFAULT_HOME_ASSISTANT_URL),
    tokenEnv: z.string().default(DEFAULT_HOME_ASSISTANT_TOKEN_ENV),
    allowedEntities: z.array(z.string()).default([]),
    allowedServices: z.array(z.string()).default([]),
    requestTimeoutMs: z.number().default(DEFAULT_HOME_ASSISTANT_TIMEOUT_MS),
  })

  private readonly gateway: HomeAssistantGateway

  /**
   * @param ctx - owning Cordis context.
   * @param config - Schemastery-resolved gateway configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'home')
    const resolved = config as Required<Config>
    const normalized = resolveHomeAssistantConfig(resolved)
    this.gateway = new HomeAssistantGateway(normalized, { token: () => process.env[normalized.tokenEnv] ?? '' })
  }

  /**
   * List allowlisted device states and honor cancellation from the requesting tool.
   * @param signal - cancellation signal from the requesting tool.
   * @returns allowlisted device states.
   */
  listDevices(signal?: AbortSignal): Promise<readonly HomeDevice[]> {
    return this.gateway.listDevices(signal)
  }

  /**
   * Invoke one allowlisted service and honor cancellation from the requesting tool.
   * @param request - allowlisted entity/service request.
   * @param signal - cancellation signal from the requesting tool.
   * @returns the service outcome.
   */
  control(request: HomeControlRequest, signal?: AbortSignal): Promise<HomeControlResult> {
    return this.gateway.control(request, signal)
  }
}

export default HomeAssistantGatewayService
