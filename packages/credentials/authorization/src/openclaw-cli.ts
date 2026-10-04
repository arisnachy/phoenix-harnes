/**
 * OpenClaw CLI-backed account authorization for Google Workspace and GitHub.
 *
 * Phoenix adopts verified ambient sessions owned by the official `gog` and
 * `gh` CLIs, but keeps its own credential marker so Disconnect never logs a
 * user out of software outside Phoenix.
 */

import type { Context } from '@phoenix-ai/cordis'
import { credentialKey, type CredentialKey } from '@phoenix-ai/dsh-credentials'
import type { SubprocessRuntime } from '@phoenix-ai/dsh-subprocess'
import { AuthorizationError, type AuthorizationSession, type AuthorizationTelemetry } from './index.ts'

/** Cordis plugin name. */
export const name = 'authorization-openclaw-cli'
/** Authorization/credential ownership plus the governed local subprocess seam. */
export const inject = ['authorization', 'credentials', 'subprocess']

/** Phoenix marker for the adopted OpenClaw gog Google Workspace account. */
export const OPENCLAW_GOOGLE_ACCOUNT_KEY = credentialKey('openclaw-cli', 'google-workspace')
/** Backward-compatible Google authorization key export for the public /google entry point. */
export const GOOGLE_ACCOUNT_KEY = OPENCLAW_GOOGLE_ACCOUNT_KEY
/** Phoenix marker for the adopted official GitHub CLI account. */
export const OPENCLAW_GITHUB_ACCOUNT_KEY = credentialKey('openclaw-cli', 'github')

const GOOGLE_SERVICES = 'gmail,calendar,drive,docs,sheets,slides,contacts'
const MAX_CLI_OUTPUT = 256_000

interface CliResult {
  stdout: string
  stderr: string
}

class CliFailure extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    const diagnostic = (stderr.trim() || stdout.trim()).slice(-2_000)
    super(`${command} exited with ${String(exitCode)}${diagnostic.length === 0 ? '' : `: ${diagnostic}`}`)
    this.name = 'CliFailure'
  }
}

function appendBounded(current: string, chunk: unknown): string {
  const next = current + String(chunk)
  return next.length <= MAX_CLI_OUTPUT ? next : next.slice(-MAX_CLI_OUTPUT)
}

/**
 * Run one fixed-argv official connector CLI through Phoenix's governed subprocess seam.
 * @param ctx - Cordis context carrying the subprocess runtime.
 * @param command - Official CLI executable name such as `gog` or `gh`.
 * @param args - Fixed argv entries; no shell interpolation is performed.
 * @param options - Optional cancellation, non-secret environment, and output observer.
 * @returns Captured stdout/stderr after a successful exit.
 */
