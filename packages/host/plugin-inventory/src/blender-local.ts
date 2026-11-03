/** Read-only Blender Lab prerequisites from the current host process.
 * A TCP listener is not proof that the add-on accepts MCP calls.
 * No credentials, local paths or arbitrary environment variables leave the Host.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { win32 } from 'node:path'

import type { BlenderLocalState } from './types.ts'

/** Probe dependencies for a local Blender Lab instance, injectable for tests.
 * A read-only probe never starts Blender or executes Python code.
 */
export interface BlenderLocalProbeOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly fileExists?: (path: string) => boolean
  readonly onPath?: (executable: string) => boolean
  readonly bridge?: () => Promise<boolean>
}
function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return Object.entries(env).find(([name]) => name.toUpperCase() === key.toUpperCase())?.[1]
}

/** Pure local-file prerequisite detection for Blender and uvx.
 * @param options - Optional platform, environment and executable probes for tests.
 * @returns Presence flags only, never absolute filesystem paths.
 */
export function inspectBlenderLocalPrograms(options: BlenderLocalProbeOptions = {}):
  Pick<BlenderLocalState, 'blenderDetected' | 'uvxDetected'> {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const exists = options.fileExists ?? existsSync
  const onPath = options.onPath ?? ((executable: string): boolean => {
    const locator = platform === 'win32' ? 'where.exe' : 'which'
    try {
      return spawnSync(locator, [executable], {
        timeout: 1_500, windowsHide: true, stdio: 'ignore',
      }).status === 0
    } catch { return false }
  })
  const blender = onPath(platform === 'win32' ? 'blender.exe' : 'blender')
    || (typeof env.BLENDER_PATH === 'string' && exists(env.BLENDER_PATH))
  const uvx = onPath(platform === 'win32' ? 'uvx.exe' : 'uvx')
  if (platform !== 'win32') return { blenderDetected: blender, uvxDetected: uvx }
  const user = envValue(env, 'USERPROFILE')
  const local = envValue(env, 'LOCALAPPDATA')
  const pf = envValue(env, 'ProgramFiles')
  const install = envValue(env, 'UV_INSTALL_DIR')
  const blenderDirs = [
    pf && win32.join(pf, 'Blender Foundation'),
    local && win32.join(local, 'Programs', 'Blender Foundation'),
  ]
  // Search a short, bounded list of versioned official Blender install paths.
  const versions = ['Blender 5.1', 'Blender 5.2', 'Blender 5.3', 'Blender 5.4', 'Blender 6.0']
  const knownBlender = blenderDirs.some(parent => parent !== undefined && versions.some(version =>
    exists(win32.join(parent, version, 'blender.exe'))))
  const knownUvx = [
    user && win32.join(user, '.local', 'bin', 'uvx.exe'),
    user && win32.join(user, '.cargo', 'bin', 'uvx.exe'),
    user && win32.join(user, 'scoop', 'shims', 'uvx.exe'),
    local && win32.join(local, 'Microsoft', 'WinGet', 'Links', 'uvx.exe'),
    local && win32.join(local, 'Programs', 'uv', 'uvx.exe'),
    install && win32.join(install, 'uvx.exe'),
  ].some(path => path !== undefined && exists(path))
  return { blenderDetected: blender || knownBlender, uvxDetected: uvx || knownUvx }
}

/** Test only the loopback Blender add-on bridge, with a bounded timeout.
 * @returns True only when a socket accepts a local connection.
 */
export function blenderBridgeListening(): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port: 9876 })
    let completed = false
    const finish = (value: boolean): void => {
      if (completed) return
      completed = true
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => { finish(true) })
    socket.once('error', () => { finish(false) })
    socket.once('timeout', () => { finish(false) })
    socket.setTimeout(700)
  })
}

/** Read local prerequisites without installing or enabling Python execution.
 * @param options - Injectable probes for deterministic tests.
 * @returns Safe booleans suitable for Connector Settings.
 */
export async function readBlenderLocalState(options: BlenderLocalProbeOptions = {}): Promise<BlenderLocalState> {
  const programs = inspectBlenderLocalPrograms(options)
  const bridge = await (options.bridge ?? blenderBridgeListening)()
  return { ...programs, addonBridgeListening: bridge }
}
