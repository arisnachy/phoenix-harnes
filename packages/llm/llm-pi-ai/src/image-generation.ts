/**
 * Codex/ChatGPT-authenticated image-generation bridge.
 *
 * The active text model is deliberately irrelevant: a free OpenRouter model,
 * DeepSeek, or another route may still ask this tool for a visual. The bridge
 * delegates the raster work to the locally installed Codex CLI, which owns the
 * ChatGPT subscription authentication and the hosted image-generation tool.
 * It never forwards an OPENAI_API_KEY or another separately billed credential.
 * @module dsh-llm-pi-ai/image-generation
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@phoenix-ai/dsh-attachment'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'

/** Stable failure classes used by the image bridge's diagnostics and tests. */
export type CodexImageFailureKind = 'quota' | 'auth' | 'capability' | 'runtime'

/** Metadata for one raster observed in Codex's generated-image directory. */
export interface GeneratedImageCandidate {
  /** Absolute host path to the candidate raster. */
  readonly path: string
  /** Last-modified timestamp used to detect a fresh generation. */
  readonly mtimeMs: number
  /** Encoded byte length used as part of the freshness stamp. */
  readonly bytes: number
}

interface ProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

interface ImageSubprocessReader {
  readFrom(fromByte: number): { text: string }
}

interface ImageSubprocessHandle {
  readonly collected: {
    readonly stdout?: ImageSubprocessReader
    readonly stderr?: ImageSubprocessReader
  }
  readonly done: Promise<{ exitCode: number | null }>
}

interface ImageSubprocessService {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: {
      stdin: 'ignore' | { readonly data: string }
      stdout: { maxBytes: number }
      stderr: { maxBytes: number }
    }
    graceMs: number
    signal?: AbortSignal
  }): ImageSubprocessHandle
}

interface ImageToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): ContentBlock[]
    presentationMeta?(args: unknown, value: unknown): Record<string, unknown>
  }
  readonly timeoutMs: number
  execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown>
}

interface ImageToolRegistry {
  register(definition: ImageToolDefinition): () => void
}

interface ImageRuntimeContext {
  readonly tools: ImageToolRegistry
  readonly subprocess: ImageSubprocessService
  readonly attachments: AttachmentStore
}

type ImageSize = 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
type ImageBackground = 'auto' | 'opaque' | 'transparent'

interface ImageGenerationArgs {
  readonly prompt: string
  readonly size?: ImageSize
  readonly quality?: ImageQuality
  readonly background?: ImageBackground
}

interface ImageGenerationValue {
  readonly provider: 'codex'
  readonly model: string
  /** Absolute local path the next tool call can reopen with `read_image`. */
  readonly path: string
  readonly attachment: ImageAttachmentRef
}

/**
 * Model-facing policy. Keeping the routing rule in the schema description makes
 * the capability visible to every model that sees the normal tool catalog.
 */
export const imageGenerationToolDescription =
  'Generate an actual image with PHOENIX using the user\'s locally authenticated Codex/ChatGPT image capability. '
  + 'Use this whenever the user explicitly asks to create, draw, design, render, visualize, or generate an image, logo, banner, poster, cover, illustration, mockup, UI concept, diagram, thumbnail, or other visual asset. '
  + 'Also use it when completing a project whose required deliverables materially include visual assets such as branding, a hero image, application/web artwork, presentation graphics, or marketing creative. '
  + 'For a webpage, landing page, dashboard, report, or similar visual deliverable, include type-appropriate imagery when it materially improves the requested result: for example a hero image for a landing page, product or subject imagery for a catalog, or charts and diagrams for a report when supported by real data. '
  + 'When the artifact format can embed governed image attachments, wire the generated asset into the final artifact; otherwise return the image as a governed visual artifact and do not pretend that a text-only page contains it. Do not invent data, add unrelated decoration, or rely on arbitrary external image URLs. '
  + 'The successful result includes both a durable attachment and the absolute local path of the generated raster; reuse that path with read_image when the image must be inspected or embedded in a later deliverable. '
  + 'Pass the complete visual request in prompt. Governed HARDNESS recovery may supply the same request as brief or objective; PHOENIX normalizes those aliases before invoking Codex. '
  + 'Do not return only an image prompt when the user asked for the actual image and this tool is available. '
  + 'The image backend is independent of the active text model, so use it even when the current language model is OpenRouter/free, DeepSeek, or another non-Codex route. '
  + 'Generate one distinct final visual per call. Do not create decorative images that are irrelevant to the requested deliverable.'

