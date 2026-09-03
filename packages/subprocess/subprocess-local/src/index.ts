/**
 * Local Service Provider for the subprocess capability seam. Each spawn is a detached
 * process tree with the spec's per-stream stdio dispositions. Normal disposal
 * terminates and joins live trees; Node's synchronous exit phase force-stops
 * any trees the service still owns. It has no config: every disposition and
 * limit arrives on the spec, so the deployment-varying choices stay with the
 * caller's config (the bash executor's, the LSP host's, …).
 * @module @phoenix-ai/dsh-subprocess-local
 */

import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, resolve, win32 } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import * as nodePty from 'node-pty'
import type { IPtyForkOptions } from 'node-pty'
import { SubprocessRuntime } from '@phoenix-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@phoenix-ai/dsh-subprocess'
import { childEnv, spawnSubprocess } from './spawn.ts'
import type { LocalSubprocessHandle, SpawnInternals } from './spawn.ts'
import { createProcessInspector } from './process-inspector.ts'
import type { ProcessInspector } from './process-inspector.ts'
import { LocalTerminalHandle } from './terminal.ts'

/**
 * Windows package managers commonly install command shims outside the PATH
 * inherited by GUI-launched applications. Search those per-user CLI homes as
 * a fallback so a valid local install remains discoverable from Phoenix.
 *
 * Explicit PATH entries still win; these directories are only appended after
 * normal PATH resolution. Keeping the fallback generic also fixes other
 * user-installed CLIs without hard-coding a Codex-specific executable path.
 * @param env - Child environment used for case-insensitive Windows lookup.
 * @param platform - Platform override used by tests; defaults to the host platform.
 * @returns Ordered, de-duplicated per-user executable directories.
 */
