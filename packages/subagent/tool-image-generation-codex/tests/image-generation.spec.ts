import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { AttachmentStore, type ImageAttachmentLimits, type ImageAttachmentRef, type SaveImageAttachment, type StoredImageAttachment } from '@phoenix-ai/dsh-attachment'
import { CallId } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import SubagentRuntime, { type SubagentStartRequest } from '@phoenix-ai/dsh-subagent'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import type { Agent } from '@phoenix-ai/dsh-agent'
import * as imageGeneration from '../src/index.ts'

const roots: string[] = []
const signal = new AbortController().signal

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'phoenix-imagegen-'))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fakeAgent(cwd: string): Agent {
  return {
    id: SessionId('image-parent'),
    options: {},
    session: {
      header: {
        version: 0,
        id: SessionId('image-parent'),
        createdAt: 0,
        cwd,
      },
    },
  } as unknown as Agent
}

class TestAttachments extends AttachmentStore {
  readonly saved: SaveImageAttachment[] = []
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 4 * 1024 * 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 16 * 1024 * 1024,
    maxImagePixels: 16_000_000,
    maxImageDimension: 8_192,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  })

  async validateImage(_input: SaveImageAttachment): Promise<void> {}

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    return {
      attachmentId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 64,
      height: 64,
      ...(input.name === undefined ? {} : { name: input.name }),
    }
  }

  async readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new Error('not needed in this fixture')
  }
}

interface SetupOptions {
  writeOutput?: (request: SubagentStartRequest) => void
  stopReason?: 'completed' | 'error' | 'aborted' | 'max-tokens' | 'refusal'
}

async function setup(options: SetupOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(TestAttachments)
  let lastRequest: SubagentStartRequest | undefined
  let disposeCount = 0
  const removeProvider = ctx.subagents.registerProvider({
    name: 'codex',
    capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: async (request) => {
      lastRequest = request
      options.writeOutput?.(request)
      return {
        id: SessionId('codex-image-run'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: 'IMAGE_READY' }],
          stopReason: options.stopReason ?? 'completed',
        }),
        dispose: async () => { disposeCount += 1 },
      }
    },
  })
  await ctx.plugin(imageGeneration, {})
  return {
    ctx,
    attachments: ctx.attachments as TestAttachments,
    request: () => lastRequest,
    disposeCount: () => disposeCount,
    removeProvider,
  }
}

function outputDirectoryFrom(request: SubagentStartRequest): string {
  const prompt = request.prompt
    .filter((block): block is Extract<(typeof request.prompt)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const match = /^PHOENIX_OUTPUT_DIR=(.+)$/mu.exec(prompt)
  if (match?.[1] === undefined) throw new Error(`missing PHOENIX_OUTPUT_DIR in prompt: ${prompt}`)
  return match[1].trim()
}

function call(ctx: Context, cwd: string, prompt = 'Una ilustración limpia de un fénix azul') {
  return ctx.tools.execute({
    callId: CallId('image-call-1'),
    name: 'image_generation',
    arguments: { prompt },
    agent: fakeAgent(cwd),
    signal,
  })
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('tool-image-generation-codex', () => {
  it('registers image_generation only while the configured Codex provider is present', async () => {
    const { ctx, removeProvider } = await setup()
    expect(ctx.tools.schemas().some(schema => schema.name === 'image_generation')).toBe(true)
    removeProvider()
    expect(ctx.tools.schemas().some(schema => schema.name === 'image_generation')).toBe(false)
  })

  it('delegates to Codex, admits one raster through attachments, renders an image block, and disposes the run', async () => {
    const cwd = workspace()
    const { ctx, attachments, request, disposeCount } = await setup({
      writeOutput: (start) => {
        const rel = outputDirectoryFrom(start)
        const dir = path.resolve(cwd, rel)
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'phoenix.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ file: 'phoenix.png', mediaType: 'image/png' }))
      },
    })

    const result = await call(ctx, cwd)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(text(result))
    expect(request()).toBeDefined()
    expect(request()?.parent).toBeDefined()
    expect(request()?.signal).toBe(signal)
    expect(disposeCount()).toBe(1)
    expect(attachments.saved).toHaveLength(1)
    expect(attachments.saved[0]?.mediaType).toBe('image/png')
    expect(result.content.some(block => block.type === 'image')).toBe(true)
    expect(text(result)).toContain('.phoenix/generated-images/')
    expect(result.value).toMatchObject({
      attachment: { mediaType: 'image/png', width: 64, height: 64 },
    })
  })

  it('instructs Codex to use built-in image generation and forbids API/download fallback', async () => {
    const cwd = workspace()
    const { ctx, request } = await setup({
      writeOutput: (start) => {
        const dir = path.resolve(cwd, outputDirectoryFrom(start))
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'one.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]))
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ file: 'one.webp', mediaType: 'image/webp' }))
      },
    })
    await call(ctx, cwd, 'robot médico amable')
    const prompt = request()!.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(prompt).toContain('built-in image generation')
    expect(prompt).toContain('Do not call an external image API')
    expect(prompt).toContain('robot médico amable')
  })

  it('fails closed without an initiating Agent', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({
      callId: CallId('no-agent'),
      name: 'image_generation',
      arguments: { prompt: 'x' },
      signal,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('IMAGE_GENERATION_UNAVAILABLE')
  })

  it.each(['error', 'aborted', 'max-tokens', 'refusal'] as const)('publishes no attachment when Codex ends with %s', async (stopReason) => {
    const cwd = workspace()
    const { ctx, attachments, disposeCount } = await setup({ stopReason })
    const result = await call(ctx, cwd)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('IMAGE_GENERATION_UNAVAILABLE')
    expect(attachments.saved).toHaveLength(0)
    expect(disposeCount()).toBe(1)
  })

  it('rejects manifest traversal before attachment publication', async () => {
    const cwd = workspace()
    writeFileSync(path.join(cwd, 'escape.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { ctx, attachments } = await setup({
      writeOutput: (start) => {
        const dir = path.resolve(cwd, outputDirectoryFrom(start))
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ file: '../../escape.png', mediaType: 'image/png' }))
      },
    })
    const result = await call(ctx, cwd)
    expect(result.isError).toBe(true)
    expect(attachments.saved).toHaveLength(0)
  })

  it('rejects multiple raster outputs instead of guessing which one to publish', async () => {
    const cwd = workspace()
    const { ctx, attachments } = await setup({
      writeOutput: (start) => {
        const dir = path.resolve(cwd, outputDirectoryFrom(start))
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'one.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        writeFileSync(path.join(dir, 'two.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ file: 'one.png', mediaType: 'image/png' }))
      },
    })
    const result = await call(ctx, cwd)
    expect(result.isError).toBe(true)
    expect(attachments.saved).toHaveLength(0)
  })

  it('keeps the generated workspace artifact correlated with the durable attachment result', async () => {
    const cwd = workspace()
    const { ctx } = await setup({
      writeOutput: (start) => {
        const dir = path.resolve(cwd, outputDirectoryFrom(start))
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, 'asset.gif'), Buffer.from('GIF89a'))
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ file: 'asset.gif', mediaType: 'image/gif' }))
      },
    })
    const result = await call(ctx, cwd)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error(text(result))
    const relative = (result.value as { path: string }).path
    expect(relative).toMatch(/^\.phoenix\/generated-images\//u)
    expect(readFileSync(path.resolve(cwd, relative))).toEqual(Buffer.from('GIF89a'))
  })
})