/**
 * Recognize a known Codex doctor posture for diagnostics. Doctor output is not
 * the execution authority because newer Codex versions may change this JSON
 * before PHOENIX learns the new diagnostic representation.
 * @param output - Complete stdout/stderr text from `codex doctor --json`.
 * @returns Whether the report is a known ChatGPT-authenticated, image-enabled posture.
 */
export function codexDoctorSupportsImageGeneration(output: string): boolean {
  let normalized: string
  try {
    normalized = JSON.stringify(JSON.parse(output)).toLowerCase()
  } catch {
    normalized = output.toLowerCase().replace(/\s+/g, ' ')
  }
  const chatgptAuth = (
    /stored chatgpt tokens[^,}\]]*true/.test(normalized)
    || /stored[_ -]chatgpt[_ -]tokens[^,}\]]*true/.test(normalized)
    || /stored auth mode[^,}\]]*chatgpt/.test(normalized)
    || /stored[_ -]auth[_ -]mode[^,}\]]*chatgpt/.test(normalized)
  )
  const imageEnabled = (
    /enabled feature flags[^}\]]*image_generation/.test(normalized)
    || /image_generation[^,}\]]*enabled/.test(normalized)
    || /image generation[^,}\]]*enabled/.test(normalized)
    || /image_generation[^,}\]]*true/.test(normalized)
  )
  return chatgptAuth && imageEnabled
}

/**
 * Classify provider diagnostics from the real image-worker execution.
 * @param message - Provider/CLI diagnostic text.
 * @returns Stable failure category used for user-facing recovery guidance.
 */
export function classifyCodexImageFailure(message: string): CodexImageFailureKind {
  if (/too\s*many\s*requests|rate[ _-]?limit|usage[ _-]?limit|quota|credits? exhausted|429/i.test(message)) {
    return 'quota'
  }
  if (
    /sign[ -]?in|login required|not authenticated|authentication required/i.test(message)
    || /unauthorized|chatgpt[^\n]*auth|\b401\b|forbidden/i.test(message)
  ) {
    return 'auth'
  }
  if (
    /image_generation[^\n]*(disabled|unavailable)|image generation[^\n]*(disabled|unavailable)/i.test(message)
    || /feature[^\n]*(not enabled|disabled)|unknown (feature|tool)[^\n]*(image|image_generation)/i.test(message)
    || /image_gen[^\n]*not available/i.test(message)
  ) {
    return 'capability'
  }
  return 'runtime'
}

/**
 * Select a file that was absent or changed since the pre-call snapshot. Codex
 * uses opaque unique filenames; newest-wins also handles a successful call that
 * emits more than one intermediate raster while still returning exactly one
 * durable PHOENIX attachment.
 * @param baseline - Pre-generation path-to-stamp snapshot.
 * @param candidates - Rasters visible after generation.
 * @returns The newest changed raster, or `undefined` when nothing new exists.
 */
export function selectFreshGeneratedImage(
  baseline: ReadonlyMap<string, string>,
  candidates: readonly GeneratedImageCandidate[],
): GeneratedImageCandidate | undefined {
  return candidates
    .filter(candidate => baseline.get(candidate.path) !== stamp(candidate))
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.bytes - left.bytes)[0]
}

function stamp(candidate: GeneratedImageCandidate): string {
  return `${candidate.mtimeMs}:${candidate.bytes}`
}

function mediaTypeOf(path: string): ImageMediaType | undefined {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
}

function codexHome(): string {
  const configured = process.env.CODEX_HOME?.trim()
  return configured && configured.length > 0 ? resolve(configured) : join(homedir(), '.codex')
}

async function listGeneratedImages(root: string): Promise<GeneratedImageCandidate[]> {
  const found: GeneratedImageCandidate[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined) break
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      if (!entry.isFile() || mediaTypeOf(path) === undefined) continue
      const metadata = await stat(path)
      if (metadata.size <= 0) continue
      found.push({ path, mtimeMs: metadata.mtimeMs, bytes: metadata.size })
    }
  }
  return found
}

function servicesOf(ctx: Context): ImageRuntimeContext {
  return ctx as unknown as ImageRuntimeContext
}

