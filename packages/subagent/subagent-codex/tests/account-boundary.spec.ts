import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
})
