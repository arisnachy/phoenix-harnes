/**
 * Codex/ChatGPT-authenticated image-generation bridge.
 *
 * The active text model is deliberately irrelevant: a free OpenRouter model,
 * DeepSeek, or another route may still ask this tool for a visual. The bridge
 * delegates the raster work to the locally installed Codex CLI, which owns the
 * ChatGPT subscription authentication and the hosted `image_generation` tool.
 * It never falls back to an OPENAI_API_KEY or another separately billed route.
 * @module dsh-llm-pi-ai/image-generation
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@phoenix-ai/dsh-attachment'
import type {} from '@phoenix-ai/dsh-subprocess'
import { defineTool } from '@phoenix-ai/dsh-tools'

export type CodexImageFailureKind = 'quota' | 'runtime'

export interface GeneratedImageCandidate {
  readonly path: string
  readonly mtimeMs: number
  readonly bytes: number
}

interface ProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Model-facing policy. Keeping the routing rule in the schema description makes
 * the capability visible to every model that sees the normal tool catalog.
 */
export const imageGenerationToolDescription =
  'Generate an actual image with PHOENIX using the user\'s locally authenticated Codex/ChatGPT image capability. '
  + 'Use this whenever the user explicitly asks to create, draw, design, render, visualize, or generate an image, logo, banner, poster, cover, illustration, mockup, UI concept, diagram, thumbnail, or other visual asset. '
  + 'Also use it when completing a project whose required deliverables materially include visual assets such as branding, a hero image, application/web artwork, presentation graphics, or marketing creative. '
  + 'Do not return only an image prompt when the user asked for the actual image and this tool is available. '
  + 'The image backend is independent of the active text model, so use it even when the current language model is OpenRouter/free, DeepSeek, or another non-Codex route. '
  + 'Generate one distinct final visual per call. Do not create decorative images that are irrelevant to the requested deliverable.'

/**
 * Recognize the current Codex doctor posture without interpreting token-meter
 * usage as provider quota. Image generation is subscription-safe only when the
 * CLI reports stored ChatGPT auth and the built-in image feature enabled.
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
    /image_generation[^,}\]]*enabled/.test(normalized)
    || /image generation[^,}\]]*enabled/.test(normalized)
    || /image_generation[^,}\]]*true/.test(normalized)
  )
  return chatgptAuth && imageEnabled
}

/** Classify only known quota/rate-limit text as capacity exhaustion. */
export function classifyCodexImageFailure(message: string): CodexImageFailureKind {
  return /too\s*many\s*requests|rate[ _-]?limit|usage[ _-]?limit|quota|credits? exhausted|429/i.test(message)
    ? 'quota'
    : 'runtime'
}

/**
 * Select a file that was absent or changed since the pre-call snapshot. Codex
 * uses opaque unique filenames; newest-wins also handles a successful call that
 * emits more than one intermediate raster while still returning exactly one
 * durable PHOENIX attachment.
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
  return configured && configured.length > 0 ? configured : join(homedir(), '.codex')
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

async function runCodex(
  ctx: Context,
  argvTail: readonly string[],
  stdin: string | undefined,
  signal: AbortSignal,
): Promise<ProcessResult> {
  const executable = await ctx.subprocess.resolveExecutable('codex', undefined, signal)
  const handle = ctx.subprocess.spawn({
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

async function assertCodexImageAvailable(ctx: Context, signal: AbortSignal): Promise<void> {
  let doctor: ProcessResult
  try {
    doctor = await runCodex(ctx, ['doctor', '--json'], undefined, signal)
  } catch (error) {
    throw new Error(`image_generation: Codex CLI is not available: ${error instanceof Error ? error.message : String(error)}`)
  }
  const report = `${doctor.stdout}\n${doctor.stderr}`
  if (!codexDoctorSupportsImageGeneration(report)) {
    throw new Error(
      'image_generation: Codex is present, but PHOENIX could not verify both ChatGPT/Codex authentication and the built-in image_generation capability. Sign in to Codex with ChatGPT and enable/update image generation before retrying; PHOENIX will not fall back to a separately billed API key.',
    )
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
    'Use the built-in image_generation tool exactly once and generate a real raster image.',
    'Do not create SVG, HTML, CSS, canvas code, a placeholder, or a text-only substitute.',
    'Do not modify project files and do not use web search.',
    'If the image tool fails, report the failure instead of claiming success.',
    `Requested size: ${size}.`,
    `Requested quality: ${quality}.`,
    `Requested background: ${background}.`,
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

/** Register the model-facing image tool when the normal tools/subprocess/attachment stack is composed. */
export function installCodexImageGeneration(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'image_generation',
    description: imageGenerationToolDescription,
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Complete visual brief for the one image to generate.',
      },
      size: {
        type: 'string',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
        description: 'Requested image size/aspect. Omit for auto.',
      },
      quality: {
        type: 'string',
        enum: ['auto', 'low', 'medium', 'high'],
        description: 'Requested generation quality. Omit for auto.',
      },
      background: {
        type: 'string',
        enum: ['auto', 'opaque', 'transparent'],
        description: 'Requested background mode. Omit for auto.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true, const: 'codex' },
          model: { type: 'string', required: true },
          attachment: {
            type: 'object',
            required: true,
            additionalProperties: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `Generated image with Codex (${value.attachment.width}×${value.attachment.height}, ${value.attachment.mediaType}).`,
        },
        { type: 'image', attachment: value.attachment as ImageAttachmentRef },
      ],
    },
    timeoutMs: 180_000,
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (prompt.length === 0) throw new Error('image_generation: prompt must not be empty')
      if (prompt.length > 32_000) throw new Error('image_generation: prompt exceeds the 32,000-character safety bound')

      await assertCodexImageAvailable(ctx, exec.signal)
      const generatedRoot = join(codexHome(), 'generated_images')
      const baselineCandidates = await listGeneratedImages(generatedRoot)
      const baseline = new Map(baselineCandidates.map(candidate => [candidate.path, stamp(candidate)]))

      const run = await runCodex(ctx, [
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

      const combined = `${run.stdout}\n${run.stderr}`.trim()
      if (run.exitCode !== 0) {
        if (classifyCodexImageFailure(combined) === 'quota') {
          throw new Error(
            'image_generation: the Codex/ChatGPT image allowance is currently rate-limited or exhausted. No separately billed API fallback was attempted.',
          )
        }
        throw new Error(`image_generation: Codex image worker failed${combined === '' ? '' : `: ${combined.slice(-2000)}`}`)
      }

      const generated = await waitForFreshImage(generatedRoot, baseline, exec.signal)
      if (generated === undefined) {
        const kind = classifyCodexImageFailure(combined)
        if (kind === 'quota') {
          throw new Error(
            'image_generation: Codex reported an image quota/rate limit and produced no new raster. No separately billed API fallback was attempted.',
          )
        }
        throw new Error(
          'image_generation: Codex exited without exposing a new generated raster. PHOENIX refuses to claim success without a verifiable image artifact.',
        )
      }

      const mediaType = mediaTypeOf(generated.path)
      if (mediaType === undefined) throw new Error('image_generation: generated file has an unsupported image type')
      const data = await readFile(generated.path)
      const attachment = await ctx.attachments.saveImage({
        data,
        mediaType,
        name: basename(generated.path),
      })
      return {
        provider: 'codex' as const,
        model: 'gpt-image',
        attachment,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate image',
      kind: 'other',
      rawInput: { prompt: args.prompt, size: args.size ?? 'auto', quality: args.quality ?? 'auto' },
    }),
  }))
}
