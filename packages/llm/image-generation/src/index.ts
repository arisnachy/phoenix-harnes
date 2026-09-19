/**
 * Provider-neutral image generation capability plus the first Cloudflare
 * provider and the model-facing `image_generate` consumer.
 *
 * The seam deliberately returns durable attachment references rather than
 * remote URLs: generated media survives provider URL expiry, session replay,
 * and client reload through the existing attachment store.
 *
 * @module @phoenix-ai/dsh-image-generation
 */

import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { AttachmentId } from '@phoenix-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@phoenix-ai/dsh-attachment'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import { HarnessError } from '@phoenix-ai/dsh-llm'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'

export const name = 'image-generation'
export const inject = ['attachments', 'credentials', 'systemPrompt', 'tools']

export const AUTO_PROVIDER_ID = 'auto'
export const CLOUDFLARE_PROVIDER_ID = 'cloudflare'
export const AI_HORDE_PROVIDER_ID = 'aihorde'
export const DEFAULT_CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell'
export const DEFAULT_CLOUDFLARE_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN'
export const DEFAULT_AI_HORDE_TOKEN_ENV = 'AIHORDE_API_KEY'
export const AI_HORDE_ANONYMOUS_KEY = '0000000000'
export const DEFAULT_GENERATION_STEPS = 6
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
export const DEFAULT_HORDE_TIMEOUT_MS = 120_000
export const DEFAULT_TOOL_TIMEOUT_MS = 135_000
const CLOUDFLARE_PROMPT_LIMIT = 2_048

/** Provider-neutral request after the consumer has authored the visual prompt. */
export interface ImageGenerationRequest {
  readonly prompt: string
  readonly steps?: number
}

/** Encoded provider result before durable publication in the attachment store. */
export interface ImageGenerationProviderResult {
  readonly data: Uint8Array
  readonly mediaType: ImageMediaType
  readonly model: string
}

/** Replaceable image-generation backend. */
export interface ImageGenerationProvider {
  readonly id: string
  /** Higher values are preferred when provider=auto. */
  readonly priority: number
  available(): boolean
  generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationProviderResult>
}

/** Durable result exposed by the seam. */
export interface ImageGenerationResult {
  readonly image: ImageAttachmentRef
  readonly provider: string
  readonly model: string
}

/** Structured failure used by provider selection and remote generation. */
export class ImageGenerationError extends HarnessError {}

declare module '@phoenix-ai/cordis' {
  interface Context {
    imageGeneration: ImageGenerationRuntime
  }
}

/** Runtime configuration for provider selection and the bundled remote adapters. */
export interface Config {
  /** Provider id selected by the seam. "auto" prefers configured Cloudflare then free anonymous AI Horde. */
  provider?: string
  /** Cloudflare account id. Defaults to CLOUDFLARE_ACCOUNT_ID from the host environment. */
  accountId?: string
  /** Credential reference holding the Workers AI bearer token. */
  apiTokenEnv?: string
  /** Workers AI image model. */
  model?: string
  /** Optional AI Horde credential reference; absence uses the public anonymous key. */
  aihordeApiKeyEnv?: string
  /** Default diffusion steps when the tool does not request fast/high explicitly. */
  steps?: number
  /** Cooperative timeout for one remote HTTP request. */
  requestTimeoutMs?: number
  /** Maximum wall time for an anonymous/registered AI Horde queue job. */
  hordeTimeoutMs?: number
  /** Tool-level timeout budget, slightly larger than the slowest bundled provider. */
  toolTimeoutMs?: number
  /** Add PHOENIX's visual-quality guidance and prompt refinement. */
  visualQualityPolicy?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.string().default(AUTO_PROVIDER_ID),
  accountId: z.string(),
  apiTokenEnv: z.string().role('credential-ref').default(DEFAULT_CLOUDFLARE_TOKEN_ENV),
  model: z.string().default(DEFAULT_CLOUDFLARE_MODEL),
  aihordeApiKeyEnv: z.string().role('credential-ref').default(DEFAULT_AI_HORDE_TOKEN_ENV),
  steps: z.number().step(1).min(1).max(8).default(DEFAULT_GENERATION_STEPS),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  hordeTimeoutMs: z.number().step(1).min(1).default(DEFAULT_HORDE_TIMEOUT_MS),
  toolTimeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
  visualQualityPolicy: z.boolean().default(true),
})

