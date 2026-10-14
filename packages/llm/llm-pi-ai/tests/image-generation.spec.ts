import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  classifyCodexImageFailure,
  codexImageInvocation,
  resolveNativeCodexImageLauncher,
  codexDoctorSupportsImageGeneration,
  imageGenerationToolDescription,
  imageGenerationBackendOrder,
  freeImageProviderOrder,
  installCodexImageGeneration,
  materializeGeneratedImageInWorkspace,
  selectFreshGeneratedImage,
  selectImageGenerationBackend,
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
  it('launches npm/pnpm Windows Codex shims with cmd /d /s /c and retains stdin prompt separation', () => {
    const tail = ['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check',
      '--enable','image_generation','-s','read-only','-']
    const cmd = codexImageInvocation('C:\\Program Files\\nodejs\\codex.cmd', tail, 'win32')
    expect(cmd.slice(1, 4)).toEqual(['/d', '/s', '/c'])
    expect(cmd[4]).toBe('""C:\\Program Files\\nodejs\\codex.cmd" ' + tail.join(' ') + '"')
    expect(cmd[4]).not.toContain('test image')
    expect(codexImageInvocation('C:\\codex\\codex.exe', tail, 'win32')).toEqual([
      'C:\\codex\\codex.exe', ...tail,
    ])
    expect(codexImageInvocation('/usr/local/bin/codex', tail, 'linux')).toEqual([
      '/usr/local/bin/codex', ...tail,
    ])
    expect(codexImageInvocation('C:\\codex\\codex.BAT', tail, 'win32').slice(1, 4))
      .toEqual(['/d', '/s', '/c'])
    expect(() => codexImageInvocation('C:\\bad%NAME%\\codex.cmd', tail, 'win32'))
      .toThrow(/unsafe Windows Codex launcher/)
    expect(() => codexImageInvocation('C:\\codex.cmd', [...tail, '&whoami'], 'win32'))
      .toThrow(/unsafe Windows Codex launcher/)
  })
  it('runs a real spaced Windows cmd shim and pipes its prompt without EINVAL', async () => {
    if (process.platform !== 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'phoenix-image shim '))
    try {
      const shim = join(root, 'codex image.cmd')
      await writeFile(shim, '@echo off\r\nset /p INPUT=\r\necho result:%INPUT%\r\n')
      const argv = codexImageInvocation(shim, ['exec', '-'], 'win32')
      const processResult = spawnSync(argv[0]!, [...argv.slice(1)], {
        input: 'raster-test\n', encoding: 'utf8', timeout: 10_000,
      })
      expect(processResult.error).toBeUndefined()
      expect(processResult.status).toBe(0)
      expect(processResult.stdout).toContain('result:raster-test')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
  it('selects npm or pnpm native Windows Codex instead of invoking a .cmd shim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-codex-native-'))
    try {
      const shim = join(root, 'codex.cmd')
      const native = join(root, 'node_modules', '@openai', 'codex',
        'node_modules', '@openai', 'codex-win32-x64', 'vendor',
        'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
      await mkdir(dirname(native), { recursive: true })
      await writeFile(native, 'mock executable')
      expect(await resolveNativeCodexImageLauncher(shim, 'win32', 'x64')).toBe(native)
      const command = codexImageInvocation(native, ['exec', '-'], 'win32')
      expect(command).toEqual([native, 'exec', '-'])
      expect(await resolveNativeCodexImageLauncher(shim, 'linux', 'x64')).toBe(shim)
      const pnpmShim = join(root, 'pnpm', 'codex.cmd')
      const pnpmNative = join(root, 'pnpm', 'global', '5', 'node_modules',
        '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64',
        'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
      await mkdir(dirname(pnpmNative), { recursive: true })
      await writeFile(pnpmNative, 'mock pnpm executable')
      expect(await resolveNativeCodexImageLauncher(pnpmShim, 'win32', 'x64')).toBe(pnpmNative)
      expect(await resolveNativeCodexImageLauncher(join(root, 'unknown.cmd'), 'win32', 'x64'))
        .toBe(join(root, 'unknown.cmd'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
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

  it('prefers Codex image credits independently of the active text model and keeps explicit backends strict', () => {
    expect(selectImageGenerationBackend(undefined, 'openai-codex')).toBe('codex')
    expect(selectImageGenerationBackend('auto', 'deepseek-official')).toBe('codex')
    expect(selectImageGenerationBackend('auto', 'openrouter')).toBe('codex')
    expect(imageGenerationBackendOrder('auto', 'deepseek-official')).toEqual(['codex', 'local', 'free'])
    expect(imageGenerationBackendOrder(undefined, 'phoenix-local')).toEqual(['codex', 'local', 'free'])
    expect(imageGenerationBackendOrder('local', 'openai-codex')).toEqual(['local'])
    expect(imageGenerationBackendOrder('free', 'openai-codex')).toEqual(['free'])
    expect(imageGenerationBackendOrder('codex', 'deepseek-official')).toEqual(['codex'])
    expect(freeImageProviderOrder).toEqual(['cloudflare', 'huggingface'])
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
    expect(imageGenerationToolDescription).toContain('actual, high-quality raster image')
    expect(imageGenerationToolDescription).toContain('project')
    expect(imageGenerationToolDescription).toContain('logo')
    expect(imageGenerationToolDescription).toContain('webpage')
    expect(imageGenerationToolDescription).toContain('report')
    expect(imageGenerationToolDescription).toContain('type-appropriate')
    expect(imageGenerationToolDescription).toContain('hero')
    expect(imageGenerationToolDescription).toContain('charts')
    expect(imageGenerationToolDescription).toContain('OpenAI Codex')
    expect(imageGenerationToolDescription).toContain('backend=auto')
    expect(imageGenerationToolDescription).toContain('Higgsfield')
    expect(imageGenerationToolDescription).toContain('local image endpoint')
    expect(imageGenerationToolDescription).toContain('Cloudflare Workers AI')
    expect(imageGenerationToolDescription).toContain('Hugging Face free credits')
    expect(imageGenerationToolDescription).toContain('SVG, HTML, CSS, canvas')
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
          async readImage(ref: unknown) {
            return { ref, data: Buffer.from([1, 2, 3]) }
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
        {
          signal: new AbortController().signal,
          agent: { options: { provider: 'openai-codex' }, session: { header: { cwd: root } } },
        },
      )
      const exportedPath = join(root, '.artifacts', 'generated-images')
      expect(result).toMatchObject({
        provider: 'codex',
        attachment: { attachmentId: 'image-1' },
      })
      const actualPath = (result as { path: string }).path
      expect(actualPath).toContain(exportedPath)
      expect(await readFile(actualPath)).toEqual(Buffer.from([1, 2, 3]))
      await rm(join(root, 'generated_images', 'fresh.png'), { force: true })
      expect(await readFile(actualPath)).toEqual(Buffer.from([1, 2, 3]))
      expect(spawns).toBe(2)
    } finally {
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('materializes an image from the durable attachment after its provider temp path disappears', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'phoenix-image-workspace-'))
    try {
      const data = Buffer.from([137, 80, 78, 71, 11, 22, 33])
      const attachment = {
        attachmentId: 'image-from-durable-store' as never,
        mediaType: 'image/png' as const,
        bytes: data.length,
        width: 1,
        height: 1,
      }
      const image = {
        provider: 'codex' as const,
        model: 'codex-integrated-image-generation',
        path: join(workspace, 'deleted-codex-temp.png'),
        attachment,
      }
      const store = {
        async readImage(ref: typeof attachment) {
          expect(ref.attachmentId).toBe(attachment.attachmentId)
          return { ref: attachment, data }
        },
      }
      const exported = await materializeGeneratedImageInWorkspace(store as never, image, workspace)
      expect(exported.path).toContain(join(workspace, '.artifacts', 'generated-images'))
      expect(exported.path).toMatch(/\\.png$/u)
      expect(exported.attachment).toBe(attachment)
      expect(await readFile(exported.path)).toEqual(data)
      // Original Codex temp raster is absent; the exported asset survives.
      await expect(readFile(image.path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(exported.path)).toEqual(data)
      expect(await materializeGeneratedImageInWorkspace(store as never, image, undefined)).toEqual(image)
    } finally {
      await rm(workspace, { force: true, recursive: true })
    }
  })

  it('refuses to export through a symlinked workspace asset folder', async () => {
    // Windows symlink creation is unavailable without Developer Mode on some CI hosts.
    if (process.platform === 'win32') return
    const workspace = await mkdtemp(join(tmpdir(), 'phoenix-image-stage-'))
    const other = await mkdtemp(join(tmpdir(), 'phoenix-image-other-'))
    try {
      await symlink(other, join(workspace, '.artifacts'), 'dir')
      const attachment = {
        attachmentId: 'image-one' as never,
        mediaType: 'image/png' as const,
        bytes: 4,
        width: 1,
        height: 1,
      }
      const image = {
        provider: 'codex' as const,
        model: 'test',
        path: 'unavailable.png',
        attachment,
      }
      let imageReads = 0
      const store = {
        async readImage() {
          imageReads += 1
          return { ref: attachment, data: Buffer.from([1, 2, 3, 4]) }
        },
      }
      await expect(materializeGeneratedImageInWorkspace(store as never, image, workspace))
        .rejects.toThrow('must not be a symlink')
      expect(imageReads).toBe(0)
    } finally {
      await rm(workspace, { force: true, recursive: true })
      await rm(other, { force: true, recursive: true })
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

    expect(tool.output.schema.properties.path).toMatchObject({ type: 'string' })
    expect(tool.output.schema.properties.provider).toMatchObject({
      enum: ['codex', 'local', 'cloudflare', 'huggingface'],
    })
    expect(tool.output.schema.required).toContain('path')
    expect(tool.output.presentationMeta?.({}, {
      provider: 'codex',
      model: 'codex-integrated-image-generation',
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
          model: 'codex-integrated-image-generation',
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
