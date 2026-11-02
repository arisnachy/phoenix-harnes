/** Literal Windows startup operation for the durable owner checkout. */
import { isAbsolute, join } from 'node:path'
import type { SubprocessSpawnSpec } from '@phoenix-ai/dsh-subprocess'

/** Build an owner-selected startup operation without shell interpolation.
 * @param root Durable installation checkout.
 * @param enabled Whether to install or remove the owned startup shortcut.
 * @param env Windows executable location.
 * @returns Managed subprocess specification.
 */
export function mailStartupSpec(root: string, enabled: boolean, env: NodeJS.ProcessEnv): SubprocessSpawnSpec {
  if (!isAbsolute(root)) throw new Error('mail startup requires an absolute installation root')
  const systemRoot = env.SystemRoot ?? env.WINDIR
  return {
    argv: [systemRoot === undefined ? 'powershell.exe' : join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'phoenix-assistant-startup.ps1'), '-Root', root, '-Enabled', String(enabled)],
    cwd: root, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1500,
    signal: AbortSignal.timeout(30_000),
  }
}
