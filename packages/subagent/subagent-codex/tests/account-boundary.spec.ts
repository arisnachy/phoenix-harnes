import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { codexAccountTelemetry } from '../src/account.ts'

const accountSource = readFileSync(
  fileURLToPath(new URL('../src/account.ts', import.meta.url)),
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

  it('uses Codex Apps RPCs only as an optional connector catalog', () => {
    expect(accountSource).toContain('app/list')
    expect(accountSource).toContain('app/installed')
    expect(accountSource).toContain('experimentalApi')
    expect(accountSource).toContain('readOptionalCodexApps')
  })

  it('does not parse, copy, or persist ChatGPT OAuth token internals', () => {
    expect(accountSource).not.toContain('chatgpt_account_id')
    expect(accountSource).not.toContain('access_token')
    expect(accountSource).not.toContain('refresh_token')
    expect(accountSource).not.toContain('accountId from token')
    expect(accountSource).toContain("kind: 'api-key'")
  })

  it('projects only the reviewed public account and connector fields', () => {
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
      apps: {
        data: [{
          id: 'github',
          name: 'GitHub',
          description: 'Work with repositories and pull requests.',
          logoUrl: 'https://cdn.example.test/github-light.svg',
          logoUrlDark: 'https://cdn.example.test/github-dark.svg',
          installUrl: 'https://example.test/install/github',
          isAccessible: true,
          isEnabled: true,
          branding: { category: 'Developer tools', privateField: 'drop-me' },
          oauthToken: 'must-not-cross',
        }],
      },
      installedApps: {
        apps: [{
          id: 'github',
          runtimeName: 'GitHub',
          enabled: true,
          callable: true,
          privateRuntimeToken: 'must-not-cross',
        }],
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
      connectors: [{
        id: 'github',
        name: 'GitHub',
        description: 'Work with repositories and pull requests.',
        iconUrl: 'https://cdn.example.test/github-light.svg',
        iconUrlDark: 'https://cdn.example.test/github-dark.svg',
        category: 'Developer tools',
        installUrl: 'https://example.test/install/github',
        accessible: true,
        enabled: true,
        installed: true,
        callable: true,
      }],
    })
    expect(JSON.stringify(telemetry)).not.toContain('must-not-cross')
    expect(JSON.stringify(telemetry)).not.toContain('drop-me')
  })
})
