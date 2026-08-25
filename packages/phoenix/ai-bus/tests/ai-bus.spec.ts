import { describe, expect, it } from 'vitest'
import { createOllamaProfile, isExplicitFreeModel, ORCAROUTER_FREE_PROFILE } from '../src/index.ts'

function lane(provider: string, model: string): 'local-free' | 'remote-free' | 'metered-or-unknown' {
  if (provider === 'ollama' || provider.startsWith('ollama-')) return 'local-free'
  if ((provider === 'orcarouter' || provider.startsWith('orcarouter-')) && isExplicitFreeModel(model)) return 'remote-free'
  return 'metered-or-unknown'
}

describe('PHOENIX AI Bus presets and free-lane semantics', () => {
  it('pins OrcaRouter free to the verified OpenAI-compatible endpoint without embedding a secret', () => {
    expect(ORCAROUTER_FREE_PROFILE.baseURL).toBe('https://api.orcarouter.ai/v1')
    expect(ORCAROUTER_FREE_PROFILE.apiKeyEnv).toBe('ORCAROUTER_API_KEY')
    expect(ORCAROUTER_FREE_PROFILE.models[0]?.id).toBe('orcarouter/free')
    expect(JSON.stringify(ORCAROUTER_FREE_PROFILE)).not.toMatch(/sk-orca|bearer\s+[a-z0-9]/i)
  })

  it('never treats paid gateway membership as free by itself', () => {
    expect(lane('orcarouter', 'orcarouter/free')).toBe('remote-free')
    expect(lane('orcarouter', 'deepseek/deepseek-v4-pro-free')).toBe('remote-free')
    expect(lane('orcarouter', 'openai/gpt-5')).toBe('metered-or-unknown')
    expect(lane('openai', 'gpt-5')).toBe('metered-or-unknown')
  })

  it('requires the operator to name a real local Ollama model rather than inventing one', () => {
    expect(() => createOllamaProfile('   ')).toThrow(/installed model id/)
    expect(createOllamaProfile('qwen3:8b')).toEqual(expect.objectContaining({
      baseURL: 'http://127.0.0.1:11434/v1',
      models: [expect.objectContaining({ id: 'qwen3:8b' })],
    }))
  })
})
