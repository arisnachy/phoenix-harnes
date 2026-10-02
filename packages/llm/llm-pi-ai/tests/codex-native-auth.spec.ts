import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexEnvironment } from '../src/codex-discovery.ts'
import {
  codexNativeAccessToken,
  readCodexNativeAuthStatus,
  resetCodexNativeAuthCache,
} from '../src/codex-auth.ts'
import { catalogModels } from '../src/catalog.ts'
import { buildProvider } from '../src/provider.ts'

function chatGptJwt(expSeconds = Math.floor(Date.now() / 1000) + 3_600): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      exp: expSeconds,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_phoenix_test' },
    }),
    'signature',
  ].join('.')
}

describe('native Codex authentication bridge', () => {
  afterEach(() => {
    resetCodexNativeAuthCache()
    vi.unstubAllEnvs()
  })

  it('accepts only a ChatGPT Codex session token with an account claim', () => {
    const token = chatGptJwt()
    expect(readCodexNativeAuthStatus({
      authMethod: 'chatgpt',
      authToken: token,
      requiresOpenaiAuth: true,
    })).toBe(token)

    expect(() => readCodexNativeAuthStatus({
      authMethod: 'api_key',
      authToken: 'sk-platform-key',
      requiresOpenaiAuth: true,
    })).toThrow(/logged in with ChatGPT/)

    expect(() => readCodexNativeAuthStatus({
      authMethod: 'chatgpt',
      authToken: 'not-a-chatgpt-jwt',
      requiresOpenaiAuth: true,
    })).toThrow(/did not expose a usable ChatGPT session token/)
  })

  it('uses the injected Codex session source without any API-key fallback', async () => {
    const token = chatGptJwt()
    const read = vi.fn(() => Promise.resolve(token))
    await expect(codexNativeAccessToken({ read })).resolves.toBe(token)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('never forwards OPENAI_API_KEY into Codex metadata or auth subprocesses', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-invalid-must-not-reach-codex')
    vi.stubEnv('CODEX_API_KEY', 'codex-api-key-must-not-reach-native-session')
    vi.stubEnv('CODEX_ACCESS_TOKEN', 'codex-access-token-must-not-reach-native-session')
    const env = codexEnvironment()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.CODEX_API_KEY).toBeUndefined()
    expect(env.CODEX_ACCESS_TOKEN).toBeUndefined()
  })

  it('opens an override auth seat for openai-codex even without apiKeyEnv', async () => {
    const model = [...catalogModels('openai-codex').values()][0]
    expect(model).toBeDefined()
    if (model === undefined) return

    const provider = buildProvider({
      provider: 'openai-codex',
      displayName: 'OpenAI Codex',
      models: [model],
      namesCredential: false,
    })

    expect(provider.auth.oauth).toBeDefined()
    expect(provider.auth.apiKey).toBeDefined()

    const token = chatGptJwt()
    const result = await provider.auth.apiKey?.resolve({
      ctx: {
        env: () => Promise.resolve(undefined),
        fileExists: () => Promise.resolve(false),
      },
      credential: { type: 'api_key', key: token },
    })
    expect(result?.auth.apiKey).toBe(token)
  })
})
