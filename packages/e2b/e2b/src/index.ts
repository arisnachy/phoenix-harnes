/**
 * Shared ownership of one E2B sandbox. Capability adapters await the same SDK
 * handle, so filesystem and process operations inhabit one remote Linux world.
 * The runtime can create or reconnect to an existing sandbox and has an
 * explicit disposal-retention policy, making long-horizon execution resumable
 * without changing the historical kill-on-dispose default.
 * @module @phoenix-ai/dsh-e2b
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { FileType, Sandbox, SandboxNotFoundError } from 'e2b'

export {
  CommandExitError,
  FileNotFoundError,
  FileType,
  Sandbox,
  SandboxNotFoundError,
} from 'e2b'
export type { CommandHandle, CommandResult, EntryInfo } from 'e2b'

/** What PHOENIX should do with a live remote sandbox when this runtime disposes. */
export type E2BRetention = 'kill' | 'pause' | 'retain'

/**
 * Quote one opaque argument for the SDK's unavoidable `/bin/bash -l -c` layer.
 * @param value - Exact argument value to preserve.
 * @returns A single shell word with no interpolation.
 */
export function quoteE2BShellArg(value: string): string {
  return `'${value.replaceAll('\'', "'\"'\"'")}'`
}

/**
 * Isolate E2B's hard-coded login shell behind a fresh randomized home path.
 * @param overrides - Additional environment entries for the internal command.
 * @returns A fresh mutable map that the E2B SDK may extend.
 */
export function e2bControlEnvs(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { ...overrides, HOME: `/.dsh-e2b-control-${randomUUID()}` }
}

/** Configuration for the shared E2B sandbox owner. */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds. */
  timeoutMs?: number
  /** Existing sandbox id to reconnect to instead of creating a new sandbox. */
  sandboxId?: string
  /** What disposal does with the live sandbox. Default `kill` preserves historical behavior. */
  retention?: E2BRetention
  /** Pause rather than kill a newly-created sandbox when its E2B timeout elapses. */
  autoPause?: boolean
}

/** Pure lifecycle subset used by config/UI/tests without requiring an API key. */
export interface E2BLifecycleConfig {
  sandboxId: string | undefined
  retention: E2BRetention
  autoPause: boolean
}

/**
 * Resolve and validate the lifecycle-only configuration.
 * @param config - User/deployment configuration.
 * @returns Explicit lifecycle values with backward-compatible defaults.
 */
export function resolveE2BLifecycleConfig(config: Pick<Config, 'sandboxId' | 'retention' | 'autoPause' | 'cwd' | 'timeoutMs'>): E2BLifecycleConfig {
  const sandboxId = config.sandboxId?.trim()
  if (config.sandboxId !== undefined && sandboxId === '') {
    throw new Error('dsh-e2b: sandboxId must be a non-empty string when configured')
  }
  const retention = config.retention ?? 'kill'
  if (retention !== 'kill' && retention !== 'pause' && retention !== 'retain') {
    throw new Error(`dsh-e2b: unsupported retention policy ${String(retention)}`)
  }
  return {
    sandboxId,
    retention,
    autoPause: config.autoPause ?? false,
  }
}

interface ResolvedConfig extends E2BLifecycleConfig {
  apiKey: string
  cwd: string
  timeoutMs: number
}

interface SchemaResolvedConfig extends Config {
  cwd: string
  timeoutMs: number
  retention: E2BRetention
  autoPause: boolean
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    e2b: E2BRuntime
  }
}

/**
 * Owns one lazily consumable E2B SDK handle. The runtime either creates a
 * sandbox or reconnects to `sandboxId`; reconnecting a paused E2B sandbox
 * resumes it through the SDK. Adapters await {@link getSandbox} before their
 * first operation.
 */
export class E2BRuntime extends Service {
  static Config: z<Config> = z.object({
    apiKey: z.string(),
    cwd: z.string().default('/home/user/workspace'),
    timeoutMs: z.number().default(300_000),
    sandboxId: z.string(),
    retention: z.union(['kill', 'pause', 'retain'] as const).default('kill'),
    autoPause: z.boolean().default(false),
  })

  /** Validated remote working directory shared by provider adapters. */
  readonly cwd: string
  /** Remote directory reserved for adapter-owned process and terminal state. */
  readonly runtimeRoot: string