interface ResolvedConfig {
  readonly provider: string
  readonly accountId: string
  readonly apiTokenEnv: string
  readonly model: string
  readonly aihordeApiKeyEnv: string
  readonly steps: number
  readonly requestTimeoutMs: number
  readonly hordeTimeoutMs: number
  readonly toolTimeoutMs: number
  readonly visualQualityPolicy: boolean
}

/**
 * Provider registry and durable-publication seam. Provider selection is
 * resolved on every call, never by registration order.
 */
export class ImageGenerationRuntime extends Service {
  private readonly providers = new Map<string, ImageGenerationProvider>()
  private readonly configuredProvider: string

  constructor(ctx: Context, configuredProvider: string) {
    super(ctx, 'imageGeneration')
    this.configuredProvider = configuredProvider
  }

  /** Register one backend for the lifetime of its Cordis fiber. */
  registerProvider(provider: ImageGenerationProvider): () => void {
    if (provider.id.trim() === '') {
      throw new ImageGenerationError('image provider id must not be empty', 'IMAGE_GENERATION_INVALID_PROVIDER')
    }
    if (this.providers.has(provider.id)) {
      throw new ImageGenerationError(
        `image provider "${provider.id}" is already registered`,
        'IMAGE_GENERATION_DUPLICATE_PROVIDER',
      )
    }
    const providers = this.providers
    const id = provider.id
    const dispose = this.ctx.effect(function* () {
      providers.set(id, provider)
      yield () => providers.delete(id)
    }, 'image-generation.registerProvider()')
    return () => { void dispose() }
  }

  /** Generate and durably publish one image through the selected backend. */
  async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const providers = this.resolveProviders()
    let lastRecoverable: unknown
    for (const provider of providers) {
      signal?.throwIfAborted()
      try {
        const generated = await provider.generate(request, signal)
        signal?.throwIfAborted()
        const extension = generated.mediaType === 'image/jpeg' ? 'jpg'
          : generated.mediaType === 'image/png' ? 'png'
            : generated.mediaType === 'image/webp' ? 'webp' : 'gif'
        const image = await this.ctx.attachments.saveImage({
          data: generated.data,
          mediaType: generated.mediaType,
          name: `phoenix-generated.${extension}`,
        })
        return { image, provider: provider.id, model: generated.model }
      } catch (error) {
        if (signal?.aborted === true) throw signal.reason ?? error
        if (this.configuredProvider !== AUTO_PROVIDER_ID || !isRecoverableProviderError(error)) throw error
        lastRecoverable = error
      }
    }
    throw new ImageGenerationError(
      'all automatic image providers failed; configure Cloudflare or retry the free community provider later',
      'IMAGE_GENERATION_PROVIDER_FALLBACK_EXHAUSTED',
      { cause: lastRecoverable },
    )
  }

  private resolveProviders(): ImageGenerationProvider[] {
    if (this.configuredProvider !== AUTO_PROVIDER_ID) {
      const selected = this.providers.get(this.configuredProvider)
      if (selected === undefined) {
        throw new ImageGenerationError(
          `configured image provider "${this.configuredProvider}" is not registered`,
          'IMAGE_GENERATION_PROVIDER_MISSING',
        )
      }
      if (!selected.available()) {
        throw new ImageGenerationError(
          `configured image provider "${this.configuredProvider}" is not available`,
          'IMAGE_GENERATION_PROVIDER_UNAVAILABLE',
        )
      }
      return [selected]
    }
    const usable = [...this.providers.values()]
      .filter(provider => provider.available())
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    if (usable.length === 0) {
      throw new ImageGenerationError('no image generation provider is available', 'IMAGE_GENERATION_PROVIDER_UNAVAILABLE')
    }
    return usable
  }
}

