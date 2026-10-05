/**
 * OpenClaw-backed authorization helpers for Google Workspace and GitHub.
 *
 * These helpers never invoke a shell: every command uses a fixed executable and
 * argv array. PHOENIX adopts the user's existing gog/gh sessions and keeps only
 * a secret-free marker for the GitHub authorization flow.
 */

import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import type { Context } from '@phoenix-ai/cordis'
import { credentialKey } from '@phoenix-ai/dsh-credentials'
import { AuthorizationError, type AuthorizationSession, type AuthorizationTelemetry } from './index.ts'

/** PHOENIX marker for an adopted GitHub CLI session. */
export const OPENCLAW_GITHUB_ACCOUNT_KEY = credentialKey('authorization-openclaw', 'github')

const GOOGLE_SERVICES = 'gmail,calendar,drive,docs,sheets,slides,contacts'
const MAX_OUTPUT = 256_000

interface CliRunOptions {
  readonly signal?: AbortSignal
  readonly env?: Readonly<Record<string, string>>
  readonly onOutput?: (text: string) => void
}

interface CliResult {
  readonly stdout: string
  readonly stderr: string
}

export type OpenClawCliRunner = (
  command: string,
  args: readonly string[],
  options?: CliRunOptions,
) => Promise<CliResult>

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
  return next.length <= MAX_OUTPUT ? next : next.slice(-MAX_OUTPUT)
}

function defaultRun(command: string, args: readonly string[], options: CliRunOptions = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(command, [...args], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(options.env ?? {}) },
      })
    } catch (error) {
      reject(error)
      return
    }

    const finishReject = (error: unknown): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = (): void => {
      child.kill()
      finishReject(options.signal?.reason ?? new Error('OpenClaw connector command cancelled'))
    }
    if (options.signal?.aborted === true) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: unknown) => {
      const text = String(chunk)
      stdout = appendBounded(stdout, text)
      options.onOutput?.(text)
    })
    child.stderr?.on('data', (chunk: unknown) => {
      const text = String(chunk)
      stderr = appendBounded(stderr, text)
      options.onOutput?.(text)
    })
    child.once('error', finishReject)
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (exitCode !== 0) {
        reject(new CliFailure(command, exitCode, stdout, stderr))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

/** Mutable only in tests; production uses the direct no-shell runner. */
export const openClawInternals: { run: OpenClawCliRunner } = { run: defaultRun }

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new AuthorizationError(`${label} returned invalid JSON`, 'OPENCLAW_CLI_JSON', { cause: error })
  }
}

function missingExecutable(error: unknown): boolean {
  const value = error as { code?: unknown; cause?: { code?: unknown } }
  return value?.code === 'ENOENT'
    || value?.cause?.code === 'ENOENT'
    || String(error).toLowerCase().includes('enoent')
    || String(error).toLowerCase().includes('not recognized as an internal or external command')
}

async function available(command: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await openClawInternals.run(command, ['--version'], { signal })
    return true
  } catch (error) {
    if (missingExecutable(error)) return false
    return false
  }
}

interface GogAccount {
  readonly email: string
  readonly valid: boolean
}

async function validGogAccounts(signal?: AbortSignal): Promise<GogAccount[]> {
  const result = await openClawInternals.run(
    'gog',
    ['auth', 'list', '--check', '--json', '--no-input'],
    { signal },
  )
  const root = record(parseJson(result.stdout, 'gog auth list'))
  const accounts = Array.isArray(root?.accounts) ? root.accounts : []
  return accounts.flatMap((candidate) => {
    const item = record(candidate)
    if (item?.valid !== true || typeof item.email !== 'string') return []
    const email = item.email.trim()
    return email.length > 0 && email.includes('@') ? [{ email, valid: true }] : []
  })
}

/** Return one verified gog account, if the official CLI exists and is authenticated. */
export async function findOpenClawGoogleAccount(signal?: AbortSignal): Promise<string | undefined> {
  if (!await available('gog', signal)) return undefined
  try {
    return (await validGogAccounts(signal))[0]?.email
  } catch {
    return undefined
  }
}

async function chooseGoogleAccount(
  session: AuthorizationSession,
  accounts: readonly GogAccount[],
): Promise<string | undefined> {
  if (accounts.length === 0) return undefined
  if (accounts.length === 1) return accounts[0]?.email
  return session.prompt({
    kind: 'select',
    message: 'Choose the Google Workspace account PHOENIX should use',
    options: accounts.map(account => ({ id: account.email, label: account.email })),
  })
}

function missingGogCredentials(error: unknown): boolean {
  const message = String(error).toLowerCase()
  return message.includes('credentials')
    || message.includes('client_secret')
    || message.includes('oauth client')
}