  private readonly config: ResolvedConfig
  private readonly ready: Promise<Sandbox>
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'e2b')
    // Schemastery fills these fields before construction; the type does not encode that step.
    const resolved = config as SchemaResolvedConfig
    const apiKey = config.apiKey ?? process.env.E2B_API_KEY
    const lifecycle = resolveE2BLifecycleConfig(resolved)
    this.config = {
      apiKey: apiKey ?? '',
      cwd: resolved.cwd,
      timeoutMs: resolved.timeoutMs,
      ...lifecycle,
    }
    this.validate()
    this.cwd = this.config.cwd
    this.runtimeRoot = posix.join(this.cwd, '.dsh-e2b')
    this.ready = this.open()
    // A deployment may load the owner before any adapter uses it. Keep a
    // failed eager connection observed; getSandbox() still returns the error.
    void this.ready.catch(() => {})

    ctx.effect(() => async () => {
      this.disposed = true
      let sandbox: Sandbox
      try {
        sandbox = await this.ready
      } catch (_sandboxSetupFailure) {
        // open() either acquired no sandbox or already rolled back a newly-created one.
        return
      }
      await this.release(sandbox)
    }, 'e2b sandbox teardown')
  }

  /**
   * Return the shared live SDK handle.
   * @returns the created or reconnected sandbox after the configured cwd exists.
   * @throws when E2B rejects creation/connection or the service is disposing.
   */
  async getSandbox(): Promise<Sandbox> {
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    const sandbox = await this.ready
    // Disposal can race the awaited sandbox readiness despite the synchronous precheck.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- Awaiting readiness yields to disposal.
    if (this.disposed) throw new Error('E2B sandbox service is disposing')
    return sandbox
  }

  /**
   * Return the durable E2B identity callers can persist for a later reconnect.
   * @returns The live sandbox id after setup/reconnect succeeds.
   */
  async getSandboxId(): Promise<string> {
    return (await this.getSandbox()).sandboxId
  }

  /** The configured retention stance, useful to diagnostics without exposing credentials. */
  get retention(): E2BRetention {
    return this.config.retention
  }

  private validate(): void {
    if (this.config.apiKey.length === 0) {
      throw new Error('dsh-e2b: configure apiKey or set E2B_API_KEY')
    }
    if (!posix.isAbsolute(this.config.cwd)) {
      throw new Error(`dsh-e2b: cwd must be an absolute Linux path: ${this.config.cwd}`)
    }
    if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs <= 0) {
      throw new Error('dsh-e2b: timeoutMs must be a positive finite number')
    }
  }

  /** Create/reconnect, then idempotently establish PHOENIX's private remote directories. */
  private async open(): Promise<Sandbox> {
    const reconnecting = this.config.sandboxId !== undefined
    const sandbox = reconnecting
      ? await Sandbox.connect(this.config.sandboxId as string, { apiKey: this.config.apiKey })
      : await Sandbox.create({
          apiKey: this.config.apiKey,
          timeoutMs: this.config.timeoutMs,
          secure: true,
          lifecycle: { onTimeout: this.config.autoPause ? 'pause' : 'kill' },
        })
    try {
      // A reconnect adopts this runtime's requested lease from now, rather
      // than silently inheriting an arbitrary remaining timeout.
      if (reconnecting) await sandbox.setTimeout(this.config.timeoutMs)
      await sandbox.files.makeDir(this.cwd)
      await sandbox.files.makeDir(this.runtimeRoot)
      const runtimeRoot = await sandbox.files.getInfo(this.runtimeRoot)
      if (runtimeRoot.type !== FileType.DIR || runtimeRoot.symlinkTarget !== undefined) {
        throw new Error(`dsh-e2b: runtime root must be a real directory: ${this.runtimeRoot}`)
      }
      await sandbox.commands.run(
        `chmod 700 -- ${quoteE2BShellArg(this.runtimeRoot)}`,
        { envs: e2bControlEnvs() },
      )
      return sandbox
    } catch (error: unknown) {
      // Never destroy a sandbox supplied by id merely because this PHOENIX
      // process failed to adopt it. Newly-created sandboxes retain the old
      // fail-closed rollback behavior.
      if (!reconnecting) {
        try {
          await sandbox.kill()
        } catch (_sandboxSetupRollbackFailure) {
          // The remote lease will still expire under E2B's lifecycle policy.
        }
      }
      throw error
    }
  }

  /** Apply the explicit disposal retention policy; missing sandboxes are already released. */
  private async release(sandbox: Sandbox): Promise<void> {
    if (this.config.retention === 'retain') return
    try {
      if (this.config.retention === 'pause') {
        await sandbox.betaPause()
        return
      }
      await sandbox.kill()
    } catch (error: unknown) {
      if (!(error instanceof SandboxNotFoundError)) throw error
    }
  }
}

export default E2BRuntime
