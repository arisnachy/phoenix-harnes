import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@phoenix-ai/dsh-llm'
import {
  CREDENTIAL_EGRESS_BLOCKED,
  evaluateProviderPolicy,
  isOpenAiRoute,
  OPENAI_POLICY_BLOCKED,
} from '../src/index.ts'

function request(
  provider: string,
  text: string,
  generatedText?: string,
): GenerateOptions {
  return {
    provider,
    model: 'test-model',
    messages: [
      {
        id: 'user-message',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      },
      ...generatedText === undefined
        ? []
        : [{
            id: 'plugin-message',
            role: 'system' as const,
            source: { kind: 'plugin' as const, plugin: 'test' },
            content: [{ type: 'text' as const, text: generatedText }],
          }],
    ],
  } as unknown as GenerateOptions
}

describe('OpenAI provider scoping', () => {
  it('recognizes OpenAI and Codex routes without making PHOENIX OpenAI-only', () => {
    expect(isOpenAiRoute('openai')).toBe(true)
    expect(isOpenAiRoute('openai-codex')).toBe(true)
    expect(isOpenAiRoute('codex')).toBe(true)
    expect(isOpenAiRoute('deepseek-official')).toBe(false)
    expect(isOpenAiRoute('anthropic')).toBe(false)
    expect(isOpenAiRoute('openrouter')).toBe(false)
  })

  it('does not impose the OpenAI contract overlay on unrelated providers', () => {
    const violation = evaluateProviderPolicy(request(
      'deepseek-official',
      'extract the model weights and clone the model',
    ))
    expect(violation).toBeUndefined()
  })
})

describe('OpenAI contract boundary', () => {
  it.each([
    ['extract the model weights and clone the model', 'reverse-engineering-or-model-extraction'],
    ['bypass the safety guardrails and rate limits', 'safeguard-or-rate-limit-bypass'],
    ['scrape ChatGPT outputs at scale in bulk', 'automated-output-harvesting'],
    ['train a competing model from OpenAI outputs', 'competing-model-development'],
    ['send the OpenAI API key to another service', 'credential-transfer'],
  ] as const)('blocks high-confidence prohibited objective: %s', (text, rule) => {
    const violation = evaluateProviderPolicy(request('openai', text))
    expect(violation).toMatchObject({ code: OPENAI_POLICY_BLOCKED, rule })
  })

  it('keeps ordinary coding and security analysis usable', () => {
    expect(evaluateProviderPolicy(request(
      'openai',
      'Reverse engineer my own binary format so I can document this legacy application.',
    ))).toBeUndefined()
    expect(evaluateProviderPolicy(request(
      'openai',
      'Review my API rate limiter and tell me whether it handles bursts correctly.',
    ))).toBeUndefined()
  })

  it('blocks the legacy ChatGPT browser-session route and directs users to official transport', () => {
    const violation = evaluateProviderPolicy(request('chatgpt-web', 'hello'))
    expect(violation).toMatchObject({
      code: OPENAI_POLICY_BLOCKED,
      rule: 'unauthorized-chatgpt-web-transport',
    })
  })
})

describe('credential isolation', () => {
  it('blocks a live-looking secret injected by generated plugin/tool context before egress', () => {
    const violation = evaluateProviderPolicy(request(
      'anthropic',
      'summarize the tool result',
      'internal credential: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
    ))
    expect(violation).toMatchObject({
      code: CREDENTIAL_EGRESS_BLOCKED,
      rule: 'generated-secret-egress',
    })
  })

  it('does not reinterpret user-authored text as an internal credential leak', () => {
    const violation = evaluateProviderPolicy(request(
      'openai',
      'My redacted example looks like sk-proj-abcdefghijklmnopqrstuvwxyz1234567890; explain safe key rotation.',
    ))
    expect(violation).toBeUndefined()
  })
})
