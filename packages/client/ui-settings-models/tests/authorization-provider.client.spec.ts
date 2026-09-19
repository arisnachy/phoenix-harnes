import { describe, expect, it } from 'vitest'
import {
  NATIVE_CODEX_AUTH_KEY,
  NATIVE_CODEX_PROVIDER,
  authorizationConnected,
  providerForAuthorization,
} from '../src/client/authorization-provider.ts'

describe('authorization provider identity', () => {
  it('joins the native Codex account flow to the openai-codex LLM route', () => {
    expect(providerForAuthorization({ key: NATIVE_CODEX_AUTH_KEY })).toBe(NATIVE_CODEX_PROVIDER)
    expect(authorizationConnected({ key: NATIVE_CODEX_AUTH_KEY, stored: { kind: 'api-key' } })).toBe(true)
    expect(authorizationConnected({
      key: NATIVE_CODEX_AUTH_KEY,
      telemetry: { provider: 'Codex' },
    })).toBe(true)
    expect(authorizationConnected({ key: NATIVE_CODEX_AUTH_KEY })).toBe(false)
  })

  it('preserves the conventional scoped provider join for other flows', () => {
    expect(providerForAuthorization({ key: 'llm-pi-ai/anthropic' })).toBe('anthropic')
    expect(providerForAuthorization({ key: 'standalone' })).toBe('standalone')
    expect(authorizationConnected({ key: 'llm-pi-ai/anthropic', stored: { kind: 'grant' } })).toBe(true)
    expect(authorizationConnected({ key: 'llm-pi-ai/anthropic', stored: { kind: 'api-key' } })).toBe(false)
  })
})