async function runCodex(
  ctx: Context,
  argvTail: readonly string[],
  stdin: string | undefined,
  signal: AbortSignal,
): Promise<ProcessResult> {
  const subprocess = servicesOf(ctx).subprocess
  const executable = await subprocess.resolveExecutable('codex', undefined, signal)
  const handle = subprocess.spawn({
    argv: [executable, ...argvTail],
    cwd: process.cwd(),
    stdio: {
      stdin: stdin === undefined ? 'ignore' : { data: stdin },
      stdout: { maxBytes: 512 * 1024 },
      stderr: { maxBytes: 512 * 1024 },
    },
    graceMs: 2_000,
    signal,
  })
  const outcome = await handle.done
  return {
    exitCode: outcome.exitCode,
    stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
  }
}

async function probeCodexImagePosture(ctx: Context, signal: AbortSignal): Promise<void> {
  try {
    await runCodex(ctx, ['doctor', '--json'], undefined, signal)
  } catch (_doctorProbeFailed) {
    signal.throwIfAborted()
    // Doctor is advisory. The real `codex exec --enable image_generation`
    // attempt below is authoritative and can succeed across diagnostic changes.
  }
}

function generationPrompt(
  prompt: string,
  size: string,
  quality: string,
  background: string,
): string {
  return [
    'You are the PHOENIX image worker.',
    'Use the built-in image_gen tool exactly once and generate a real raster image.',
    'Do not use the API/CLI image fallback and do not request OPENAI_API_KEY.',
    'Do not create SVG, HTML, CSS, canvas code, a placeholder, or a text-only substitute.',
    'Do not modify project files and do not use web search.',
    'If the built-in image tool is unavailable or fails, report the failure instead of claiming success.',
    `Requested size/aspect guidance: ${size}.`,
    `Requested quality guidance: ${quality}.`,
    `Requested background guidance: ${background}.`,
    `Image request: ${prompt}`,
    'After the image tool finishes, end the task.',
  ].join('\n')
}

async function waitForFreshImage(
  root: string,
  baseline: ReadonlyMap<string, string>,
  signal: AbortSignal,
): Promise<GeneratedImageCandidate | undefined> {
  for (let attempt = 0; attempt < 24; attempt++) {
    signal.throwIfAborted()
    const fresh = selectFreshGeneratedImage(baseline, await listGeneratedImages(root))
    if (fresh !== undefined) return fresh
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return undefined
}

function imageGenerationArgs(args: unknown): ImageGenerationArgs {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('image_generation: arguments must be an object')
  }
  const value = args as Record<string, unknown>
  const prompt = typeof value.prompt === 'string'
    ? value.prompt
    : typeof value.brief === 'string'
      ? value.brief
      : typeof value.objective === 'string'
        ? value.objective
        : undefined
  if (prompt === undefined) {
    throw new Error('image_generation: prompt, brief, or objective must be a string')
  }
  return {
    prompt,
    ...(typeof value.size === 'string' ? { size: value.size as ImageSize } : {}),
    ...(typeof value.quality === 'string' ? { quality: value.quality as ImageQuality } : {}),
    ...(typeof value.background === 'string' ? { background: value.background as ImageBackground } : {}),
  }
}

function imageGenerationValue(value: unknown): ImageGenerationValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('image_generation: invalid rendered result')
  }
  return value as unknown as ImageGenerationValue
}

function imageArtifactMeta(value: unknown): Record<string, unknown> {
  const result = imageGenerationValue(value)
  const attachment = {
    attachmentId: result.attachment.attachmentId,
    mediaType: result.attachment.mediaType,
    bytes: result.attachment.bytes,
    width: result.attachment.width,
    height: result.attachment.height,
    ...(result.attachment.name === undefined ? {} : { name: result.attachment.name }),
  }
  return {
    artifact: {
      id: String(result.attachment.attachmentId),
      mime: result.attachment.mediaType,
      data: {
        provider: result.provider,
        model: result.model,
        path: result.path,
        attachment,
      },
    },
  }
}

function imageFailureError(kind: CodexImageFailureKind, combined: string): Error {
  switch (kind) {
    case 'quota':
      return new Error(
        'image_generation: the Codex/ChatGPT image allowance is currently rate-limited or exhausted. No separately billed API fallback was attempted.',
      )
    case 'auth':
      return new Error(
        'image_generation: Codex is installed, but the real image worker reports that ChatGPT/Codex authentication is unavailable. Sign in to Codex with ChatGPT and retry; no separately billed API fallback was attempted.',
      )
    case 'capability':
      return new Error(
        'image_generation: Codex is installed, but the real image worker reports that built-in image generation is unavailable or disabled. Update/enable Codex image generation and retry; no separately billed API fallback was attempted.',
      )
    case 'runtime':
      return new Error(`image_generation: Codex image worker failed${combined === '' ? '' : `: ${combined.slice(-2000)}`}`)
  }
}