const RECOVERABLE_PROVIDER_CODES = new Set([
  'IMAGE_GENERATION_AUTH',
  'IMAGE_GENERATION_QUOTA',
  'IMAGE_GENERATION_RATE_LIMIT',
  'IMAGE_GENERATION_TIMEOUT',
  'IMAGE_GENERATION_TRANSIENT',
  'IMAGE_GENERATION_PROVIDER_UNAVAILABLE',
])

function isRecoverableProviderError(error: unknown): boolean {
  return error instanceof ImageGenerationError && RECOVERABLE_PROVIDER_CODES.has(error.code)
}

/** Compact visual-quality suffix that preserves the user's requested style. */
const QUALITY_SUFFIX = [
  'Professional art direction.',
  'Intentional composition, coherent palette, refined lighting and materials, polished finish.',
  'No accidental text or watermark.',
  'Do not add a phoenix, bird, turkey, mascot, logo, UI chrome, or clip-art merely because the product is named PHOENIX; include those only when the request explicitly asks for them.',
].join(' ')

/**
 * Turn a literal user/model description into a production-oriented image
 * prompt without changing the requested subject or style.
 */
export function buildVisualPrompt(prompt: string, purpose?: string): string {
  const base = prompt.trim()
  if (base === '') throw new ImageGenerationError('image prompt must not be empty', 'IMAGE_GENERATION_INVALID_PROMPT')
  const purposeText = purpose?.trim().slice(0, 160)
  const prefix = purposeText ? `Intended use: ${purposeText}. ` : ''
  const separator = base.endsWith('.') ? ' ' : '. '
  const reserve = prefix.length + separator.length + QUALITY_SUFFIX.length
  const kept = base.slice(0, Math.max(1, CLOUDFLARE_PROMPT_LIMIT - reserve))
  return `${prefix}${kept}${separator}${QUALITY_SUFFIX}`
}

/** Narrow a Cloudflare Workers AI envelope to the base64 image payload. */
export function parseCloudflareImagePayload(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ImageGenerationError('Cloudflare returned an invalid image response', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
  }
  const result = (payload as { result?: unknown }).result
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new ImageGenerationError('Cloudflare response did not contain an image result', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
  }
  const image = (result as { image?: unknown }).image
  if (typeof image !== 'string' || image.length === 0) {
    throw new ImageGenerationError('Cloudflare response did not contain image bytes', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
  }
  return image
}

function positiveInteger(value: number, field: string, max?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (max !== undefined && value > max)) {
    const suffix = max === undefined ? '' : ` and no greater than ${max}`
    throw new Error(`image-generation: ${field} must be a positive integer${suffix}`)
  }
  return value
}

function resolveConfig(config: Config): ResolvedConfig {
  const provider = config.provider?.trim() || AUTO_PROVIDER_ID
  const accountId = config.accountId?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || ''
  const apiTokenEnv = config.apiTokenEnv?.trim() || DEFAULT_CLOUDFLARE_TOKEN_ENV
  const model = config.model?.trim() || DEFAULT_CLOUDFLARE_MODEL
  const aihordeApiKeyEnv = config.aihordeApiKeyEnv?.trim() || DEFAULT_AI_HORDE_TOKEN_ENV
  return {
    provider,
    accountId,
    apiTokenEnv,
    model,
    aihordeApiKeyEnv,
    steps: positiveInteger(config.steps ?? DEFAULT_GENERATION_STEPS, 'steps', 8),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs'),
    hordeTimeoutMs: positiveInteger(config.hordeTimeoutMs ?? DEFAULT_HORDE_TIMEOUT_MS, 'hordeTimeoutMs'),
    toolTimeoutMs: positiveInteger(config.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS, 'toolTimeoutMs'),
    visualQualityPolicy: config.visualQualityPolicy ?? true,
  }
}

function cloudflareErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'IMAGE_GENERATION_AUTH'
  if (status === 429) return 'IMAGE_GENERATION_RATE_LIMIT'
  if (status === 402) return 'IMAGE_GENERATION_QUOTA'
  if (status >= 500) return 'IMAGE_GENERATION_TRANSIENT'
  return 'IMAGE_GENERATION_PROVIDER_FAILURE'
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new ImageGenerationError('image generation provider timed out', 'IMAGE_GENERATION_TIMEOUT'))
  }, timeoutMs)
  const onAbort = (): void => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

