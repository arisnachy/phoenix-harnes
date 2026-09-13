/**
 * Model-facing text-to-image generation through the official Codex subagent
 * provider. Codex owns generation; Phoenix owns filesystem validation,
 * attachment admission, persistence, and the durable image block.
 * @module @phoenix-ai/dsh-tool-image-generation-codex
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { mkdir, mkdtemp, lstat, readFile, readdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ImageAttachmentRef, ImageMediaType } from '@phoenix-ai/dsh-attachment'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@phoenix-ai/dsh-subagent'
import { defineTool } from '@phoenix-ai/dsh-tools'

export const name = 'tool-image-generation-codex'
export const inject = ['tools', 'subagents', 'attachments']

const DEFAULT_PROVIDER = 'codex'
const DEFAULT_TOOL_NAME = 'image_generation'
const MANIFEST_NAME = 'manifest.json'
const MAX_MANIFEST_BYTES = 4 * 1024
const GENERATED_ROOT = ['.phoenix', 'generated-images'] as const
const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** Loader configuration. Direct `apply()` callers receive the same defaults. */
export interface Config {
  /** Registered subagent provider used for image generation. */
  provider?: string
  /** Model-facing tool name. */
  toolName?: string
}

export const Config: z<Config> = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  toolName: z.string().default(DEFAULT_TOOL_NAME),
})

/** Stable public failure prefix for every unavailable/invalid generation path. */
export const IMAGE_GENERATION_UNAVAILABLE = 'IMAGE_GENERATION_UNAVAILABLE'

class ImageGenerationUnavailableError extends Error {
  constructor(message: string) {
    super(`${IMAGE_GENERATION_UNAVAILABLE}: ${message}`)
    this.name = 'ImageGenerationUnavailableError'
  }
}

/** Normalize a host path to the slash form used in model prompts and results. */
function portablePath(value: string): string {
  return value.split(path.sep).join('/')
}

/** Keep one tool call identity readable while making it safe as an mkdtemp prefix. */
function safeCallPrefix(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '')
  return (normalized.length === 0 ? 'image' : normalized).slice(0, 64)
}

/**
 * Build the complete standalone Codex instruction. The child gets no parent
 * conversation, so the requested visual plus the complete output contract are
 * included here. The path is workspace-relative by construction.
 */
export function buildCodexImagePrompt(userPrompt: string, outputDirRelative: string): string {
  return [
    'Use your built-in image generation capability to create exactly one new raster image for the request below.',
    'Do not call an external image API. Do not download an existing image from the web. Do not substitute SVG, HTML, or text art.',
    `PHOENIX_OUTPUT_DIR=${portablePath(outputDirRelative)}`,
    `Inside that directory write exactly two files: ${MANIFEST_NAME} and one raster image (.png, .jpg/.jpeg, .webp, or .gif).`,
    `The manifest must be strict JSON: {"file":"<basename>","mediaType":"image/png|image/jpeg|image/webp|image/gif"}.`,
    'The manifest file value must be a basename only, with no directory separators. Do not write any other files or directories there.',
    'Finish only after the image and manifest are fully written. Your final assistant text must be exactly IMAGE_READY.',
    '',
    'IMAGE REQUEST:',
    userPrompt,
  ].join('\n')
}

interface Manifest {
  file: string
  mediaType: ImageMediaType
}

/** Resolve the media type implied by one permitted raster extension. */
function extensionMediaType(filename: string): ImageMediaType | undefined {
  switch (path.extname(filename).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
}

/** Parse the intentionally tiny manifest without accepting extra semantics. */
export function parseImageManifest(text: string): Manifest {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new ImageGenerationUnavailableError('Codex returned an invalid image manifest.')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ImageGenerationUnavailableError('Codex returned an invalid image manifest.')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== 'file' || keys[1] !== 'mediaType') {
    throw new ImageGenerationUnavailableError('Codex returned an invalid image manifest.')
  }
  if (typeof record.file !== 'string' || record.file.length === 0 || record.file !== path.basename(record.file)) {
    throw new ImageGenerationUnavailableError('Codex image manifest contains an unsafe file path.')
  }
  if (record.file.includes('/') || record.file.includes('\\')) {
    throw new ImageGenerationUnavailableError('Codex image manifest contains an unsafe file path.')
  }
  if (
    record.mediaType !== 'image/png'
    && record.mediaType !== 'image/jpeg'
    && record.mediaType !== 'image/webp'
    && record.mediaType !== 'image/gif'
  ) {
    throw new ImageGenerationUnavailableError('Codex image manifest declares an unsupported media type.')
  }
  const extensionType = extensionMediaType(record.file)
  if (extensionType === undefined || extensionType !== record.mediaType) {
    throw new ImageGenerationUnavailableError('Codex image filename and media type disagree.')
  }
  return { file: record.file, mediaType: record.mediaType }
}

