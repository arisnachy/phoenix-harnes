import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  classifyCodexImageFailure,
  codexDoctorSupportsImageGeneration,
  imageGenerationToolDescription,
  installCodexImageGeneration,
  selectFreshGeneratedImage,
} from '../src/image-generation.ts'

type CapturedImageTool = {
  readonly execute: (args: unknown, exec: { readonly signal: AbortSignal }) => Promise<unknown>
  readonly output: {
    readonly schema: {
      readonly properties: Record<string, unknown>
      readonly required: readonly string[]
    }
    readonly presentationMeta?: (args: unknown, value: unknown) => unknown
  }
}

describe('Codex image generation bridge', () => {
  it('recognizes the current Codex doctor JSON shape with ChatGPT auth and image generation enabled', () => {
    expect(codexDoctorSupportsImageGeneration(JSON.stringify({
      checks: {
        'auth.storage': {
          details: [
            'stored auth mode: chatgpt',
            'stored API key: false',
            'stored ChatGPT tokens: true',
          ],
        },
        'config.load': {
          details: [
            'enabled feature flags: apps, image_generation, shell_tool',
          ],
        },
      },
    }))).toBe(true)
  })

  it('also accepts the legacy/compact enabled marker used by older doctor fixtures', () => {
    expect(codexDoctorSupportsImageGeneration(JSON.stringify({
      auth: { credentials: { 'stored ChatGPT tokens': true, 'stored auth mode': 'chatgpt' } },
      config: { load: { image_generation: 'enabled' } },
    }))).toBe(true)
  })

  it('refuses an API-key-only or image-disabled Codex posture', () => {
    expect(codexDoctorSupportsImageGeneration(JSON.stringify({
      auth: { credentials: { 'stored API key': true, 'stored ChatGPT tokens': false } },
      config: { load: { image_generation: 'enabled' } },
    }))).toBe(false)
    expect(codexDoctorSupportsImageGeneration(JSON.stringify({
      auth: { credentials: { 'stored ChatGPT tokens': true, 'stored auth mode': 'chatgpt' } },
      config: { load: { image_generation: 'disabled' } },
    }))).toBe(false)
    expect(codexDoctorSupportsImageGeneration(JSON.stringify({
      checks: {
        'auth.storage': { details: ['stored auth mode: chatgpt', 'stored ChatGPT tokens: true'] },
        'config.load': { details: ['enabled feature flags: apps, shell_tool'] },
      },
    }))).toBe(false)
  })

  it('classifies real worker failures without silently falling back to billed API usage', () => {
    expect(classifyCodexImageFailure('TooManyRequests: image_gen usage limit reached')).toBe('quota')
    expect(classifyCodexImageFailure('429 rate limit exceeded')).toBe('quota')
    expect(classifyCodexImageFailure('authentication required; sign in to ChatGPT')).toBe('auth')
    expect(classifyCodexImageFailure('image_generation is disabled in this build')).toBe('capability')
    expect(classifyCodexImageFailure('codex: command failed')).toBe('runtime')
  })

  it('selects only a new or changed generated image and prefers the newest', () => {
    const baseline = new Map([
      ['/cache/old.png', '10:100'],
      ['/cache/changed.png', '20:100'],
    ])
    expect(selectFreshGeneratedImage(baseline, [
      { path: '/cache/old.png', mtimeMs: 10, bytes: 100 },
      { path: '/cache/changed.png', mtimeMs: 30, bytes: 120 },
      { path: '/cache/new.png', mtimeMs: 40, bytes: 90 },
    ])).toEqual({ path: '/cache/new.png', mtimeMs: 40, bytes: 90 })
  })

  it('tells the model to use the tool for explicit images and project visual deliverables', () => {
    expect(imageGenerationToolDescription).toContain('actual image')
    expect(imageGenerationToolDescription).toContain('project')
    expect(imageGenerationToolDescription).toContain('logo')
    expect(imageGenerationToolDescription).toContain('webpage')
    expect(imageGenerationToolDescription).toContain('report')
    expect(imageGenerationToolDescription).toContain('type-appropriate')
    expect(imageGenerationToolDescription).toContain('hero')
    expect(imageGenerationToolDescription).toContain('charts')
    expect(imageGenerationToolDescription).toContain('active text model')
    expect(imageGenerationToolDescription).toContain('brief or objective')
  })

  it('attempts the real Codex image worker when doctor cannot recognize a valid newer posture and accepts a HARDNESS brief alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-image-generation-'))
    const previousHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = root
    let tool: CapturedImageTool | undefined
    let spawns = 0
    try {
      const context = {
        tools: {
          register(definition: CapturedImageTool) {
            tool = definition
            return () => {}
          },
        },
        subprocess: {
          async resolveExecutable() { return 'codex' },
          spawn() {
            spawns += 1
            const doctor = spawns === 1
            const done = doctor
              ? Promise.resolve({ exitCode: 0 })
              : (async () => {
                const generated = join(root, 'generated_images')
                await mkdir(generated, { recursive: true })
                await writeFile(join(generated, 'fresh.png'), Buffer.from([1, 2, 3]))
                return { exitCode: 0 }
              })()
            return {
              done,
              collected: {
                stdout: { readFrom: () => ({ text: doctor ? '{"checks":{"newer-shape":true}}' : 'image generated' }) },
                stderr: { readFrom: () => ({ text: '' }) },
              },
            }
          },
        },
        attachments: {
          async saveImage() {
            return {
              attachmentId: 'image-1',
              mediaType: 'image/png',
              bytes: 3,
              width: 1,
              height: 1,
              name: 'fresh.png',
            }
          },
        },
      } as unknown as Context
      installCodexImageGeneration(context)
      if (tool === undefined) throw new Error('image_generation tool was not registered')

      const result = await tool.execute(
        {
          objective: 'Generate the requested image',
          brief: 'A small test image',
          size: '1024x1024',
          quality: 'high',
        },
        { signal: new AbortController().signal },
      )
      expect(result).toMatchObject({
        provider: 'codex',
        path: join(root, 'generated_images', 'fresh.png'),
        attachment: { attachmentId: 'image-1' },
      })
      expect(spawns).toBe(2)
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('projects a generated image as a HARDNESS-compatible artifact', () => {
    let tool: CapturedImageTool | undefined
    const context = {
      tools: {
        register(definition: CapturedImageTool) {
          tool = definition
          return () => {}
        },
      },
      subprocess: {},
      attachments: {},
    } as unknown as Context
    installCodexImageGeneration(context)
    if (tool === undefined) throw new Error('image_generation tool was not registered')

    expect(tool.output.schema.properties.path).toMatchObject({ type: 'string', required: true })
    expect(tool.output.schema.required).toContain('path')
    expect(tool.output.presentationMeta?.({}, {
      provider: 'codex',
      model: 'codex-built-in-image-gen',
      path: 'C:/workspace/generated_images/portrait.png',
      attachment: {
        attachmentId: 'image-2',
        mediaType: 'image/png',
        bytes: 42,
        width: 1024,
        height: 1024,
        name: 'portrait.png',
      },
    })).toEqual({
      artifact: {
        id: 'image-2',
        mime: 'image/png',
        data: {
          provider: 'codex',
          model: 'codex-built-in-image-gen',
          path: 'C:/workspace/generated_images/portrait.png',
          attachment: {
            attachmentId: 'image-2',
            mediaType: 'image/png',
            bytes: 42,
            width: 1024,
            height: 1024,
            name: 'portrait.png',
          },
        },
      },
    })
  })
})