class CloudflareImageProvider implements ImageGenerationProvider {
  readonly id = CLOUDFLARE_PROVIDER_ID
  readonly priority = 100

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  available(): boolean {
    return this.config.accountId !== ''
  }

  async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationProviderResult> {
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.apiTokenEnv))
    if (credential === undefined || credential.value.trim() === '') {
      throw new ImageGenerationError(
        `Cloudflare image generation needs credential ${this.config.apiTokenEnv}`,
        'IMAGE_GENERATION_AUTH',
      )
    }
    const steps = positiveInteger(request.steps ?? this.config.steps, 'request.steps', 8)
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/ai/run/${this.config.model}`
    let response: Response
    try {
      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential.value}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt: request.prompt, steps }),
      }, this.config.requestTimeoutMs, signal)
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason ?? error
      if (error instanceof ImageGenerationError) throw error
      throw new ImageGenerationError(
        'Cloudflare image generation request failed',
        'IMAGE_GENERATION_TRANSIENT',
        { cause: error },
      )
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)
      throw new ImageGenerationError(
        `Cloudflare image generation failed with HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
        cloudflareErrorCode(response.status),
      )
    }
    const payload: unknown = await response.json()
    const base64 = parseCloudflareImagePayload(payload)
    const data = new Uint8Array(Buffer.from(base64, 'base64'))
    if (data.byteLength === 0) {
      throw new ImageGenerationError('Cloudflare returned empty image bytes', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
    }
    return { data, mediaType: 'image/jpeg', model: this.config.model }
  }
}

interface AIHordeAsyncResponse {
  id?: unknown
  message?: unknown
  rc?: unknown
}

interface AIHordeCheckResponse {
  done?: unknown
  faulted?: unknown
  is_possible?: unknown
  message?: unknown
  rc?: unknown
}

interface AIHordeGeneration {
  img?: unknown
  model?: unknown
  state?: unknown
  censored?: unknown
}

interface AIHordeStatusResponse {
  generations?: unknown
  message?: unknown
  rc?: unknown
}

function jsonRecord(value: unknown, provider: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ImageGenerationError(
      `${provider} returned an invalid JSON response`,
      'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE',
    )
  }
  return value as Record<string, unknown>
}

function providerMessage(value: Record<string, unknown>): string {
  return typeof value.message === 'string' && value.message.trim() !== '' ? value.message.trim() : 'unknown provider error'
}

function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

class AIHordeImageProvider implements ImageGenerationProvider {
  readonly id = AI_HORDE_PROVIDER_ID
  readonly priority = 10
  private readonly baseURL = 'https://aihorde.net/api/v2/generate'

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  available(): boolean {
    return true
  }

