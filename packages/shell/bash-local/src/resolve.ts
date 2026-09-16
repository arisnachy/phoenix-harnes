/** Host-aware bash executable resolution with a native Git Bash preference on Windows. */

import { spawnSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Candidate Git Bash executables in resolution order.
 * @param env - environment carrying the standard Windows installation roots.
 * @returns unique absolute candidate paths, highest priority first.
 */
export function candidateBashPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programW6432 = env.ProgramW6432
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)']
  const localAppData = env.LOCALAPPDATA
  const roots = [programW6432, programFiles, programFilesX86].filter((root): root is string => root !== undefined)
  const candidates = roots.map(root => join(root, 'Git', 'bin', 'bash.exe'))
  if (localAppData !== undefined) candidates.push(join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
  return [...new Set(candidates)]
}

function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** Default health-probe timeout; callers can override it for slower Windows hosts. */
export const DEFAULT_BASH_HEALTH_CHECK_TIMEOUT_MS = 2_000

/**
 * Probe a native Bash executable without creating captured child-process pipes.
 * @param candidate - executable path to probe.
 * @param timeoutMs - maximum probe duration in milliseconds.
 * @returns whether Bash completed a no-op command successfully.
 */
export function probeBashHealth(candidate: string, timeoutMs = DEFAULT_BASH_HEALTH_CHECK_TIMEOUT_MS): boolean {
  const result = spawnSync(candidate, ['-c', 'exit 0'], {
    stdio: 'ignore',
    timeout: timeoutMs,
    windowsHide: true,
  })
  return result.error === undefined && result.status === 0
}

/**
 * Resolve bash without selecting the Windows WSL application alias or an installed
 * executable that cannot start under the current Windows token.
 * @param configured - explicit executable override, when configured.
 * @param env - environment carrying Windows installation roots.
 * @param platform - host platform to resolve for.
 * @param probe - executable health probe, injectable for deterministic tests.
 * @param healthCheckTimeoutMs - maximum duration for the default health probe.
 * @returns the configured path, healthy native Git Bash path, or POSIX default.
 */
export function resolveBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: (candidate: string, timeoutMs: number) => boolean = probeBashHealth,
  healthCheckTimeoutMs = DEFAULT_BASH_HEALTH_CHECK_TIMEOUT_MS,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform === 'win32') {
    const existing = candidateBashPaths(env).filter(candidateExists)
    for (const candidate of existing) {
      if (probe(candidate, healthCheckTimeoutMs)) return candidate
    }
    const detail = existing.length === 0
      ? 'No native Git Bash executable was found.'
      : `Found ${existing.length} executable${existing.length === 1 ? '' : 's'}, but none passed the health check.`
    throw new Error(`PHOENIX requires a healthy Git Bash on Windows. ${detail} Install Git for Windows or configure bashPath explicitly.`)
  }
  return '/bin/bash'
}
