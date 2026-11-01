/**
 * Optional OpenClaw companion health probes.
 * OpenClaw remains a separate process: a successful CLI query does not
 * authorize PHOENIX to access a browser, session, camera or plugin.
 * No raw stdout, config, credentials, paths or account ids cross the Remote.
 */
import { spawn } from 'node:child_process'
import type { OpenClawProbeState, OpenClawRuntimeSnapshot } from './types.ts'

function probe(args: readonly string[], timeoutMs = 5000): Promise<boolean> {
  return new Promise(resolve => {
    const win = process.platform === 'win32'
    // Fixed arguments only. No user text or arbitrary commands enter cmd.exe.
    const command = win ? 'cmd.exe' : 'openclaw'
    const argv = win ? ['/d', '/s', '/c', 'openclaw.cmd', ...args] : [...args]
    let finished = false
    let child: ReturnType<typeof spawn>
    const complete = (success: boolean): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(success)
    }
    try {
      child = spawn(command, argv, {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => { child.kill(); complete(false) }, timeoutMs)
    child.on('error', () => { complete(false) })
    child.on('close', code => { complete(code === 0) })
  })
}

function state(installed: boolean, success: boolean): OpenClawProbeState {
  return !installed ? 'not-installed' : success ? 'responded' : 'unavailable'
}

/** Bounded, non-interactive runtime detection. Not proof of live plugin execution. */
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
    gateway: state(true, gateway),
    browser: state(true, browser),
    plugins: state(true, plugins),
    channels: state(true, channels),
    nativePluginsRoutedToPhoenix: false,
  }
}
