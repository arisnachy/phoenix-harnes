/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the `workspace-write` root, and the override kit (the
 * `sandbox/mode` event, its fold, and its write path, from `./session-mode.ts`).
 * Before each agent request, the owner also contributes the resolved policy to
 * the cache-safe runtime-context snapshot. The agent loop logs that snapshot as
 * model history, so replay reconstructs the same mode and root the enforcing
 * consumers resolve without rewriting the stable system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved policy here. The context describes that policy without inventorying
 * capabilities, while each backend retains its own enforcement dialect and each
 * tool owns its operation-specific denial and escalation guidance. The service
 * reads session state once at each operation boundary; executors and providers
 * remain session-free.
 *
 * PHOENIX HARDNESS self-protection is enabled by the launcher through
 * `PHOENIX_RUNTIME_ROOT`. While active, model-controlled capabilities never get
 * unconfined `danger-full-access`; it is reduced to `workspace-write`. A session
 * rooted at the live PHOENIX checkout or its durable data home is redirected to
 * the isolated `PHOENIX_EVOLUTION_ROOT` worktree when available, otherwise it
 * becomes read-only. This lets the model evolve PHOENIX without editing the
 * runtime that is currently executing it.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { canonicalPath, type SandboxExecutionPolicy, type SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { effectiveSandboxMode } from './session-mode.ts'

export { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from './session-mode.ts'

/** Resolve filesystem identity before lexical normalization can erase symlink-sensitive components. */
function resolveWorkspaceRoot(path: string): string {
  return resolvePath(canonicalPath(path))
}

/** Whether `candidate` is the same canonical location as `root` or lies beneath it. */
function isPathUnder(root: string, candidate: string): boolean {
  const relation = relative(resolveWorkspaceRoot(root), resolveWorkspaceRoot(candidate))
  return relation === ''
    || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

/** Two roots overlap when either one contains the other. */
function rootsOverlap(left: string, right: string): boolean {
  return isPathUnder(left, right) || isPathUnder(right, left)
}

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy, evolutionRoot: string | undefined): string {
  let text: string
  switch (policy.mode) {
    case 'read-only':
      text = 'Current PHOENIX file policy: read-only. Any available operation enforced by the PHOENIX file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.'
      break
    case 'workspace-write':
      text = `Current PHOENIX file policy: workspace-write. Any available operation enforced by the PHOENIX file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}. Some platform temporary areas may also be writable.`
      break
    case 'danger-full-access':
      text = 'Current PHOENIX file policy: danger-full-access. The PHOENIX file sandbox does not restrict file modifications by available operations.'
      break
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
  if (process.env.PHOENIX_RUNTIME_ROOT?.trim().length === 0 || process.env.PHOENIX_RUNTIME_ROOT === undefined) return text
  const destination = evolutionRoot === undefined
    ? 'No isolated evolution worktree is currently available, so self-modification of the live runtime remains read-only.'
    : `Self-modification must target the isolated evolution worktree ${JSON.stringify(evolutionRoot)}; validate changes there before promotion.`
  return `${text} PHOENIX HARDNESS runtime protection is active: model-controlled file and shell operations cannot write the live PHOENIX installation or its durable internal data home. ${destination}`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy but not HARDNESS runtime protection. */
  mode?: SandboxMode
}

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback workspace root, and current request-time policy
 * section. Tool layers call {@link resolve} for each execution so a session's
 * mode log and immutable cwd travel together to every enforcing capability.
 */
export class SandboxPolicyService extends Service {
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    workspaceRoot: z.string(),
  })

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  /** Canonical live PHOENIX root protected from model-controlled writes. */
  private readonly phoenixRuntimeRoot: string | undefined
  /** Canonical durable PHOENIX data home protected from raw model-controlled writes. */
  private readonly phoenixDataHome: string | undefined
  /** Canonical writable worktree used for PHOENIX self-evolution. */
  private readonly phoenixEvolutionRoot: string | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    this.defaultMode = config.mode as SandboxMode
    this.workspaceRoot = resolveWorkspaceRoot(config.workspaceRoot ?? process.cwd())

    const runtimeRoot = process.env.PHOENIX_RUNTIME_ROOT?.trim()
    this.phoenixRuntimeRoot = runtimeRoot === undefined || runtimeRoot.length === 0
      ? undefined
      : resolveWorkspaceRoot(runtimeRoot)
    const configuredDataHome = process.env.DSH_HOME?.trim()
    this.phoenixDataHome = this.phoenixRuntimeRoot === undefined
      ? undefined
      : resolveWorkspaceRoot(configuredDataHome === undefined || configuredDataHome.length === 0
        ? join(homedir(), '.dsh')
        : configuredDataHome)
    const evolutionRoot = process.env.PHOENIX_EVOLUTION_ROOT?.trim()
    const resolvedEvolutionRoot = evolutionRoot === undefined || evolutionRoot.length === 0
      ? undefined
      : resolveWorkspaceRoot(evolutionRoot)
    this.phoenixEvolutionRoot = resolvedEvolutionRoot !== undefined
      && this.phoenixRuntimeRoot !== undefined
      && this.phoenixDataHome !== undefined
      && !rootsOverlap(resolvedEvolutionRoot, this.phoenixRuntimeRoot)
      && !rootsOverlap(resolvedEvolutionRoot, this.phoenixDataHome)
      ? resolvedEvolutionRoot
      : undefined

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: 110,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }), this.phoenixEvolutionRoot)
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode outranks the session's last `sandbox/mode` event, which outranks the
   * deployment default. HARDNESS protection then clamps the result: the live
   * runtime/data roots are never writable through model-controlled capabilities,
   * and unconfined access becomes workspace-confined while protection is active.
   * @param request - optional session and approved mode override.
   * @returns the fully resolved per-call mode and absolute workspace root.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    const requestedMode = request.mode ?? (session === undefined ? undefined : this.overrideOf(session)) ?? this.defaultMode
    const requestedRoot = resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot)
    const sessionId = session === undefined ? {} : { sessionId: session.id }

    if (this.phoenixRuntimeRoot === undefined || this.phoenixDataHome === undefined) {
      return { mode: requestedMode, workspaceRoot: requestedRoot, ...sessionId }
    }

    const protectedWorkspace = rootsOverlap(requestedRoot, this.phoenixRuntimeRoot)
      || rootsOverlap(requestedRoot, this.phoenixDataHome)
    if (protectedWorkspace) {
      if (requestedMode === 'read-only' || this.phoenixEvolutionRoot === undefined) {
        return { mode: 'read-only', workspaceRoot: requestedRoot, ...sessionId }
      }
      return { mode: 'workspace-write', workspaceRoot: this.phoenixEvolutionRoot, ...sessionId }
    }

    const mode = requestedMode === 'danger-full-access' ? 'workspace-write' : requestedMode
    return { mode, workspaceRoot: requestedRoot, ...sessionId }
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return effectiveSandboxMode(session.events)
  }
}

export default SandboxPolicyService
