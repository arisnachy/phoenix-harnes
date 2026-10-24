/**
 * Trusted, read-only view of the Phoenix execution runtimes.
 *
 * The updater module is intentionally loaded from the launcher-owned Phoenix
 * root. Browser input can select only an OpenClaw version; it cannot provide a
 * module path, candidate metadata, executable, or environment.
 */

import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { readPhoenixUpdateSnapshot } from './update-state.ts'
import type {
  EngineRuntimePrepareReceipt,
  EngineRuntimeSnapshot,
  EngineRuntimeStatus,
  PhoenixUpdateStatus,
} from './types.ts'

interface EngineRuntimeManager {
  readonly ENGINE_RUNTIME_SAFETY_VERSION?: number
  prepareOpenClawOfficial?(options: { home: string; version: string; applyRetention: true; retentionConfirm: true }): Promise<unknown>
  inspectExecutionEngines(options?: {
    home?: string
    phoenixRoot?: string
    phoenixControlDirectory?: string
  }): Promise<unknown>
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/iu
const PHOENIX_STATUSES: ReadonlySet<PhoenixUpdateStatus> = new Set([
  'idle', 'checking', 'current', 'available', 'preparing', 'ready', 'restarting',
  'applying', 'rolling-back', 'updated', 'rolled-back', 'paused', 'error',
  'rollback-failed', 'off',
])
let managerPromise: Promise<EngineRuntimeManager | undefined> | undefined

function phoenixRoot(): string {
  const configured = process.env.PHOENIX_RUNTIME_ROOT?.trim()
  return resolve(configured === undefined || configured.length === 0 ? process.cwd() : configured)
}

/** Resolve the launcher-owned updater module; callers cannot override this path. */
function managerPath(): string {
  return join(phoenixRoot(), 'scripts', 'phoenix-engine-runtime.mjs')
}

async function loadManager(): Promise<EngineRuntimeManager | undefined> {
  if (managerPromise === undefined) {
    managerPromise = import(pathToFileURL(managerPath()).href).then((module: unknown) => {
      if (typeof module !== 'object' || module === null) return undefined
      const value = module as Partial<EngineRuntimeManager>
      return typeof value.inspectExecutionEngines === 'function' ? value as EngineRuntimeManager : undefined
    }).catch(() => undefined)
  }
  return managerPromise
}

function status(value: unknown): EngineRuntimeStatus {
  if (value === 'active' || value === 'prepared' || value === 'stopped' || value === 'unavailable') return value
  return 'unavailable'
}

function version(value: unknown): string | undefined {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : undefined
}

function runtimeEntry(value: unknown): EngineRuntimeSnapshot['codex'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'unavailable', diagnostic: 'ENGINE_STATUS_INVALID' }
  }
  const candidate = value as Record<string, unknown>
  const current = status(candidate.status)
  const resolvedVersion = version(candidate.version)
  return {
    status: current,
    ...(resolvedVersion === undefined ? {} : { version: resolvedVersion }),
    ...(current === 'unavailable' && resolvedVersion === undefined
      ? { diagnostic: 'ENGINE_UNAVAILABLE' } : {}),
  }
}

function commit(value: unknown): string | undefined {
  return typeof value === 'string' && COMMIT_PATTERN.test(value) ? value : undefined
}

function phoenixStatus(value: unknown): PhoenixUpdateStatus | undefined {
  return typeof value === 'string' && PHOENIX_STATUSES.has(value as PhoenixUpdateStatus)
    ? value as PhoenixUpdateStatus : undefined
}

/** Sanitize updater state before it crosses the Host boundary.
 * @param value - Untrusted updater projection read from the launcher-owned manager.
 * @returns A bounded Phoenix status with validated commit references and no secrets.
 */
export function sanitizePhoenixRuntimeState(value: unknown): EngineRuntimeSnapshot['phoenix'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { status: 'error', diagnostic: 'PHOENIX_UPDATE_STATUS_INVALID' }
  }
  const candidate = value as Record<string, unknown>
  const currentStatus = phoenixStatus(candidate.status)
  if (currentStatus === undefined) {
    return { status: 'error', diagnostic: 'PHOENIX_UPDATE_STATUS_UNKNOWN' }
  }
  const current = commit(candidate.current)
  const target = commit(candidate.target)
  const invalidReference = (candidate.current !== undefined && current === undefined)
    || (candidate.target !== undefined && target === undefined)
  return {
    status: currentStatus,
    ...(current === undefined ? {} : { current }),
    ...(target === undefined ? {} : { target }),
    ...(invalidReference ? { diagnostic: 'PHOENIX_UPDATE_REFERENCE_INVALID' } : {}),
  }
}