/**
 * Prefer OpenClaw's official gog authorization. Undefined means gog is absent,
 * so the caller may safely use the native PHOENIX Google OAuth fallback.
 */
export async function authorizeGoogleWithOpenClaw(
  session: AuthorizationSession,
): Promise<string | undefined> {
  if (!await available('gog', session.signal)) return undefined

  const existing = await chooseGoogleAccount(session, await validGogAccounts(session.signal))
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
    step1 = await openClawInternals.run('gog', step1Args, { signal: session.signal })
  } catch (error) {
    if (!missingGogCredentials(error)) throw error
    session.notify({
      message: 'OpenClaw gog needs the Google Desktop OAuth credentials JSON. PHOENIX will pass the selected path to gog and will not copy the file into chat.',
    })
    const credentialsPath = (await session.prompt({
      kind: 'text',
      message: 'Path to Google OAuth client credentials JSON',
      placeholder: 'C:\\path\\to\\client_secret.json',
    })).trim()
    if (credentialsPath.length === 0) {
      throw new AuthorizationError('Google OAuth credentials path is required', 'OPENCLAW_GOOGLE_CLIENT')
    }
    await openClawInternals.run(
      'gog',
      ['auth', 'credentials', 'set', credentialsPath, '--json', '--no-input'],
      { signal: session.signal },
    )
    step1 = await openClawInternals.run('gog', step1Args, { signal: session.signal })
  }

  const first = record(parseJson(step1.stdout, 'gog auth step 1'))
  const authUrl = typeof first?.auth_url === 'string' ? first.auth_url : undefined
  if (authUrl === undefined || !authUrl.startsWith('https://')) {
    throw new AuthorizationError('gog did not return a Google authorization URL', 'OPENCLAW_GOOGLE_AUTH_URL')
  }
  session.notify({
    message: 'Continue with Google in your browser, then paste the final redirected URL back into PHOENIX.',
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

  await openClawInternals.run('gog', [
    'auth', 'add', email,
    '--services', GOOGLE_SERVICES,
    '--remote', '--step', '2',
    '--auth-url', callbackUrl,
    '--json', '--no-input',
  ], { signal: session.signal })

  const verified = (await validGogAccounts(session.signal))
    .find(candidate => candidate.email.toLowerCase() === email.toLowerCase())
  if (verified === undefined) {
    throw new AuthorizationError('gog completed authorization but the account did not verify', 'OPENCLAW_GOOGLE_VERIFY')
  }
  return verified.email
}

function output(text: string): { status: number; ok: boolean; contentType: string; body: string } {
  return { status: 200, ok: true, contentType: 'application/json', body: text }
}

function baseArgs(account: string): string[] {
  return ['--account', account, '--json', '--no-input']
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> | undefined {
  if (typeof body !== 'string') return undefined
  try {
    return record(JSON.parse(body) as unknown)
  } catch {
    return undefined
  }
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(normalized + padding, 'base64').toString('utf8')
}

function decodeMimeSubject(value: string): string {
  const match = /^=\?UTF-8\?B\?([^?]+)\?=$/iu.exec(value.trim())
  return match?.[1] === undefined ? value.trim() : Buffer.from(match[1], 'base64').toString('utf8')
}

function parseRawMessage(raw: string): {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  html: boolean
} | undefined {
  const text = base64UrlDecode(raw)
  const split = text.indexOf('\r\n\r\n')
  if (split < 0) return undefined
  const headerText = text.slice(0, split)
  const body = text.slice(split + 4)
  const headers = new Map<string, string>()
  for (const line of headerText.split(/\r\n/u)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim())
  }
  const to = headers.get('to') ?? ''
  const subject = headers.get('subject') ?? ''
  if (to.length === 0 || subject.length === 0) return undefined
  return {
    to,
    subject: decodeMimeSubject(subject),
    body,
    ...(headers.get('cc') === undefined ? {} : { cc: headers.get('cc') }),
    ...(headers.get('bcc') === undefined ? {} : { bcc: headers.get('bcc') }),
    html: (headers.get('content-type') ?? '').toLowerCase().startsWith('text/html'),
  }
}

export interface OpenClawGoogleRequest {
  readonly service: 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets' | 'slides' | 'contacts'
  readonly path: string
  readonly method?: string
  readonly body?: BodyInit | null
  readonly signal?: AbortSignal
}

/**
 * Translate PHOENIX's stable Google broker calls to the official gog CLI.
 * Returns undefined when a legacy advanced REST path has no safe translation.
 */
export async function requestGoogleWithOpenClaw(
  account: string,
  request: OpenClawGoogleRequest,
): Promise<{ status: number; ok: boolean; contentType: string; body: string } | undefined> {
  const method = (request.method ?? 'GET').toUpperCase()
  const relativePath = request.path.startsWith('/') ? request.path : `./${request.path}`
  const url = new URL(relativePath, 'https://phoenix.invalid/')
  const path = url.pathname.replace(/^\//u, '')
  const common = baseArgs(account)
  let args: string[] | undefined

  if (request.service === 'gmail' && method === 'GET' && path === 'users/me/messages') {
    const query = url.searchParams.get('q') ?? ''
    args = [
      'gmail', 'messages', 'search', query,
      '--max', url.searchParams.get('maxResults') ?? '20',
      ...(url.searchParams.get('pageToken') === null ? [] : ['--page', url.searchParams.get('pageToken') as string]),
      ...common,
      '--wrap-untrusted',
    ]
  } else if (request.service === 'gmail' && method === 'GET' && /^users\/me\/messages\/[^/]+$/u.test(path)) {
    args = ['gmail', 'get', decodeURIComponent(path.split('/').at(-1) ?? ''), ...common, '--wrap-untrusted']
  } else if (request.service === 'gmail' && method === 'POST' && path === 'users/me/messages/send') {
    const raw = parseBody(request.body)?.raw
    const message = typeof raw === 'string' ? parseRawMessage(raw) : undefined
    if (message !== undefined) {
      args = [
        'gmail', 'send',
        '--to', message.to,
        '--subject', message.subject,
        ...(message.html ? ['--body-html', message.body] : ['--body', message.body]),
        ...(message.cc === undefined ? [] : ['--cc', message.cc]),
        ...(message.bcc === undefined ? [] : ['--bcc', message.bcc]),
        ...common,
        '--force',
      ]
    }
  } else if (request.service === 'calendar' && method === 'GET' && /^calendars\/[^/]+\/events$/u.test(path)) {
    const calendarId = decodeURIComponent(path.split('/')[1] ?? 'primary')
    args = [
      'calendar', 'events', calendarId,
      '--max', url.searchParams.get('maxResults') ?? '50',
      ...(url.searchParams.get('timeMin') === null ? [] : ['--from', url.searchParams.get('timeMin') as string]),
      ...(url.searchParams.get('timeMax') === null ? [] : ['--to', url.searchParams.get('timeMax') as string]),
      ...common,
      '--wrap-untrusted',
    ]
  } else if (request.service === 'calendar' && method === 'POST' && /^calendars\/[^/]+\/events$/u.test(path)) {
    const calendarId = decodeURIComponent(path.split('/')[1] ?? 'primary')
    const body = parseBody(request.body)
    const start = record(body?.start)
    const end = record(body?.end)
    if (typeof body?.summary === 'string' && typeof start?.dateTime === 'string' && typeof end?.dateTime === 'string') {
      const attendees = Array.isArray(body.attendees)
        ? body.attendees.flatMap(candidate => {
          const item = record(candidate)
          return typeof item?.email === 'string' ? [item.email] : []
        })
        : []
      args = [
        'calendar', 'create', calendarId,
        '--summary', body.summary,
        '--from', start.dateTime,
        '--to', end.dateTime,
        ...(typeof body.description === 'string' ? ['--description', body.description] : []),
        ...(typeof start.timeZone === 'string' ? ['--timezone', start.timeZone] : []),
        ...(attendees.length === 0 ? [] : ['--attendees', attendees.join(',')]),
        ...common,
        '--force',
      ]
    }
  } else if (request.service === 'drive' && method === 'GET' && path === 'files') {
    const query = url.searchParams.get('q')
    args = query === null || query.trim() === ''
      ? ['drive', 'ls', '--max', url.searchParams.get('pageSize') ?? '50', ...common, '--wrap-untrusted']
      : ['drive', 'search', query, '--max', url.searchParams.get('pageSize') ?? '50', ...common, '--wrap-untrusted']
  } else if (request.service === 'docs' && method === 'GET' && /^documents\/[^/]+$/u.test(path)) {
    args = ['docs', 'cat', decodeURIComponent(path.split('/')[1] ?? ''), ...common, '--wrap-untrusted']
  } else if (request.service === 'sheets' && method === 'GET' && /^spreadsheets\/[^/]+\/values\/.+$/u.test(path)) {
    const parts = path.split('/')
    const spreadsheetId = decodeURIComponent(parts[1] ?? '')
    const range = decodeURIComponent(parts.slice(3).join('/'))
    args = ['sheets', 'get', spreadsheetId, range, ...common, '--wrap-untrusted']
  } else if (request.service === 'sheets' && (method === 'PUT' || method === 'POST') && /^spreadsheets\/[^/]+\/values\/.+$/u.test(path)) {
    const parts = path.split('/')
    const spreadsheetId = decodeURIComponent(parts[1] ?? '')
    const range = decodeURIComponent(parts.slice(3).join('/'))
    const values = parseBody(request.body)?.values
    if (Array.isArray(values)) {
      args = ['sheets', 'update', spreadsheetId, range, '--values-json', JSON.stringify(values), ...common, '--force']
    }
  } else if (request.service === 'slides' && method === 'GET' && /^presentations\/[^/]+$/u.test(path)) {
    args = ['slides', 'raw', decodeURIComponent(path.split('/')[1] ?? ''), ...common, '--wrap-untrusted']
  } else if (request.service === 'contacts' && method === 'GET' && path === 'people/me/connections') {
    args = ['contacts', 'list', ...common, '--wrap-untrusted']
  } else if (request.service === 'contacts' && method === 'GET' && path === 'people:searchContacts') {
    args = ['contacts', 'search', url.searchParams.get('query') ?? '', ...common, '--wrap-untrusted']
  }

  if (args === undefined) return undefined
  const result = await openClawInternals.run('gog', args, { signal: request.signal })
  return output(result.stdout)
}

async function verifiedGithubLogin(signal?: AbortSignal): Promise<string | undefined> {
  if (!await available('gh', signal)) return undefined
  try {
    const result = await openClawInternals.run(
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

async function githubMarker(ctx: Context): Promise<string | undefined> {
  const stored = await ctx.credentials.readRecord(OPENCLAW_GITHUB_ACCOUNT_KEY)
  const top = record(stored)
  const payload = record(top?.payload)
  return top?.kind === 'grant'
    && payload?.provider === 'openclaw-gh'
    && typeof payload.account === 'string'
    && payload.account.trim().length > 0
    ? payload.account.trim()
    : undefined
}

async function inspectGithub(ctx: Context, signal?: AbortSignal): Promise<AuthorizationTelemetry | undefined> {
  const adopted = await githubMarker(ctx)
  if (adopted === undefined) return undefined
  const login = await verifiedGithubLogin(signal)
  if (login === undefined || login.toLowerCase() !== adopted.toLowerCase()) return undefined
  return {
    kind: 'account',
    provider: 'GitHub',
    accountType: 'openclaw-gh',
    email: login,
    connectors: [{
      id: 'github',
      name: 'GitHub',
      description: 'Repositories, issues, pull requests, releases, and CI through the official GitHub CLI.',
      category: 'Development',
      accessible: true,
      enabled: true,
      installed: true,
      callable: true,
    }],
  }
}

async function authorizeGithub(session: AuthorizationSession): Promise<string> {
  const existing = await verifiedGithubLogin(session.signal)
  if (existing !== undefined) return existing
  if (!await available('gh', session.signal)) {
    throw new AuthorizationError(
      'GitHub CLI (gh) is required for OpenClaw GitHub authorization. Install the official GitHub CLI or use the official GitHub MCP connector.',
      'OPENCLAW_CLI_MISSING',
    )
  }

  session.notify({
    message: 'GitHub CLI is opening the official GitHub device authorization flow.',
    url: 'https://github.com/login/device',
  })
  let announcedCode: string | undefined
  await openClawInternals.run('gh', [
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
      if (code === undefined || code === announcedCode) return
      announcedCode = code
      session.notify({
        message: `Enter GitHub device code ${code} to authorize PHOENIX.`,
        url: 'https://github.com/login/device',
      })
    },
  })
  const login = await verifiedGithubLogin(session.signal)
  if (login === undefined) {
    throw new AuthorizationError('GitHub CLI login finished but the account did not verify', 'OPENCLAW_GITHUB_VERIFY')
  }
  return login
}

/** Register one non-Copilot GitHub account flow backed by the official gh CLI. */
export function registerOpenClawGithubAuthorization(ctx: Context): () => void {
  return ctx.authorization.registerFlow({
    key: OPENCLAW_GITHUB_ACCOUNT_KEY,
    label: 'GitHub',
    methods: [{ id: 'oauth', label: 'Authorize GitHub' }],
    connectors: [{
      id: 'github',
      name: 'GitHub',
      description: 'Repositories, issues, pull requests, releases, and CI through the official GitHub CLI.',
      category: 'Development',
      accessible: true,
      enabled: true,
      installed: true,
      callable: true,
    }],
    inspect: signal => inspectGithub(ctx, signal),
    disconnect: async () => {
      await ctx.credentials.deleteRecord(OPENCLAW_GITHUB_ACCOUNT_KEY)
    },
    run: async (session) => {
      const account = await authorizeGithub(session)
      await ctx.credentials.modifyRecord(OPENCLAW_GITHUB_ACCOUNT_KEY, () => Promise.resolve({
        kind: 'grant',
        payload: { provider: 'openclaw-gh', account },
      }))
    },
  })
}
