import { describe, expect, it } from 'vitest'
import {
  buildVisualPrompt,
  ImageGenerationError,
  parseCloudflareImagePayload,
} from '../src/index.ts'

describe('image generation visual policy', () => {
  it('adds production quality guidance without inferring a bird mascot', () => {
    const prompt = buildVisualPrompt('an elegant dark control room with amber light', 'PHOENIX splash screen')
    expect(prompt).toContain('Professional art direction')
    expect(prompt).toContain('Do not add a phoenix, bird, turkey')
    expect(prompt).toContain('PHOENIX splash screen')
    expect(prompt.length).toBeLessThanOrEqual(2048)
  })

  it('preserves room for quality guidance when the literal prompt is oversized', () => {
    const prompt = buildVisualPrompt('x'.repeat(10_000))
    expect(prompt.length).toBeLessThanOrEqual(2048)
    expect(prompt).toContain('polished finish')
  })
})

describe('Cloudflare response parsing', () => {
  it('returns the encoded image payload', () => {
    expect(parseCloudflareImagePayload({ result: { image: 'aGVsbG8=' } })).toBe('aGVsbG8=')
  })

  it('fails closed on malformed responses', () => {
    expect(() => parseCloudflareImagePayload({ result: {} })).toThrow(ImageGenerationError)
  })
})
