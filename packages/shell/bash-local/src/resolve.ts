/** Host-aware bash executable resolution with a native Git Bash preference on Windows. */

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

/**
 * Resolve bash without selecting the Windows WSL application alias.
 * @param configured - explicit executable override, when configured.
 * @param env - environment carrying Windows installation roots.
 * @param platform - host platform to resolve for.
 * @returns the configured path, native Git Bash path, or POSIX default.
 */
export function resolveBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform === 'win32') {
    for (const candidate of candidateBashPaths(env)) {
      if (candidateExists(candidate)) return candidate
    }
    throw new Error('PHOENIX requires Git Bash on Windows. Install Git for Windows or configure bashPath explicitly.')
  }
  return '/bin/bash'
}
