import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { codexAccountTelemetry } from '../src/account.ts'

const accountSource = readFileSync(
  fileURLToPath(new URL('../src/account.ts', import.meta.url)),
  'utf8',
)
const piAiLoginSource = readFileSync(
  fileURLToPath(new URL('../../../llm/llm-pi-ai/src/login.ts', import.meta.url)),
  'utf8',
)

describe('native Codex managed-account boundary', () => {
  it('uses the official Codex account RPCs for login and account telemetry', () => {
    expect(accountSource).toContain('account/login/start')
    expect(accountSource).toContain("type: 'chatgpt'")
    expect(accountSource).toContain('account/read')
    expect(accountSource).toContain('account/rateLimits/read')
    expect(accountSource).toContain('account/usage/read')
  })

  it('does not parse, copy, or persist ChatGPT OAuth token internals', () => {
    expect(accountSource).not.toContain('chatgpt_account_id')
    expect(accountSource).not.toContain('access_token')
    expect(accountSource).not.toContain('refresh_token')
    expect(accountSource).not.toContain('accountId from token')
    expect(accountSource).toContain("kind: 'api-key'")
  })

  it('keeps openai-codex out of the generic pi-ai OAuth owner', () => {
    expect(piAiLoginSource).toContain("NATIVE_SESSION_AUTH_PROVIDERS = new Set<string>(['openai-codex'])")
    expect(piAiLoginSource).toContain('!NATIVE_SESSION_AUTH_PROVIDERS.has(providerId)')
  })

  it('projects only the reviewed public account fields', () => {
    const telemetry = codexAccountTelemetry({
      account: {
        type: 'chatgpt',
        email: 'person@example.test',
        planType: 'pro',
        accessToken: 'must-not-cross',
        arbitrarySecret: 'must-not-cross',
      },
      requiresOpenaiAuth: true,
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          credits: { hasCredits: true, unlimited: false, balance: '12.50', secret: 'drop-me' },
        },
      },
      usage: {
        summary: { lifetimeTokens: 123_456, peakDailyTokens: 42_000, privateField: 'drop-me' },
      },
    })
    expect(telemetry).toEqual({
      kind: 'account',
      provider: 'Codex',
      accountType: 'chatgpt',
      email: 'person@example.test',
      plan: 'pro',
      primaryLimit: { usedPercent: 37, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      credits: { hasCredits: true, unlimited: false, balance: '12.50' },
      usage: { lifetimeTokens: 123_456, peakDailyTokens: 42_000 },
    })
    expect(JSON.stringify(telemetry)).not.toContain('must-not-cross')
    expect(JSON.stringify(telemetry)).not.toContain('drop-me')
  })
})
