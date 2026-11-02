/**
 * Gateway owner handoff: OpenClaw owns the authentication flow.
 * The operator secret never crosses the Host -> Settings boundary.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const portFile = join(home, 'toolchains', 'openclaw-gateway-local.json')

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}
function local(url: URL): boolean {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}
export interface OpenClawLocalHandoff {
  readonly port: number
  readonly token: string
  readonly authorizationUrl: string
}
/** Reject external servers, expired handoffs and URLs exposing operator secrets. */
export function parseOpenClawDashboard(value: unknown): OpenClawLocalHandoff {
  const data = object(value)
  if (data.ok === false || typeof data.url !== 'string' || typeof data.browserUrl !== 'string') {
    throw new Error('OpenClaw has not returned a local authorization link')
  }
  let operator: URL
  let browser: URL
  try {
    operator = new URL(data.url)
    browser = new URL(data.browserUrl)
  } catch {
    throw new Error('Invalid OpenClaw authorization address')
  }
  const port = Number(data.port ?? operator.port)
  if (!local(operator) || !local(browser) || !Number.isInteger(port)
    || port < 1024 || port > 65535
    || Number(operator.port) !== port || Number(browser.port) !== port) {
    throw new Error('OpenClaw must use a trusted local Gateway')
  }
  const token = operator.searchParams.get('token')
    ?? new URLSearchParams(operator.hash.slice(1)).get('token')
  if (typeof token !== 'string' || token.length < 16 || token.length > 2048
    || /[\u0000-\u0020\u007f]/u.test(token)) {
    throw new Error('OpenClaw Gateway credential is not available for local linking')
  }
  // Never turn an older token-bearing dashboard link into a browser URL.
  if (browser.toString().includes(token) || browser.hash.length < 12
    || typeof data.browserBootstrapExpiresAtMs === 'number'
    && data.browserBootstrapExpiresAtMs <= Date.now()) {
    throw new Error('OpenClaw browser authorization has expired')
  }
  return { port, token, authorizationUrl: browser.toString() }
}
function cli(): { binary: string; prefix: string[] } {
  const packageFile = join(home, 'toolchains', 'openclaw', 'node_modules', 'openclaw', 'package.json')
  if (existsSync(packageFile)) {
    try {
      const pkg = object(JSON.parse(readFileSync(packageFile, 'utf8')) as unknown)
      const entry = typeof pkg.bin === 'string' ? pkg.bin : object(pkg.bin).openclaw
      if (typeof entry === 'string') {
        const base = dirname(packageFile)
        const target = resolve(base, entry)
        const rel = relative(base, target)
        if (rel && rel !== '..' && !rel.startsWith('..' + '/') && !rel.startsWith('..' + String.fromCharCode(92))
          && existsSync(target)) return { binary: process.execPath, prefix: [target] }
      }
    } catch { /* PATH fallback */ }
  }
  return process.platform === 'win32'
    ? { binary: 'cmd.exe', prefix: ['/d', '/s', '/c', 'openclaw.cmd'] }
    : { binary: 'openclaw', prefix: [] }
}
/** Called only from the direct owner Settings action, never from model output. */
export async function prepareLocalOpenClawGateway(): Promise<OpenClawLocalHandoff> {
  const cmd = cli()
  const report = await new Promise<unknown>((resolvePromise, reject) => {
    let output = ''
    let settled = false
    const child = spawn(cmd.binary, [...cmd.prefix, 'dashboard', '--json', '--yes'], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const finish = (value: unknown, failed: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (failed) reject(new Error('Cannot prepare the local OpenClaw Gateway'))
      else resolvePromise(value)
    }
    const timeout = setTimeout(() => { child.kill(); finish(undefined, true) }, 75_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (part: string) => {
      output += part
      if (output.length > 96_000) { child.kill(); finish(undefined, true) }
    })
    child.on('error', () => { finish(undefined, true) })
    child.on('close', code => {
      if (code !== 0) { finish(undefined, true); return }
      try { finish(JSON.parse(output) as unknown, false) }
      catch { finish(undefined, true) }
    })
  })
  const result = parseOpenClawDashboard(report)
  mkdirSync(dirname(portFile), { recursive: true })
  const temporary = portFile + '.' + process.pid + '.tmp'
  writeFileSync(temporary, JSON.stringify({ port: result.port }), { mode: 0o600 })
  renameSync(temporary, portFile)
  return result
}