  async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationProviderResult> {
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.aihordeApiKeyEnv))
    const apiKey = credential?.value.trim() || AI_HORDE_ANONYMOUS_KEY
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      apikey: apiKey,
      'Client-Agent': 'PhoenixAI:0.1:https://github.com/arisnachy/phoenix-harnes',
    }
    const hordeSteps = Math.min(32, Math.max(16, (request.steps ?? this.config.steps) * 4))
    const created = await this.requestJson(`${this.baseURL}/async`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: request.prompt,
        params: {
          n: 1,
          width: 1024,
          height: 1024,
          steps: hordeSteps,
          cfg_scale: 6,
          sampler_name: 'k_euler_a',
          karras: true,
          post_processing: [],
        },
        allow_downgrade: true,
        nsfw: false,
        censor_nsfw: true,
        r2: false,
        shared: false,
        slow_workers: true,
      }),
    }, signal) as AIHordeAsyncResponse
    const createdRecord = jsonRecord(created, 'AI Horde')
    if (createdRecord.rc !== undefined) {
      throw new ImageGenerationError(
        `AI Horde rejected image generation: ${providerMessage(createdRecord)}`,
        'IMAGE_GENERATION_PROVIDER_FAILURE',
      )
    }
    const id = createdRecord.id
    if (typeof id !== 'string' || id.length === 0) {
      throw new ImageGenerationError('AI Horde did not return a generation id', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
    }

    const deadline = Date.now() + this.config.hordeTimeoutMs
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      const check = await this.requestJson(`${this.baseURL}/check/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { accept: 'application/json', 'Client-Agent': headers['Client-Agent'] },
      }, signal) as AIHordeCheckResponse
      const checkRecord = jsonRecord(check, 'AI Horde')
      if (checkRecord.rc !== undefined) {
        throw new ImageGenerationError(
          `AI Horde status check failed: ${providerMessage(checkRecord)}`,
          'IMAGE_GENERATION_TRANSIENT',
        )
      }
      if (checkRecord.faulted === true || checkRecord.is_possible === false) {
        throw new ImageGenerationError('AI Horde could not fulfill this image request', 'IMAGE_GENERATION_PROVIDER_UNAVAILABLE')
      }
      if (checkRecord.done === true) {
        return this.readCompleted(id, headers['Client-Agent'], signal)
      }
      await cancellableDelay(2_000, signal)
    }

    void fetch(`${this.baseURL}/status/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { accept: 'application/json', 'Client-Agent': headers['Client-Agent'] },
    }).catch(() => undefined)
    throw new ImageGenerationError(
      'AI Horde image generation exceeded the queue timeout',
      'IMAGE_GENERATION_TIMEOUT',
    )
  }

  private async readCompleted(id: string, clientAgent: string, signal?: AbortSignal): Promise<ImageGenerationProviderResult> {
    const status = await this.requestJson(`${this.baseURL}/status/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { accept: 'application/json', 'Client-Agent': clientAgent },
    }, signal) as AIHordeStatusResponse
    const statusRecord = jsonRecord(status, 'AI Horde')
    if (statusRecord.rc !== undefined) {
      throw new ImageGenerationError(
        `AI Horde result retrieval failed: ${providerMessage(statusRecord)}`,
        'IMAGE_GENERATION_TRANSIENT',
      )
    }
    if (!Array.isArray(statusRecord.generations) || statusRecord.generations.length === 0) {
      throw new ImageGenerationError('AI Horde returned no generated image', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
    }
    const generation = jsonRecord(statusRecord.generations[0], 'AI Horde') as AIHordeGeneration & Record<string, unknown>
    if (generation.state !== undefined && generation.state !== 'ok') {
      throw new ImageGenerationError('AI Horde generation did not complete successfully', 'IMAGE_GENERATION_PROVIDER_FAILURE')
    }
    if (generation.censored === true) {
      throw new ImageGenerationError('AI Horde censored the generated image', 'IMAGE_GENERATION_PROVIDER_FAILURE')
    }
    if (typeof generation.img !== 'string' || generation.img.length === 0 || /^https?:\/\//i.test(generation.img)) {
      throw new ImageGenerationError(
        'AI Horde did not return the expected inline WebP image',
        'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE',
      )
    }
    const data = new Uint8Array(Buffer.from(generation.img, 'base64'))
    if (data.byteLength === 0) {
      throw new ImageGenerationError('AI Horde returned empty image bytes', 'IMAGE_GENERATION_PROVIDER_INVALID_RESPONSE')
    }
    const model = typeof generation.model === 'string' && generation.model.trim() !== ''
      ? generation.model
      : 'AI Horde community worker'
    return { data, mediaType: 'image/webp', model }
  }

  private async requestJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await fetchWithTimeout(url, init, this.config.requestTimeoutMs, signal)
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason ?? error
      if (error instanceof ImageGenerationError) throw error
      throw new ImageGenerationError('AI Horde request failed', 'IMAGE_GENERATION_TRANSIENT', { cause: error })
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)
      const code = response.status === 429 ? 'IMAGE_GENERATION_RATE_LIMIT'
        : response.status >= 500 ? 'IMAGE_GENERATION_TRANSIENT'
          : response.status === 401 || response.status === 403 ? 'IMAGE_GENERATION_AUTH'
            : 'IMAGE_GENERATION_PROVIDER_FAILURE'
      throw new ImageGenerationError(
        `AI Horde request failed with HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
        code,
      )
    }
    return response.json() as Promise<unknown>
  }
}