export async function runOpenClawCli(
  ctx: Context,
  command: string,
  args: readonly string[],
  options: {
    signal?: AbortSignal | undefined
    env?: Readonly<Record<string, string>> | undefined
    onOutput?: ((text: string) => void) | undefined
  } = {},
): Promise<CliResult> {
  const subprocess: SubprocessRuntime = ctx.subprocess
  let executable: string
  try {
    executable = await subprocess.resolveExecutable(command, options.env, options.signal)
  } catch (error) {
    throw new AuthorizationError(
      `Official OpenClaw connector runtime "${command}" is not installed or not discoverable on PATH.`,
      'OPENCLAW_CLI_MISSING',
      { cause: error },
    )
  }
  const handle = subprocess.spawn({
    argv: [executable, ...args],
    cwd: process.cwd(),
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5_000,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  let stdout = ''
  let stderr = ''
  handle.stdout?.on('data', (chunk: unknown) => {
    const text = String(chunk)
    stdout = appendBounded(stdout, text)
    options.onOutput?.(text)
  })
  handle.stderr?.on('data', (chunk: unknown) => {
    const text = String(chunk)
    stderr = appendBounded(stderr, text)
    options.onOutput?.(text)
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) throw new CliFailure(command, outcome.exitCode, stdout, stderr)
  return { stdout, stderr }
}

function json(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new AuthorizationError(`${label} returned invalid JSON`, 'OPENCLAW_CLI_JSON', { cause: error })
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function markerAccount(value: unknown, provider: 'openclaw-gog' | 'openclaw-gh'): string | undefined {
  const top = record(value)
  if (top?.kind !== 'grant') return undefined
  const payload = record(top.payload)
  return payload?.provider === provider && typeof payload.account === 'string' && payload.account.trim().length > 0
    ? payload.account.trim()
    : undefined
}

async function commitMarker(
  ctx: Context,
  key: CredentialKey,
  provider: 'openclaw-gog' | 'openclaw-gh',
  account: string,
): Promise<void> {
  await ctx.credentials.modifyRecord(key, () => Promise.resolve({
    kind: 'grant',
    payload: { provider, account },
  }))
}

interface GogAccount {
  email: string
  valid: boolean
}

async function validGogAccounts(ctx: Context, signal?: AbortSignal): Promise<GogAccount[]> {
  const result = await internals.run(ctx, 'gog', ['auth', 'list', '--check', '--json', '--no-input'], { signal })
  const root = record(json(result.stdout, 'gog auth list'))
  const accounts = Array.isArray(root?.accounts) ? root.accounts : []
  return accounts.flatMap((candidate) => {
    const item = record(candidate)
    return typeof item?.email === 'string' && item.valid === true
      ? [{ email: item.email.trim(), valid: true }]
      : []
  }).filter(account => account.email.length > 0)
}

async function verifiedGithubLogin(ctx: Context, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const result = await internals.run(
      ctx,
      'gh',
      ['api', 'user', '--jq', '.login'],
      { signal, env: { GH_PROMPT_DISABLED: '1' } },
    )
    const login = result.stdout.trim()
    return login.length > 0 ? login : undefined
  } catch {
    return undefined
  }
}

async function currentMarker(
  ctx: Context,
  key: CredentialKey,
  provider: 'openclaw-gog' | 'openclaw-gh',
): Promise<string | undefined> {
  return markerAccount(await ctx.credentials.readRecord(key), provider)
}

async function chooseGoogleAccount(
  session: AuthorizationSession,
  accounts: readonly GogAccount[],
): Promise<string | undefined> {
  if (accounts.length === 0) return undefined
  if (accounts.length === 1) return accounts[0]?.email
  return session.prompt({
    kind: 'select',
    message: 'Choose the Google Workspace account Phoenix should use',
    options: accounts.map(account => ({ id: account.email, label: account.email })),
  })
}

function missingGogCredentials(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return message.includes('credentials') || message.includes('client_secret') || message.includes('oauth client')
}

async function authorizeGoogle(ctx: Context, session: AuthorizationSession): Promise<string> {
  const existing = await chooseGoogleAccount(session, await validGogAccounts(ctx, session.signal))
  if (existing !== undefined) return existing

  const email = (await session.prompt({
    kind: 'text',
    message: 'Google account email',
    placeholder: 'you@gmail.com',
  })).trim()
  if (email.length === 0 || !email.includes('@')) {
    throw new AuthorizationError('Google account email is required', 'OPENCLAW_GOOGLE_EMAIL')
  }

  const step1Args = [
    'auth', 'add', email,
    '--services', GOOGLE_SERVICES,
    '--remote', '--step', '1',
    '--json', '--no-input',
  ] as const
  let step1: CliResult
  try {
    step1 = await internals.run(ctx, 'gog', step1Args, { signal: session.signal })
  } catch (error) {
    if (!missingGogCredentials(error)) throw error
    session.notify({
      message: 'gog needs the Google Desktop OAuth credentials JSON used by your OpenClaw Google setup. Phoenix stores no copy of this file.',
    })
    const credentialsPath = (await session.prompt({
      kind: 'text',
      message: 'Path to Google OAuth client credentials JSON',
      placeholder: 'C:\\path\\to\\client_secret.json',
    })).trim()
    if (credentialsPath.length === 0) {
      throw new AuthorizationError('Google OAuth credentials path is required', 'OPENCLAW_GOOGLE_CLIENT')
    }
    await internals.run(
      ctx,
      'gog',
      ['auth', 'credentials', 'set', credentialsPath, '--json', '--no-input'],
      { signal: session.signal },
    )
    step1 = await internals.run(ctx, 'gog', step1Args, { signal: session.signal })
  }

  const first = record(json(step1.stdout, 'gog auth step 1'))
  const authUrl = typeof first?.auth_url === 'string' ? first.auth_url : undefined
  if (authUrl === undefined || !authUrl.startsWith('https://')) {
    throw new AuthorizationError('gog did not return a Google authorization URL', 'OPENCLAW_GOOGLE_AUTH_URL')
  }
  session.notify({
    message: 'Continue with Google in your browser, then paste the final redirected URL back into Phoenix.',
    url: authUrl,
  })
  const callbackUrl = (await session.prompt({
    kind: 'text',
    message: 'Paste the final Google redirect URL',
    placeholder: 'http://localhost/...?code=...',
  })).trim()
  if (callbackUrl.length === 0) {
    throw new AuthorizationError('Google redirect URL is required', 'OPENCLAW_GOOGLE_CALLBACK')
  }
  await internals.run(ctx, 'gog', [
    'auth', 'add', email,
    '--services', GOOGLE_SERVICES,
    '--remote', '--step', '2',
    '--auth-url', callbackUrl,
    '--json', '--no-input',
  ], { signal: session.signal })

  const verified = (await validGogAccounts(ctx, session.signal))
    .find(account => account.email.toLowerCase() === email.toLowerCase())
  if (verified === undefined) {
    throw new AuthorizationError('gog completed authorization but the account did not verify', 'OPENCLAW_GOOGLE_VERIFY')
  }
  return verified.email
}

async function inspectGoogle(ctx: Context, signal?: AbortSignal): Promise<AuthorizationTelemetry | undefined> {
  const adopted = await currentMarker(ctx, OPENCLAW_GOOGLE_ACCOUNT_KEY, 'openclaw-gog')
  if (adopted === undefined) return undefined
  try {
    const account = (await validGogAccounts(ctx, signal))
      .find(candidate => candidate.email.toLowerCase() === adopted.toLowerCase())
    if (account === undefined) return undefined
    return {
      kind: 'account',
      provider: 'Google Workspace',
      accountType: 'openclaw-gog',
      email: account.email,
      connectors: GOOGLE_CONNECTORS,
    }
  } catch {
    return undefined
  }
}

async function authorizeGithub(ctx: Context, session: AuthorizationSession): Promise<string> {
  const existing = await verifiedGithubLogin(ctx, session.signal)
  if (existing !== undefined) return existing

  session.notify({
    message: 'GitHub CLI will open the official GitHub device authorization flow. Enter the one-time code shown by Phoenix if GitHub asks for it.',
    url: 'https://github.com/login/device',
  })
  let announcedCode: string | undefined
  await internals.run(ctx, 'gh', [
    'auth', 'login',
    '--hostname', 'github.com',
    '--git-protocol', 'https',
    '--web',
    '--skip-ssh-key',
  ], {
    signal: session.signal,
    env: { GH_PROMPT_DISABLED: '1' },
    onOutput: (text) => {
      const code = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/u.exec(text)?.[1]
      if (code !== undefined && code !== announcedCode) {
        announcedCode = code
        session.notify({
          message: 'Enter this one-time code on GitHub to authorize Phoenix.',
          url: 'https://github.com/login/device',
          code,
        })
      }
    },
  })

  const login = await verifiedGithubLogin(ctx, session.signal)
  if (login === undefined) {
    throw new AuthorizationError('GitHub CLI login finished but the account did not verify', 'OPENCLAW_GITHUB_VERIFY')
  }
  return login
}

async function inspectGithub(ctx: Context, signal?: AbortSignal): Promise<AuthorizationTelemetry | undefined> {
  const adopted = await currentMarker(ctx, OPENCLAW_GITHUB_ACCOUNT_KEY, 'openclaw-gh')
  if (adopted === undefined) return undefined
  const login = await verifiedGithubLogin(ctx, signal)
  if (login === undefined || login.toLowerCase() !== adopted.toLowerCase()) return undefined
  return {
    kind: 'account',
    provider: 'GitHub',
    accountType: 'openclaw-gh',
    email: login,
    connectors: GITHUB_CONNECTORS,
  }
}

const GOOGLE_CONNECTORS = [{
  id: 'google-workspace',
  name: 'Google Workspace',
  description: 'Gmail, Calendar, Drive, Docs, Sheets, Slides, and Contacts through OpenClaw gog.',
  category: 'Productivity',
  accessible: true,
  enabled: true,
  installed: true,
  callable: true,
}] as const

const GITHUB_CONNECTORS = [{
  id: 'github',
  name: 'GitHub',
  description: 'Repositories, issues, pull requests, releases, and CI through the official GitHub CLI.',
  category: 'Development',
  accessible: true,
  enabled: true,
  installed: true,
  callable: true,
}] as const

/** Register OpenClaw CLI-backed Google Workspace and GitHub account flows. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.authorization.registerFlow({
    key: OPENCLAW_GOOGLE_ACCOUNT_KEY,
    label: 'Google Workspace',
    methods: [{ id: 'oauth', label: 'Sign in with Google' }],
    connectors: GOOGLE_CONNECTORS,
    inspect: signal => inspectGoogle(ctx, signal),
    disconnect: async () => {
      // Deliberately leave gog's OS-keyring account intact: Disconnect means
      // Phoenix stops adopting it, not "log me out of OpenClaw everywhere".
      await ctx.credentials.deleteRecord(OPENCLAW_GOOGLE_ACCOUNT_KEY)
    },
    run: async (session) => {
      const account = await authorizeGoogle(ctx, session)
      await commitMarker(ctx, OPENCLAW_GOOGLE_ACCOUNT_KEY, 'openclaw-gog', account)
    },
  }))

  ctx.effect(() => ctx.authorization.registerFlow({
    key: OPENCLAW_GITHUB_ACCOUNT_KEY,
    label: 'GitHub',
    methods: [{ id: 'oauth', label: 'Authorize GitHub' }],
    connectors: GITHUB_CONNECTORS,
    inspect: signal => inspectGithub(ctx, signal),
    disconnect: async () => {
      // Keep the user's shared gh login intact for terminals and other apps.
      await ctx.credentials.deleteRecord(OPENCLAW_GITHUB_ACCOUNT_KEY)
    },
    run: async (session) => {
      const account = await authorizeGithub(ctx, session)
      await commitMarker(ctx, OPENCLAW_GITHUB_ACCOUNT_KEY, 'openclaw-gh', account)
    },
  }))
}

/** Test seam for official CLI execution. */
export const internals: {
  run: typeof runOpenClawCli
} = {
  run: runOpenClawCli,
}

/** Cordis plugin descriptor for OpenClaw-backed Google Workspace and GitHub authorization. */
export default { name, inject, apply }
