import { describe, expect, it } from 'vitest'
import {
  classifyCodexImageFailure,
  codexDoctorSupportsImageGeneration,
  imageGenerationToolDescription,
  selectFreshGeneratedImage,
} from '../src/image-generation.ts'

describe('Codex image generation bridge', () => {
  it('recognizes ChatGPT-authenticated Codex with image generation enabled', () => {
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