interface ProjectedImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number; height: number }
}

function projectImage(ref: ImageAttachmentRef): ProjectedImage {
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
    ...ref.originalDimensions === undefined ? {} : { originalDimensions: ref.originalDimensions },
  }
}

function restoreImage(value: ProjectedImage): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(value.attachmentId),
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...value.name === undefined ? {} : { name: value.name },
    ...value.originalDimensions === undefined ? {} : { originalDimensions: value.originalDimensions },
  }
}

function presentImageCall(args: { prompt: string; purpose?: string; quality?: 'fast' | 'high' }): GenericCallView {
  return {
    card: 'generic',
    title: 'Generating image',
    kind: 'other',
    rawInput: args.purpose?.trim() || args.prompt,
  }
}

function registerTool(ctx: Context, config: ResolvedConfig): void {
  if (config.visualQualityPolicy) {
    ctx.systemPrompt.section({
      name: 'tool:image_generate',
      order: 116,
      text: [
        'Use image_generate when the requested deliverable needs original visual artwork, a hero/splash/background image, concept art, or another aesthetic image where visual quality matters.',
        'Do not substitute crude decorative SVG, CSS shapes, emoji, ASCII art, clip-art, or an arbitrary mascot for requested artwork.',
        'Use SVG/primitives only when the user actually asks for a vector, icon, logo, diagram, chart, or shape-based asset.',
        'For image_generate, describe the intended use plus the subject, composition, palette, lighting/material treatment, and requested style. Prefer coherent premium-looking results over generic filler.',
        'Do not infer that PHOENIX means the image needs a bird, phoenix, turkey, flame mascot, or logo. Add those only when the user explicitly requests them.',
        'If image generation is unavailable after provider fallback, report the real generation failure instead of faking the requested artwork with low-quality primitives.',
      ].join(' '),
    })
  }

  ctx.tools.register(defineTool({
    name: 'image_generate',
    description: 'Generate one polished image from a text description and store it durably in PHOENIX. Use for aesthetic artwork and product visuals, not charts or ordinary vector diagrams.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The requested image subject and visual direction.',
      },
      purpose: {
        type: 'string',
        description: 'Where the image will be used, such as splash screen, hero, background, illustration, or concept art.',
      },
      quality: {
        type: 'string',
        enum: ['fast', 'high'],
        description: 'Optional generation quality. fast uses 4 steps; high uses 8. Omit to use the deployment default.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          image: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
              originalDimensions: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                },
              },
            },
          },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Generated image with ${value.provider} / ${value.model}.` },
        { type: 'image', attachment: restoreImage(value.image as ProjectedImage) },
      ],
    },
    timeoutMs: config.toolTimeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const purpose = args.purpose?.trim()
      const prompt = config.visualQualityPolicy
        ? buildVisualPrompt(args.prompt, purpose)
        : args.prompt.trim()
      if (prompt === '') {
        throw new ImageGenerationError('image prompt must not be empty', 'IMAGE_GENERATION_INVALID_PROMPT')
      }
      const steps = args.quality === 'fast' ? 4 : args.quality === 'high' ? 8 : config.steps
      const result = await ctx.imageGeneration.generate({ prompt, steps }, exec.signal)
      return {
        image: projectImage(result.image),
        provider: result.provider,
        model: result.model,
      }
    },
    presentCall: presentImageCall,
  }))
}

/**
 * Mount the provider-neutral runtime, Cloudflare backend, visual-quality
 * guidance, and model-facing tool as one single-purpose capability package.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const runtime = new ImageGenerationRuntime(ctx, resolved.provider)
  runtime.registerProvider(new CloudflareImageProvider(ctx, resolved))
  runtime.registerProvider(new AIHordeImageProvider(ctx, resolved))
  registerTool(ctx, resolved)
}

export default apply
