import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenClawConnectorBridge, type OpenClawCommandRunner } from '../src/openclaw-connectors.ts'

const homes: string[] = []

function home(): string {
  const value = mkdtempSync(join(tmpdir(), 'phoenix-openclaw-connectors-'))
  homes.push(value)
  process.env.DSH_HOME = value
  return value
}

function installSkill(root: string, alias: string): void {
  const directory = join(root, 'skills', alias)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), '---\nname: fixture\n---\n', 'utf8')
}

afterEach(() => {
  delete process.env.DSH_HOME
  for (const value of homes.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe('OpenClaw connector bridge', () => {
  it('marks Google ready only when the gog skill, runtime, and a checked valid account all exist', () => {
    const root = home()
    installSkill(root, 'openclaw-gog')
    const run: OpenClawCommandRunner = (bin, args) => {
      if (bin === 'gog' && args[0] === '--version') return { status: 0, stdout: 'gog 1', stderr: '' }
      if (bin === 'gog') {
        return {
          status: 0,
          stdout: JSON.stringify({ accounts: [{ email: 'owner@example.com', valid: true }] }),
          stderr: '',
        }
      }
      return { status: 1, stdout: '', stderr: '' }
    }
    expect(new OpenClawConnectorBridge(run).state('google-workspace')).toEqual({
      id: 'google-workspace',
      skillAlias: 'openclaw-gog',
      skillInstalled: true,
      runtimeAvailable: true,
      connected: true,
      account: 'owner@example.com',
      phase: 'ready',
    })
  })

  it('does not treat a stale gog token or the skill alone as connected', () => {
    const root = home()
    installSkill(root, 'openclaw-gog')
    const run: OpenClawCommandRunner = (bin, args) => {
      if (bin === 'gog' && args[0] === '--version') return { status: 0, stdout: 'gog 1', stderr: '' }
      return {
        status: 0,
        stdout: JSON.stringify({ accounts: [{ email: 'owner@example.com', valid: false }] }),
        stderr: '',
      }
    }
    expect(new OpenClawConnectorBridge(run).state('google-workspace')).toMatchObject({
      connected: false,
      phase: 'auth-required',
    })
  })

  it('uses gh auth status rather than GitHub Copilot provider state for GitHub readiness', () => {
    const root = home()
    installSkill(root, 'openclaw-github')
    const calls: string[] = []
    const run: OpenClawCommandRunner = (bin, args) => {
      calls.push(`${bin} ${args.join(' ')}`)
      return { status: 0, stdout: args[0] === 'api' ? 'verified-login\n' : '', stderr: '' }
    }
    expect(new OpenClawConnectorBridge(run).state('github')).toMatchObject({
      connected: true,
      account: 'verified-login',
      phase: 'ready',
      skillAlias: 'openclaw-github',
    })
    expect(calls).toContain('gh auth status --hostname github.com')
    expect(calls).toContain('gh api user --hostname github.com --jq .login')
    expect(calls.join(' ')).not.toContain('copilot')
  })

  it('reports missing runtime without claiming an OpenClaw connection', () => {
    const root = home()
    installSkill(root, 'openclaw-github')
    const run: OpenClawCommandRunner = () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('missing'), { code: 'ENOENT' }),
    })
    expect(new OpenClawConnectorBridge(run).state('github')).toMatchObject({
      runtimeAvailable: false,
      connected: false,
      phase: 'missing-runtime',
    })
  })
})
