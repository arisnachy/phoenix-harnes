import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexNativeAccessToken, resetCodexNativeAuthCache } from '../src/codex-auth.ts'
import { catalogModels } from '../src/catalog.ts'
import { buildProvider } from '../src/provider.ts'

function chatGptJwt(): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      exp: Math.floor(Date.now() / 1000) + 3_600,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_phoenix_test' },
    }),
    'signature',
  ].join('.')
}

describe('openai-codex native authentication', () => {
  afterEach(() => {
    resetCodexNativeAuthCache()
    vi.unstubAllEnvs()
  })

  it('sources the credential from the Codex session instead of OPENAI_API_KEY', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-invalid-must-never-win')
    const token = chatGptJwt()
    const read = vi.fn(() => Promise.resolve(token))

    await expect(codexNativeAccessToken({ read })).resolves.toBe(token)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('accepts a per-request native Codex token even when the catalog provider is OAuth-only', async () => {
    const model = [...catalogModels('openai-codex').values()][0]
    expect(model).toBeDefined()
    if (model === undefined) return

    const provider = buildProvider({
      provider: 'openai-codex',
      displayName: 'OpenAI Codex',
      models: [model],
      namesCredential: false,
    })

    expect(provider.auth.apiKey).toBeDefined()
    const token = chatGptJwt()
    const resolved = await provider.auth.apiKey?.resolve({
      ctx: {
        env: () => Promise.resolve(undefined),
        fileExists: () => Promise.resolve(false),
      },
      credential: { type: 'api_key', key: token },
    })
    expect(resolved?.auth.apiKey).toBe(token)
  })
})
