/** Read-only PHOENIX installation and runtime diagnostics. @module @phoenix-ai/dsh/doctor */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { inspectChatGptWebHealth } from './chatgpt-web-bridge.ts'

export { inspectChatGptWebHealth } from './chatgpt-web-bridge.ts'

interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

const PHOENIX_CLIENT_MODULE = '@phoenix-ai/dsh-client-modules/client.js'
const LEGACY_CLIENT_MODULE = ['@deepseek-ai', 'dsh-client-modules/client.js'].join('/')

/** Validate the HTML bootstrap that registers the client module system. */
export function inspectFrontendBootstrap(html: string): Pick<Check, 'ok' | 'detail'> {
  const hasLoader = html.includes('window.__ModuleLoader__')
  const hasPhoenixModule = html.includes(PHOENIX_CLIENT_MODULE)
  const hasLegacyModule = html.includes(LEGACY_CLIENT_MODULE)
  return hasLoader && hasPhoenixModule && !hasLegacyModule
    ? { ok: true, detail: 'Phoenix client module bootstrap present' }
    : { ok: false, detail: 'Phoenix client module bootstrap is missing or still references the legacy module' }
}

function commandVersion(command: string, args: readonly string[]): string | undefined {
  const result = spawnSync(command, [...args], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return undefined
  const line = result.stdout.trim().split(/\r?\n/u)[0]
  return line === '' ? undefined : line
}

async function webChecks(): Promise<readonly Check[]> {
  try {
    const response = await fetch('http://127.0.0.1:3080/', { signal: AbortSignal.timeout(1500) })
    const server = { name: 'web server', ok: response.ok, detail: `HTTP ${response.status} at 127.0.0.1:3080` }
    if (!response.ok) {
      return [server, {
        name: 'client bootstrap',
        ok: false,
        detail: 'Skipped because the web server did not return a successful response',
      }]
    }
    const bootstrap = inspectFrontendBootstrap(await response.text())
    return [server, { name: 'client bootstrap', ...bootstrap }]
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [
      { name: 'web server', ok: false, detail },
      { name: 'client bootstrap', ok: false, detail: 'Skipped because the web server is unreachable' },
    ]
  }
}

/** Check an explicitly configured loopback bridge without exposing its body. */
async function chatGptWebCheck(): Promise<Check | undefined> {
  const configured = process.env.PHOENIX_CHATGPT_WEB_URL?.trim()
  if (configured === undefined || configured.length === 0) return undefined
  try {
    const base = new URL(configured)
    const response = await fetch(new URL('/v1/models', base), { signal: AbortSignal.timeout(1500) })
    return { name: 'ChatGPT Web bridge', ...inspectChatGptWebHealth(response.status, await response.text()) }
  } catch {
    return { name: 'ChatGPT Web bridge', ok: false, detail: 'Configured bridge is unreachable' }
  }
}

/** Run non-mutating checks without loading a user profile or exposing secrets. */
export async function runDoctor(): Promise<number> {
  const web = await webChecks()
  const chatgptWeb = await chatGptWebCheck()
  const checks: Check[] = [
    { name: 'Node.js', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: process.version },
    { name: 'Git', ok: commandVersion('git', ['--version']) !== undefined, detail: commandVersion('git', ['--version']) ?? 'not found' },
    { name: 'Python', ok: commandVersion(process.platform === 'win32' ? 'python' : 'python3', ['--version']) !== undefined, detail: commandVersion(process.platform === 'win32' ? 'python' : 'python3', ['--version']) ?? 'not found' },
    { name: 'update state', ok: existsSync(dshHomePath('..', 'phoenix-update-state.json')) || existsSync('.git/phoenix-update-state.json'), detail: 'state file discoverable' },
    ...web,
    ...(chatgptWeb === undefined ? [] : [chatgptWeb]),
  ]
  process.stdout.write('PHOENIX doctor\n\n')
  for (const check of checks) process.stdout.write(`${check.ok ? 'OK' : 'WARN'}  ${check.name}: ${check.detail}\n`)
  process.stdout.write('\nRead-only diagnostics completed. WARN does not modify configuration or credentials.\n')
  return checks.every(check => check.ok) ? 0 : 1
}