/**
 * Register the model-facing image tool when the normal tools/subprocess/
 * attachment stack is composed. Runtime services are accessed through this
 * narrow structural boundary so `llm-pi-ai` does not acquire package-graph
 * dependencies merely to contribute one optional tool.
 * @param ctx - Context whose image-related services were already injected.
 */
export function installCodexImageGeneration(ctx: Context): void {
  const services = servicesOf(ctx)
  services.tools.register({
    name: 'image_generation',
    description: imageGenerationToolDescription,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          description: 'Canonical complete visual brief for the one image to generate.',
        },
        brief: {
          type: 'string',
          description: 'Governed HARDNESS alias for prompt. Used when a mission supplies its visual brief as arguments.brief.',
        },
        objective: {
          type: 'string',
          description: 'Fallback governed HARDNESS alias when the visual request is supplied as arguments.objective.',
        },
        size: {
          type: 'string',
          enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
          description: 'Requested image size/aspect guidance. Omit for auto.',
        },
        quality: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
          description: 'Requested generation-quality guidance. Omit for auto.',
        },
        background: {
          type: 'string',
          enum: ['auto', 'opaque', 'transparent'],
          description: 'Requested background guidance. Omit for auto.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', const: 'codex' },
          model: { type: 'string' },
          path: { type: 'string', required: true },
          attachment: {
            type: 'object',
            additionalProperties: true,
            properties: {
              attachmentId: { type: 'string' },
              mediaType: { type: 'string' },
              bytes: { type: 'integer' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              name: { type: 'string' },
            },
            required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
          },
        },
        required: ['provider', 'model', 'path', 'attachment'],
      },
      render: (_args, value) => {
        const result = imageGenerationValue(value)
        return [
          {
            type: 'text',
            text: `Generated image with Codex (${result.attachment.width}×${result.attachment.height}, ${result.attachment.mediaType}).\n<path>${result.path}</path>`,
          },
          { type: 'image', attachment: result.attachment },
        ]
      },
      presentationMeta: (_args, value) => imageArtifactMeta(value),
    },
    timeoutMs: 180_000,
    async execute(rawArgs, exec) {
      const args = imageGenerationArgs(rawArgs)
      const prompt = args.prompt.trim()
      if (prompt.length === 0) throw new Error('image_generation: prompt must not be empty')
      if (prompt.length > 32_000) throw new Error('image_generation: prompt exceeds the 32,000-character safety bound')

      await probeCodexImagePosture(ctx, exec.signal)
      const generatedRoot = join(codexHome(), 'generated_images')
      const baselineCandidates = await listGeneratedImages(generatedRoot)
      const baseline = new Map(baselineCandidates.map(candidate => [candidate.path, stamp(candidate)]))

      let run: ProcessResult
      try {
        run = await runCodex(ctx, [
          'exec',
          '--ignore-user-config',
          '--ephemeral',
          '--skip-git-repo-check',
          '--enable',
          'image_generation',
          '-s',
          'read-only',
          '-',
        ], generationPrompt(
          prompt,
          args.size ?? 'auto',
          args.quality ?? 'auto',
          args.background ?? 'auto',
        ), exec.signal)
      } catch (error) {
        throw new Error(`image_generation: Codex CLI/image worker is not available: ${error instanceof Error ? error.message : String(error)}`)
      }

      const combined = `${run.stdout}\n${run.stderr}`.trim()
      if (run.exitCode !== 0) throw imageFailureError(classifyCodexImageFailure(combined), combined)

      const generated = await waitForFreshImage(generatedRoot, baseline, exec.signal)
      if (generated === undefined) {
        const kind = classifyCodexImageFailure(combined)
        if (kind !== 'runtime') throw imageFailureError(kind, combined)
        throw new Error(
          'image_generation: Codex exited without exposing a new generated raster. PHOENIX refuses to claim success without a verifiable image artifact.',
        )
      }

      const mediaType = mediaTypeOf(generated.path)
      if (mediaType === undefined) throw new Error('image_generation: generated file has an unsupported image type')
      const data = await readFile(generated.path)
      const attachment = await services.attachments.saveImage({
        data,
        mediaType,
        name: basename(generated.path),
      })
      return {
        provider: 'codex' as const,
        model: 'codex-built-in-image-gen',
        path: generated.path,
        attachment,
      }
    },
  })
}
