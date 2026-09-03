import { describe, expect, it } from 'vitest'
import {
  classifyCodexImageFailure,
  codexDoctorSupportsImageGeneration,
  codexExecutableCandidates,
  codexInvocationArgv,
  imageGenerationToolDescription,
  selectFreshGeneratedImage,
} from '../src/image-generation.ts'

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

  it('discovers Codex outside PATH on Windows, including the active NVM node directory and npm global shim', () => {
    const candidates = codexExecutableCandidates({
      platform: 'win32',
      execPath: 'C:\\nvm4w\\nodejs\\node.exe',
      homeDir: 'C:\\Users\\arisn',
      env: {
        APPDATA: 'C:\\Users\\arisn\\AppData\\Roaming',
        NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
      },
    })

    expect(candidates[0]).toBe('C:\\nvm4w\\nodejs\\codex.exe')
    expect(candidates).toContain('C:\\nvm4w\\nodejs\\codex.cmd')
    expect(candidates).toContain('C:\\Users\\arisn\\AppData\\Roaming\\npm\\codex.cmd')
  })

  it('honors an explicit PHOENIX Codex executable before discovered locations', () => {
    const candidates = codexExecutableCandidates({
      platform: 'win32',
      execPath: 'C:\\nvm4w\\nodejs\\node.exe',
      homeDir: 'C:\\Users\\arisn',
      env: {
        PHOENIX_CODEX_EXECUTABLE: 'D:\\Tools\\codex.cmd',
        APPDATA: 'C:\\Users\\arisn\\AppData\\Roaming',
      },
    })

    expect(candidates[0]).toBe('D:\\Tools\\codex.cmd')
  })

  it('launches Windows cmd/bat Codex shims through ComSpec instead of spawning them directly', () => {
    expect(codexInvocationArgv(
      'C:\\Users\\arisn\\AppData\\Roaming\\npm\\codex.cmd',
      ['doctor', '--json'],
      'win32',
      { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    )).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
      '/d',
      '/s',
      '/c',
      'C:\\Users\\arisn\\AppData\\Roaming\\npm\\codex.cmd',
      'doctor',
      '--json',
    ])
  })

  it('keeps normal executable invocation unchanged', () => {
    expect(codexInvocationArgv('/usr/local/bin/codex', ['doctor', '--json'], 'linux', {})).toEqual([
      '/usr/local/bin/codex',
      'doctor',
      '--json',
    ])
  })

  it('classifies quota failures without silently falling back to billed API usage', () => {
    expect(classifyCodexImageFailure('TooManyRequests: image_gen usage limit reached')).toBe('quota')
    expect(classifyCodexImageFailure('429 rate limit exceeded')).toBe('quota')
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
    expect(imageGenerationToolDescription).toContain('active text model')
  })
})