/**
 * Read runtime versions and prepared/active state without exposing paths,
 * process ids, command lines, or credentials.
 * @returns A secret-free runtime snapshot suitable for Settings.
 */
export async function inspectEngineRuntime(): Promise<EngineRuntimeSnapshot> {
  const manager = await loadManager()
  if (manager === undefined) {
    return {
      checkedAt: new Date().toISOString(),
      codex: { status: 'unavailable', diagnostic: 'PHOENIX_RUNTIME_MANAGER_UNAVAILABLE' },
      openclaw: { status: 'unavailable', diagnostic: 'PHOENIX_RUNTIME_MANAGER_UNAVAILABLE' },
      phoenix: { status: 'error', diagnostic: 'PHOENIX_RUNTIME_MANAGER_UNAVAILABLE' },
    }
  }
  try {
    const raw = await manager.inspectExecutionEngines({ home: dshHomePath(), phoenixRoot: phoenixRoot() })
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('invalid runtime snapshot')
    const record = raw as Record<string, unknown>
    const engines = record.engines
    const source = typeof engines === 'object' && engines !== null && !Array.isArray(engines)
      ? engines as Record<string, unknown> : {}
    // Keep Phoenix update state sourced from the Host bridge as well. This
    // remains readable if the optional manager is present but has no state.
    return {
      checkedAt: new Date().toISOString(),
      codex: runtimeEntry(source.codex),
      openclaw: runtimeEntry(source.openclaw),
      phoenix: sanitizePhoenixRuntimeState(readPhoenixUpdateSnapshot(phoenixRoot())),
    }
  } catch {
    return {
      checkedAt: new Date().toISOString(),
      codex: { status: 'unavailable', diagnostic: 'ENGINE_STATUS_UNAVAILABLE' },
      openclaw: { status: 'unavailable', diagnostic: 'ENGINE_STATUS_UNAVAILABLE' },
      phoenix: sanitizePhoenixRuntimeState(readPhoenixUpdateSnapshot(phoenixRoot())),
    }
  }
}

/**
 * Prepare through a manager with verified installer quiescence and tree validation.
 * Lifecycle operations remain outside the public mutation surface.
 * @param requestedVersion - exact semantic OpenClaw version requested by the user.
 * @returns Sanitized preparation result with no local paths.
 */
export async function prepareEngineRuntime(requestedVersion: string): Promise<EngineRuntimePrepareReceipt> {
  const candidate = requestedVersion.trim()
  if (!VERSION_PATTERN.test(candidate)) return { status: 'blocked', diagnostic: 'OPENCLAW_VERSION_INVALID' }
  const manager = await loadManager()
  if (manager?.ENGINE_RUNTIME_SAFETY_VERSION !== 2 || manager.prepareOpenClawOfficial === undefined) {
    return { status: 'blocked', diagnostic: 'OPENCLAW_INSTALLER_UNVERIFIED' }
  }
  try {
    const value = await manager.prepareOpenClawOfficial({ home: dshHomePath(),
      version: candidate,
      applyRetention: true,
      retentionConfirm: true })
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid receipt')
    const receipt = value as Record<string, unknown>
    if (receipt.status === 'already-active' && receipt.version === candidate) return { status: 'already-active', version: candidate }
    if (receipt.status === 'prepared' && typeof receipt.candidate === 'object' && receipt.candidate !== null
      && (receipt.candidate as Record<string, unknown>).version === candidate) return { status: 'prepared', version: candidate }
    if (receipt.status === 'blocked') {
      const allowed = new Set(['ACTIVE_RUNTIME_CONFLICT',
        'OPENCLAW_RUNTIME_BUSY',
        'OPENCLAW_LIFECYCLE_BUSY',
        'OPENCLAW_INSTALLER_TREE_UNCERTAIN', 'OPENCLAW_PROCESS_TREE_UNCERTAIN'])
      return { status: 'blocked',
        diagnostic: typeof receipt.code === 'string'
        && allowed.has(receipt.code) ? receipt.code : 'OPENCLAW_PREPARATION_BLOCKED' }
    }
    return { status: 'error', diagnostic: 'OPENCLAW_PREPARATION_RESULT_INVALID' }
  } catch {
    return { status: 'error', diagnostic: 'OPENCLAW_PREPARATION_FAILED' }
  }
}
