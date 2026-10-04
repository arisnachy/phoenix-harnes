import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService, { type AuthorizationInteraction } from '@phoenix-ai/dsh-authorization'
import {
  OPENCLAW_GITHUB_ACCOUNT_KEY,
  OPENCLAW_GOOGLE_ACCOUNT_KEY,
  apply,
  internals,
} from '../src/openclaw-cli.ts'
import { MemoryCredentials } from './memory.ts'

const originalRun = internals.run

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  apply(ctx)
  return ctx
}

function surface(): AuthorizationInteraction {
  return {
    notify: vi.fn(),
    prompt: vi.fn(() => Promise.resolve('unused')),
  }
}

afterEach(() => {
  internals.run = originalRun
})

describe('OpenClaw CLI authorization', () => {
  it('adopts an existing verified gog account without re-running OAuth', async () => {
    const ctx = await harness()
    const run = vi.fn(async (_ctx: Context, command: string, args: readonly string[]) => {
      expect(command).toBe('gog')
      expect(args).toEqual(['auth', 'list', '--check', '--json', '--no-input'])
      return {
        stdout: JSON.stringify({ accounts: [{ email: 'doctor@example.com', valid: true, auth: 'oauth' }] }),
        stderr: '',
      }
    })
    internals.run = run as typeof internals.run

    await expect(ctx.authorization.begin({
      key: OPENCLAW_GOOGLE_ACCOUNT_KEY,
      interaction: surface(),
    })).resolves.toEqual({ status: 'authorized' })

    expect(await ctx.credentials.readRecord(OPENCLAW_GOOGLE_ACCOUNT_KEY)).toEqual({
      kind: 'grant',
      payload: { provider: 'openclaw-gog', account: 'doctor@example.com' },
    })
    expect(run).toHaveBeenCalledTimes(1)
    await expect(ctx.authorization.inspect(OPENCLAW_GOOGLE_ACCOUNT_KEY))
      .resolves.toMatchObject({ provider: 'Google Workspace', email: 'doctor@example.com' })
  })

  it('adopts an existing verified gh login without starting a second GitHub flow', async () => {
    const ctx = await harness()
    const run = vi.fn(async (_ctx: Context, command: string, args: readonly string[]) => {
      expect(command).toBe('gh')
      expect(args).toEqual(['api', 'user', '--jq', '.login'])
      return { stdout: 'arisnachy\n', stderr: '' }
    })
    internals.run = run as typeof internals.run

    await expect(ctx.authorization.begin({
      key: OPENCLAW_GITHUB_ACCOUNT_KEY,
      interaction: surface(),
    })).resolves.toEqual({ status: 'authorized' })

    expect(await ctx.credentials.readRecord(OPENCLAW_GITHUB_ACCOUNT_KEY)).toEqual({
      kind: 'grant',
      payload: { provider: 'openclaw-gh', account: 'arisnachy' },
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('disconnects Phoenix markers without logging out shared OpenClaw CLI sessions', async () => {
    const ctx = await harness()
    internals.run = vi.fn(async (_ctx: Context, command: string) => command === 'gog'
      ? {
          stdout: JSON.stringify({ accounts: [{ email: 'doctor@example.com', valid: true, auth: 'oauth' }] }),
          stderr: '',
        }
      : { stdout: 'arisnachy\n', stderr: '' }) as typeof internals.run

    await ctx.authorization.begin({ key: OPENCLAW_GOOGLE_ACCOUNT_KEY, interaction: surface() })
    await ctx.authorization.begin({ key: OPENCLAW_GITHUB_ACCOUNT_KEY, interaction: surface() })
    const callsBeforeDisconnect = (internals.run as ReturnType<typeof vi.fn>).mock.calls.length

    await ctx.authorization.disconnect(OPENCLAW_GOOGLE_ACCOUNT_KEY)
    await ctx.authorization.disconnect(OPENCLAW_GITHUB_ACCOUNT_KEY)

    expect(await ctx.credentials.describeRecord(OPENCLAW_GOOGLE_ACCOUNT_KEY)).toMatchObject({ configured: false })
    expect(await ctx.credentials.describeRecord(OPENCLAW_GITHUB_ACCOUNT_KEY)).toMatchObject({ configured: false })
    expect((internals.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(callsBeforeDisconnect)
  })

  it('publishes Google as one Workspace connection and GitHub as one repository connection', async () => {
    const ctx = await harness()
    const entries = ctx.authorization.list()
    const google = entries.find(entry => entry.key === OPENCLAW_GOOGLE_ACCOUNT_KEY)
    const github = entries.find(entry => entry.key === OPENCLAW_GITHUB_ACCOUNT_KEY)

    expect(google?.connectors?.map(connector => connector.id)).toEqual(['google-workspace'])
    expect(github?.connectors?.map(connector => connector.id)).toEqual(['github'])
  })
})
