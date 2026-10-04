import { spawn, spawnSync } from 'node:child_process'
import type {
  OpenClawConnectorAuthorizeRequest,
  OpenClawConnectorAuthorizeReceipt,
  OpenClawConnectorHubSnapshot,
  OpenClawConnectorId,
  OpenClawConnectorSnapshot,
} from './types.ts'

/** Result of one secret-free CLI probe. */
export interface OpenClawCommandResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  readonly errorCode?: string
}

/** Narrow command seam used by the OpenClaw connector bridge. */
export interface OpenClawCommandRunner {
  run(command: string, args: readonly string[]): Promise<OpenClawCommandResult>
  start(command: string, args: readonly string[]): Promise<OpenClawConnectorAuthorizeReceipt>
}

const GOOGLE_SERVICES = 'gmail,calendar,drive,contacts,docs,sheets'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function commandRunner(): OpenClawCommandRunner {
  return {
    async run(command, args) {
      const result = spawnSync(command, [...args], {
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return {
        status: result.status ?? (result.error === undefined ? 1 : 127),
        stdout: typeof result.stdout === 'string' ? result.stdout.trim() : '',
        stderr: typeof result.stderr === 'string' ? result.stderr.trim() : '',
        ...(result.error === undefined ? {} : {
          errorCode: (result.error as NodeJS.ErrnoException).code ?? result.error.name,
        }),
      }
    },
    async start(command, args) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, [...args], {
          windowsHide: true,
          shell: false,
          detached: true,
          stdio: 'ignore',
        })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
      return { started: true }
    },
  }
}

function missingRuntime(result: OpenClawCommandResult): boolean {
  return result.status === 127 || result.errorCode === 'ENOENT'
}

function safeDetail(result: OpenClawCommandResult): string | undefined {
  const value = (result.stderr || result.stdout).trim()
  if (value.length === 0) return undefined
  // Never surface token/cookie shaped output from external CLIs.
  if (/token|secret|password|cookie|authorization:/iu.test(value)) return undefined
  return value.slice(0, 500)
}

function emailsIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (EMAIL_PATTERN.test(value)) found.add(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) emailsIn(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) emailsIn(item, found)
  }
  return found
}

function googleAccount(stdout: string): string | undefined {
  try {
    return [...emailsIn(JSON.parse(stdout) as unknown)][0]
  } catch {
    const match = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.exec(stdout)
    return match?.[0]
  }
}

function snapshot(
  id: OpenClawConnectorId,
  skill: OpenClawConnectorSnapshot['skill'],
  runtime: OpenClawConnectorSnapshot['runtime'],
  result: OpenClawCommandResult,
  account?: string,
): OpenClawConnectorSnapshot {
  if (missingRuntime(result)) {
    return { id, source: 'openclaw', skill, runtime, status: 'missing-runtime' }
  }
  if (result.status === 0 && account !== undefined && account.length > 0) {
    return { id, source: 'openclaw', skill, runtime, status: 'ready', account }
  }
  return {
    id,
    source: 'openclaw',
    skill,
    runtime,
    status: 'auth-required',
    ...(safeDetail(result) === undefined ? {} : { detail: safeDetail(result) }),
  }
}

/** Host-only bridge to the operational OpenClaw Google and GitHub runtimes. */
export class OpenClawConnectorController {
  constructor(private readonly commands: OpenClawCommandRunner = commandRunner()) {}

  /** Probe only whitelisted connector runtimes; no credentials cross the Host boundary. */
  async snapshot(): Promise<OpenClawConnectorHubSnapshot> {
    const [google, github] = await Promise.all([
      this.commands.run('gog', ['auth', 'list', '--check', '--json', '--no-input']),
      this.commands.run('gh', ['api', 'user', '--jq', '.login']),
    ])
    const googleEmail = google.status === 0 ? googleAccount(google.stdout) : undefined
    const githubLogin = github.status === 0 ? github.stdout.trim().split(/\r?\n/u)[0]?.trim() : undefined
    return {
      connectors: [
        snapshot('google-workspace', 'gog', 'gog', google, googleEmail),
        snapshot('github', 'github', 'gh', github, githubLogin),
      ],
    }
  }

  /** Start one exact OpenClaw-owned browser authorization workflow. */
  async authorize(request: OpenClawConnectorAuthorizeRequest): Promise<OpenClawConnectorAuthorizeReceipt> {
    switch (request.id) {
      case 'github':
        return this.commands.start('gh', [
          'auth', 'login', '--web', '--hostname', 'github.com',
          '--git-protocol', 'https', '--skip-ssh-key',
        ])
      case 'google-workspace': {
        const account = request.account?.trim()
        if (account === undefined || !EMAIL_PATTERN.test(account)) {
          throw new Error('Google authorization requires a valid Google account email')
        }
        return this.commands.start('gog', [
          'auth', 'add', account, '--services', GOOGLE_SERVICES, '--force-consent',
        ])
      }
      default:
        throw new Error(`unsupported OpenClaw connector ${String(request.id)}`)
    }
  }
}