export function supplementalExecutableDirectories(
  env: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return []
  const appData = environmentValue(env, 'APPDATA', platform)?.trim()
  const localAppData = environmentValue(env, 'LOCALAPPDATA', platform)?.trim()
  const pnpmHome = environmentValue(env, 'PNPM_HOME', platform)?.trim()
  const candidates = [
    pnpmHome,
    appData ? win32.join(appData, 'npm') : undefined,
    localAppData ? win32.join(localAppData, 'pnpm') : undefined,
  ].filter((value): value is string => value !== undefined && value.length > 0)
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const normalized = candidate.toLowerCase()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

/**
 * Resolve the explicit Codex Desktop executable hint when the app exposes it.
 * This is intentionally opt-in and command-specific: generic subprocess
 * resolution must not reinterpret arbitrary environment variables as binaries.
 * @param env - Child environment that may expose `CODEX_CLI_PATH`.
 * @param platform - Platform override used for Windows environment-key semantics.
 * @returns The trimmed configured Codex executable path, or `undefined` when absent.
 */
export function codexExecutableOverride(
  env: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const configured = environmentValue(env, 'CODEX_CLI_PATH', platform)?.trim()
  return configured && configured.length > 0 ? configured : undefined
}

/**
 * Build the Windows Codex Desktop executable directories. Current desktop
 * builds keep the CLI below `%LOCALAPPDATA%\\OpenAI\\Codex\\bin\\<hash>`;
 * the direct bin root is retained for forward/backward-compatible layouts.
 * @param env - Child environment used to locate `LOCALAPPDATA`.
 * @param childDirectories - One-level directory names observed below the Codex bin root.
 * @param platform - Platform override used by tests; defaults to the host platform.
 * @returns Ordered, de-duplicated Codex Desktop executable directories.
 */
export function windowsCodexDesktopExecutableDirectories(
  env: Readonly<NodeJS.ProcessEnv>,
  childDirectories: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return []
  const localAppData = environmentValue(env, 'LOCALAPPDATA', platform)?.trim()
  if (!localAppData) return []
  const root = win32.join(localAppData, 'OpenAI', 'Codex', 'bin')
  const seen = new Set<string>()
  return [root, ...childDirectories.map(directory => win32.join(root, directory))]
    .filter((directory) => {
      const normalized = directory.toLowerCase()
      if (seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
}

/**
 * Local subprocess service: detached process trees, Node-shaped stdio
 * dispositions (raw pipes, inherit, bounded tail-keep collection with spill
 * files), credential-scrubbed environment, and tree-scoped signalling with
 * SIGTERM→grace→SIGKILL escalation, plus synchronous final termination during
 * JavaScript-observable host exit.
 */
export class LocalSubprocessRuntime extends SubprocessRuntime {
  /** Live handles retained for normal disposal and synchronous host-exit finalization. */
  private live = new Set<LocalSubprocessHandle>()
  /** Live terminals retained through normal quiescence or host-exit finalization. */
  private terminals = new Set<LocalTerminalHandle>()
  /** Test hook: spill and platform knobs forwarded to spawnSubprocess. */
  internals: SpawnInternals = {}
  /** Test hook for platform process inspection; production resolves lazily on terminal spawn. */
  terminalInspector: ProcessInspector | undefined

  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => {
      const onHostExit = (): void => { this.terminateForHostExit() }
      process.prependListener('exit', onHostExit)
      return async () => {
        try {
          await this.disposeManagedProcesses()
        } finally {
          process.off('exit', onHostExit)
        }
      }
    }, 'local subprocess teardown')
  }

  private terminateForHostExit(): void {
    for (const handle of this.live) {
      try {
        handle.terminateForHostExit()
      } catch (_ordinaryTreeTerminationFailed) {
        // Host exit cannot await or report one target; continue with the rest.
      }
    }
    for (const terminal of this.terminals) {
      try {
        terminal.terminateForHostExit()
      } catch (_terminalTerminationFailed) {
        // One terminal must not prevent final termination of another target.
      }
    }
  }

  private async disposeManagedProcesses(): Promise<void> {
    // Terminate (escalating), then await WHOLE-TREE exit — not just the
    // direct child's settlement — so even a TERM-trapping descendant cannot
    // outlive the fiber. Keep both sets authoritative while these waits are
    // pending so a shorter process-level exit bound can still force-kill them.
    const pending: Promise<unknown>[] = []
    for (const handle of this.live) {
      handle.terminate()
      // Spawn-failure rejections already settled and left the live set.
      pending.push(handle.done.catch(() => {}).then(() => handle.waitForExit()))
    }
    for (const terminal of this.terminals) {
      pending.push(terminal.terminate())
    }
    const outcomes = await Promise.allSettled(pending)
    const failures = outcomes.flatMap<unknown>(outcome => outcome.status === 'rejected'
      ? [outcome.reason as unknown]
      : [])
    if (failures.length > 0) this.terminateForHostExit()
    this.live.clear()
    this.terminals.clear()
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'local subprocess teardown failed')
  }

  async resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (command.length === 0) throw new Error('subprocess-local: executable must be non-empty')
    signal?.throwIfAborted()
    const environment = childEnv(env)
    const absolute = isAbsolute(command)
    if (!absolute && (command.includes('/') || (process.platform === 'win32' && command.includes('\\')))) {
      throw new Error(
        `subprocess-local: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`,
      )
    }
    const explicitCodex = !absolute && command.toLowerCase() === 'codex'
      ? codexExecutableOverride(environment)
      : undefined
    const candidates = absolute ? [command] : [
      ...(explicitCodex && isAbsolute(explicitCodex) ? [explicitCodex] : []),
      ...this.executableCandidates(command, environment),
      ...await this.codexDesktopExecutableCandidates(command, environment, signal),
    ]
    const seen = new Set<string>()
    for (const candidate of candidates) {
      signal?.throwIfAborted()
      const normalized = process.platform === 'win32' ? candidate.toLowerCase() : candidate
      if (seen.has(normalized)) continue
      seen.add(normalized)
      try {
        const info = await stat(candidate)
        if (!info.isFile()) continue
        await access(candidate, constants.X_OK)
        signal?.throwIfAborted()
        return candidate
      } catch {
        // Try the next PATH/user-CLI/Desktop candidate; the final miss receives one stable error.
      }
    }
    signal?.throwIfAborted()
    throw new Error(absolute
      ? `subprocess-local: command ${JSON.stringify(command)} is not an executable file`
      : `subprocess-local: command ${JSON.stringify(command)} was not found on PATH or a supported user CLI location`)
  }

  private executableCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
    const path = environmentValue(env, 'PATH') ?? ''
    const extensions = process.platform === 'win32' && extname(command) === ''
      ? (environmentValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';')
      : ['']
    const directories = [
      ...path.split(delimiter).filter(directory => directory.length > 0),
      ...supplementalExecutableDirectories(env),
    ]
    const seen = new Set<string>()
    return directories.flatMap((directory) => {
      const normalized = process.platform === 'win32' ? directory.toLowerCase() : directory
      if (seen.has(normalized)) return []
      seen.add(normalized)
      return extensions.map(extension => resolve(process.cwd(), directory, command + extension))
    })
  }

  private async codexDesktopExecutableCandidates(
    command: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<string[]> {
    if (process.platform !== 'win32' || command.toLowerCase() !== 'codex') return []
    signal?.throwIfAborted()
    const localAppData = environmentValue(env, 'LOCALAPPDATA', 'win32')?.trim()
    if (!localAppData) return []
    const root = win32.join(localAppData, 'OpenAI', 'Codex', 'bin')
    let childDirectories: string[] = []
    try {
      const entries = await readdir(root, { withFileTypes: true })
      childDirectories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    } catch {
      // Desktop Codex is optional. A missing/inaccessible app directory simply
      // leaves normal PATH/npm/pnpm discovery authoritative.
    }
    signal?.throwIfAborted()
    const extensions = (environmentValue(env, 'PATHEXT', 'win32') ?? '.COM;.EXE;.BAT;.CMD').split(';')
    return windowsCodexDesktopExecutableDirectories(env, childDirectories, 'win32')
      .flatMap(directory => extensions.map(extension => win32.join(directory, command + extension)))
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = spawnSubprocess(spec, this.internals)
    this.live.add(handle)
    // Release ownership only once the whole TREE is gone, not at direct-child
    // settlement — a TERM-trapping helper that outlives the leader must stay
    // owned so teardown can still escalate it. For the common no-survivor
    // case waitForExit resolves immediately after settlement.
    const release = (): Promise<void> =>
      handle.waitForExit().then(() => { this.live.delete(handle) })
    handle.done.then(release, release)
    return handle
  }

  // Local PTY allocation is synchronous, but the provider contract permits remote asynchronous allocation.
  // oxlint-disable-next-line typescript/require-await -- Preserve promise rejection semantics at the async provider contract.
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    const file = spec.argv[0]
    if (file === undefined || file.length === 0) {
      throw new Error('subprocess-local: terminal argv must contain a program')
    }
    spec.signal?.throwIfAborted()
    const options: IPtyForkOptions = {
      name: 'dumb',
      rows: spec.rows,
      cols: spec.cols,
      cwd: spec.cwd,
      env: childEnv(spec.env),
    }
    const inspector = this.terminalInspector ?? createProcessInspector()
    const terminal = nodePty.spawn(file, [...spec.argv.slice(1)], options)
    const handle = new LocalTerminalHandle(terminal, inspector, spec.graceMs)
    this.terminals.add(handle)
    const release = async (): Promise<void> => {
      await handle.terminate()
      this.terminals.delete(handle)
    }
    void handle.done.then(release, release).catch(() => {})
    return handle
  }
}

/** Read an environment key using Windows' case-insensitive semantics when applicable. */
function environmentValue(
  env: Readonly<NodeJS.ProcessEnv>,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const exact = env[name]
  if (exact !== undefined || platform !== 'win32') return exact
  const normalized = name.toUpperCase()
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1]
}

export default LocalSubprocessRuntime