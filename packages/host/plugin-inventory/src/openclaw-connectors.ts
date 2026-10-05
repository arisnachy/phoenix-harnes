import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import type {
  OpenClawConnectorEntry,
  OpenClawConnectorId,
  OpenClawConnectorSnapshot,
} from './types.ts'

interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

export type OpenClawCommandRunner = (bin: string, args: readonly string[]) => CommandResult

function defaultRun(bin: string, args: readonly string[]): CommandResult {
  const result = spawnSync(bin, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

interface GogAccount {
  email?: unknown
  valid?: unknown
}

function validGogAccount(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const accounts = (parsed as { accounts?: unknown }).accounts
    if (!Array.isArray(accounts)) return undefined
    for (const account of accounts as GogAccount[]) {
      if (account?.valid !== true || typeof account.email !== 'string') continue
      const email = account.email.trim()
      if (email.length > 0 && email.includes('@')) return email
    }
  } catch {
    return undefined
  }
  return undefined
}

function skillInstalled(alias: OpenClawConnectorEntry['skillAlias']): boolean {
  return existsSync(dshHomePath('skills', alias, 'SKILL.md'))
}

function phase(skill: boolean, runtime: boolean, connected: boolean): OpenClawConnectorEntry['phase'] {
  if (!skill) return 'missing-skill'
  if (!runtime) return 'missing-runtime'
  return connected ? 'ready' : 'auth-required'
}

/** Probe already-installed OpenClaw connector sessions without reading or returning tokens. */
export class OpenClawConnectorBridge {
  constructor(private readonly run: OpenClawCommandRunner = defaultRun) {}

  private google(): OpenClawConnectorEntry {
    const skill = skillInstalled('openclaw-gog')
    const version = this.run('gog', ['--version'])
    const runtimeAvailable = version.error === undefined && version.status === 0
    let account: string | undefined
    if (runtimeAvailable) {
      const checked = this.run('gog', ['--json', '--no-input', 'auth', 'list', '--check'])
      if (checked.error === undefined && checked.status === 0) account = validGogAccount(checked.stdout)
    }
    const connected = account !== undefined
    return {
      id: 'google-workspace',
      skillAlias: 'openclaw-gog',
      skillInstalled: skill,
      runtimeAvailable,
      connected,
      ...(account === undefined ? {} : { account }),
      phase: phase(skill, runtimeAvailable, connected),
    }
  }

  private github(): OpenClawConnectorEntry {
    const skill = skillInstalled('openclaw-github')
    const version = this.run('gh', ['--version'])
    const runtimeAvailable = version.error === undefined && version.status === 0
    const checked = runtimeAvailable
      ? this.run('gh', ['auth', 'status', '--hostname', 'github.com'])
      : undefined
    const connected = checked !== undefined && checked.error === undefined && checked.status === 0
    return {
      id: 'github',
      skillAlias: 'openclaw-github',
      skillInstalled: skill,
      runtimeAvailable,
      connected,
      phase: phase(skill, runtimeAvailable, connected),
    }
  }

  /** Return one exact connector route. */
  state(id: OpenClawConnectorId): OpenClawConnectorEntry {
    return id === 'google-workspace' ? this.google() : this.github()
  }

  /** Return all OpenClaw routes currently supported by Settings. */
  snapshot(): OpenClawConnectorSnapshot {
    return { connectors: [this.google(), this.github()] }
  }
}
