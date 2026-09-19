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

export const CLOUDFLARE_PROVIDER_ID = 'cloudflare'
export const DEFAULT_CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell'
export const DEFAULT_CLOUDFLARE_TOKEN_ENV = 'CLOUDFLARE_API_TOKEN'
export const DEFAULT_GENERATION_STEPS = 6
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
export const DEFAULT_TOOL_TIMEOUT_MS = 90_000
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

/** Runtime configuration for provider selection and the bundled Cloudflare adapter. */
export interface Config {
  /** Provider id selected by the seam. Defaults to cloudflare. */
  provider?: string
  /** Cloudflare account id. Defaults to CLOUDFLARE_ACCOUNT_ID from the host environment. */
  accountId?: string
  /** Credential reference holding the Workers AI bearer token. */
  apiTokenEnv?: string
  /** Workers AI image model. */
  model?: string
  /** Default diffusion steps when the tool does not request fast/high explicitly. */
  steps?: number
  /** Cooperative network timeout for the provider request. */
  requestTimeoutMs?: number
  /** Tool-level timeout budget, slightly larger than the provider timeout. */
  toolTimeoutMs?: number
  /** Add PHOENIX's visual-quality guidance and prompt refinement. */
  visualQualityPolicy?: boolean
}

export const Config: z<Config> = z.object({
  provider: z.string().default(CLOUDFLARE_PROVIDER_ID),
  accountId: z.string(),
  apiTokenEnv: z.string().role('credential-ref').default(DEFAULT_CLOUDFLARE_TOKEN_ENV),
  model: z.string().default(DEFAULT_CLOUDFLARE_MODEL),
  steps: z.number().step(1).min(1).max(8).default(DEFAULT_GENERATION_STEPS),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  toolTimeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
  visualQualityPolicy: z.boolean().default(true),
})

interface ResolvedConfig {
  readonly provider: string
  readonly accountId: string
  readonly apiTokenEnv: string
  readonly model: string
  readonly steps: number
  readonly requestTimeoutMs: number
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
    const provider = this.resolveProvider()
    signal?.throwIfAborted()
    const generated = await provider.generate(request, signal)
    signal?.throwIfAborted()
    const image = await this.ctx.attachments.saveImage({
      data: generated.data,
      mediaType: generated.mediaType,
      name: 'phoenix-generated.jpg',
    })
    return { image, provider: provider.id, model: generated.model }
  }

  private resolveProvider(): ImageGenerationProvider {
    const selected = this.providers.get(this.configuredProvider)
    if (selected === undefined) {
      throw new ImageGenerationError(
        `configured image provider "${this.configuredProvider}" is not registered`,
        'IMAGE_GENERATION_PROVIDER_MISSING',
      )
    }
    if (!selected.available()) {
      throw new ImageGenerationError(
        `configured image provider "${this.configuredProvider}" is not available; configure its account before generating images`,
        'IMAGE_GENERATION_PROVIDER_UNAVAILABLE',
      )
    }
    return selected
  }
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
  const provider = config.provider?.trim() || CLOUDFLARE_PROVIDER_ID
  const accountId = config.accountId?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || ''
  const apiTokenEnv = config.apiTokenEnv?.trim() || DEFAULT_CLOUDFLARE_TOKEN_ENV
  const model = config.model?.trim() || DEFAULT_CLOUDFLARE_MODEL
  return {
    provider,
    accountId,
    apiTokenEnv,
    model,
    steps: positiveInteger(config.steps ?? DEFAULT_GENERATION_STEPS, 'steps', 8),
    requestTimeoutMs: positiveInteger(config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs'),
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

interface ProjectedImage {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

function projectImage(ref: ImageAttachmentRef): ProjectedImage {
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...ref.name === undefined ? {} : { name: ref.name },
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
        'If image generation is unavailable, report that provider connection is needed instead of faking the requested artwork with low-quality primitives.',
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
  registerTool(ctx, resolved)
}

export default apply