/** Await one foreground run and release its process before trusting workspace output. */
async function settleAndDispose(run: SubagentRun): Promise<SubagentResult> {
  const execution = await Promise.allSettled([run.result])
  const disposal = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  const result = execution[0]
  const disposed = disposal[0]
  if (result?.status === 'rejected' || disposed?.status === 'rejected') {
    throw new ImageGenerationUnavailableError('Codex image generation did not settle cleanly.')
  }
  if (result === undefined || result.status !== 'fulfilled') {
    throw new ImageGenerationUnavailableError('Codex image generation did not return a result.')
  }
  return result.value
}

/** Require a successful child completion; partial output is never publication authority. */
function requireCompleted(result: SubagentResult): void {
  if (result.stopReason !== 'completed') {
    throw new ImageGenerationUnavailableError(`Codex image generation ended before completion (${String(result.stopReason)}).`)
  }
}

interface OutputDirectory {
  absolute: string
  relative: string
}

/** Mint one empty, call-owned workspace directory without reusing stale output. */
async function createOutputDirectory(cwd: string, callId: string): Promise<OutputDirectory> {
  const base = path.resolve(cwd, ...GENERATED_ROOT)
  await mkdir(base, { recursive: true })
  const absolute = await mkdtemp(path.join(base, `${safeCallPrefix(callId)}-`))
  const relative = portablePath(path.relative(cwd, absolute))
  if (relative.length === 0 || relative.startsWith('../') || path.isAbsolute(relative)) {
    await rm(absolute, { recursive: true, force: true })
    throw new ImageGenerationUnavailableError('Phoenix could not mint a safe image output directory.')
  }
  return { absolute, relative }
}

/** Read and validate exactly one quiescent raster from the call-owned directory. */
async function readGeneratedImage(
  output: OutputDirectory,
  acceptedMediaTypes: readonly ImageMediaType[],
  maxBytes: number,
  signal: AbortSignal,
): Promise<{ data: Uint8Array; mediaType: ImageMediaType; name: string; path: string }> {
  signal.throwIfAborted()
  const entries = await readdir(output.absolute, { withFileTypes: true })
  const unexpected = entries.filter(entry => entry.name !== MANIFEST_NAME && !RASTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
  if (unexpected.length > 0) {
    throw new ImageGenerationUnavailableError('Codex wrote unexpected files into the image output directory.')
  }
  const rasters = entries.filter(entry => RASTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
  if (rasters.length !== 1) {
    throw new ImageGenerationUnavailableError('Codex must produce exactly one raster image.')
  }
  const manifestEntry = entries.find(entry => entry.name === MANIFEST_NAME)
  if (manifestEntry === undefined || !manifestEntry.isFile() || manifestEntry.isSymbolicLink()) {
    throw new ImageGenerationUnavailableError('Codex did not produce a regular image manifest.')
  }
  const manifestPath = path.join(output.absolute, MANIFEST_NAME)
  const manifestStat = await lstat(manifestPath)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size <= 0 || manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new ImageGenerationUnavailableError('Codex image manifest is missing or exceeds the allowed size.')
  }
  const manifest = parseImageManifest(await readFile(manifestPath, 'utf8'))
  if (!acceptedMediaTypes.includes(manifest.mediaType)) {
    throw new ImageGenerationUnavailableError(`This Phoenix deployment does not accept ${manifest.mediaType} images.`)
  }
  if (rasters[0]?.name !== manifest.file) {
    throw new ImageGenerationUnavailableError('Codex image manifest does not identify the sole generated raster.')
  }
  const candidatePath = path.join(output.absolute, manifest.file)
  const candidateStat = await lstat(candidatePath)
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    throw new ImageGenerationUnavailableError('Codex generated image is not a regular file.')
  }
  if (candidateStat.size <= 0 || candidateStat.size > maxBytes) {
    throw new ImageGenerationUnavailableError('Codex generated image exceeds the configured attachment byte limit.')
  }
  // The Codex run is already disposed, so this containment check has no live
  // child process left that can swap the validated path before the read.
  const [outputReal, candidateReal] = await Promise.all([realpath(output.absolute), realpath(candidatePath)])
  if (path.dirname(candidateReal) !== outputReal) {
    throw new ImageGenerationUnavailableError('Codex generated image escaped its Phoenix output directory.')
  }
  signal.throwIfAborted()
  const data = await readFile(candidateReal)
  signal.throwIfAborted()
  return {
    data,
    mediaType: manifest.mediaType,
    name: manifest.file,
    path: `${output.relative}/${manifest.file}`,
  }
}

const attachmentOutputSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string' as const, required: true },
    mediaType: {
      type: 'string' as const,
      required: true,
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
    },
    bytes: { type: 'integer' as const, required: true },
    width: { type: 'integer' as const, required: true },
    height: { type: 'integer' as const, required: true },
    name: { type: 'string' as const },
    originalDimensions: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        width: { type: 'integer' as const, required: true },
        height: { type: 'integer' as const, required: true },
      },
    },
  },
} as const

/** Register the tool when its configured Codex provider is actually available. */
export function apply(ctx: Context, config: Config): void {
  const providerName = config.provider ?? DEFAULT_PROVIDER
  const toolName = config.toolName ?? DEFAULT_TOOL_NAME
  let disposeTool: (() => void) | undefined

  const mount = (_provider: SubagentProvider): void => {
    disposeTool = ctx.tools.register(defineTool({
      name: toolName,
      description:
        'Genera una imagen raster nueva a partir de una descripción visual usando la capacidad de imagen integrada de Codex. '
        + 'Devuelve un attachment durable de Phoenix; úsala cuando una web, presentación, informe o artefacto visual se beneficie de una imagen original.',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'Describe con precisión la imagen que debe generarse: sujeto, composición, estilo, iluminación, texto visible y restricciones relevantes.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            attachment: { ...attachmentOutputSchema, required: true },
            path: { type: 'string', required: true },
          },
        },
        render: (_args, value): ContentBlock[] => [
          { type: 'image', attachment: value.attachment as unknown as ImageAttachmentRef },
          { type: 'text', text: `Imagen generada y guardada en ${value.path}` },
        ],
      },
      async execute(args, exec) {
        const parent = exec.agent
        if (parent === undefined) {
          throw new ImageGenerationUnavailableError('image_generation requires a calling Agent.')
        }
        const cwd = parent.session?.header?.cwd
        if (typeof cwd !== 'string' || cwd.trim().length === 0) {
          throw new ImageGenerationUnavailableError('the calling Agent has no usable workspace.')
        }
        exec.signal.throwIfAborted()
        const output = await createOutputDirectory(path.resolve(cwd), String(exec.callId))
        let published = false
        try {
          let run: SubagentRun
          try {
            run = await ctx.subagents.start(providerName, {
              label: 'Generate image',
              prompt: [{ type: 'text', text: buildCodexImagePrompt(args.prompt, output.relative) }],
              parent,
              signal: exec.signal,
            })
          } catch {
            throw new ImageGenerationUnavailableError('Codex image generation provider could not start.')
          }
          const result = await settleAndDispose(run)
          requireCompleted(result)
          const generated = await readGeneratedImage(
            output,
            ctx.attachments.imageLimits.mediaTypes,
            ctx.attachments.imageLimits.maxImageBytes,
            exec.signal,
          )
          let attachment: ImageAttachmentRef
          try {
            attachment = await ctx.attachments.saveImage({
              data: generated.data,
              mediaType: generated.mediaType,
              name: generated.name,
            })
          } catch {
            throw new ImageGenerationUnavailableError('Phoenix rejected the generated image attachment.')
          }
          exec.signal.throwIfAborted()
          published = true
          return { attachment, path: generated.path }
        } finally {
          if (!published) await rm(output.absolute, { recursive: true, force: true }).catch(() => {})
        }
      },
    }))
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === providerName && disposeTool === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (removedName) => {
    if (removedName !== providerName || disposeTool === undefined) return
    disposeTool()
    disposeTool = undefined
  })
  const present = ctx.subagents.getProvider(providerName)
  if (present !== undefined) mount(present)
  else ctx.logger.info(`subagent provider "${providerName}" not registered yet; the "${toolName}" tool will register when it appears`)
}
