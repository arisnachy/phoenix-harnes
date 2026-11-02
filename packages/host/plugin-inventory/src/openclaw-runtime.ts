/**
 * Optional, bounded OpenClaw CLI probes for PHOENIX's existing Connector card.
 * Local toolchain first; PATH fallback. A responding CLI never grants
 * permission to inspect the user's screen, execute plugins or access secrets.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import type { OpenClawProbeState, OpenClawRuntimeSnapshot } from './types.ts'

interface CliCommand { readonly binary: string; readonly prefix: readonly string[] }

function managedCli(): CliCommand | undefined {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const file = join(home, 'toolchains', 'openclaw', 'node_modules', 'openclaw', 'package.json')
  if (!existsSync(file)) return undefined
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (data === null || typeof data !== 'object') return undefined
    const record = data as { bin?: string | { openclaw?: string } }
    const part = typeof record.bin === 'string' ? record.bin : record.bin?.openclaw
    if (typeof part !== 'string') return undefined
    const base = dirname(file)
    const entry = resolve(base, part)
    const rel = relative(base, entry)
    if (rel.startsWith('..') || rel.length === 0 || !existsSync(entry)) return undefined
    return { binary: process.execPath, prefix: [entry] }
  } catch {
    return undefined
  }
}

function openClawCli(): CliCommand {
  const local = managedCli()
  if (local !== undefined) return local
  if (process.platform === 'win32') {
    // All arguments come from fixed literals below, not user input.
    return { binary: 'cmd.exe', prefix: ['/d', '/s', '/c', 'openclaw.cmd'] }
  }
  return { binary: 'openclaw', prefix: [] }
}

function probe(args: readonly string[], timeoutMs = 5000): Promise<boolean> {
  return new Promise(resolve => {
    const cli = openClawCli()
    let finished = false
    let child: ReturnType<typeof spawn>
    let timer: ReturnType<typeof setTimeout> | undefined
    const complete = (success: boolean): void => {
      if (finished) return
      finished = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(success)
    }
    try {
      child = spawn(cli.binary, [...cli.prefix, ...args], {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      })
    } catch {
      complete(false)
      return
    }
    timer = setTimeout(() => { child.kill(); complete(false) }, timeoutMs)
    child.on('error', () => { complete(false) })
    child.on('close', code => { complete(code === 0) })
  })
}

function state(success: boolean): OpenClawProbeState {
  return success ? 'responded' : 'unavailable'
}

/** CLI response readiness only, never proof of active Gateway tools. */
export async function readOpenClawRuntimeSnapshot(): Promise<OpenClawRuntimeSnapshot> {
  const installed = await probe(['--version'], 4000)
  if (!installed) {
    return {
      installed: false,
      gateway: 'not-installed',
      browser: 'not-installed',
      plugins: 'not-installed',
      channels: 'not-installed',
      nativePluginsRoutedToPhoenix: false,
    }
  }
  const [gateway, browser, plugins, channels] = await Promise.all([
    probe(['gateway', 'status', '--json']),
    probe(['browser', '--json', 'status']),
    probe(['plugins', 'list', '--json']),
    probe(['channels', 'status', '--json']),
  ])
  return {
    installed: true,
    gateway: state(gateway),
    browser: state(browser),
    plugins: state(plugins),
    channels: state(channels),
    nativePluginsRoutedToPhoenix: false,
  }
}
