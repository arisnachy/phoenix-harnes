import path from 'node:path'

/** Managed filesystem locations owned by the Phoenix Local runtime. */
export interface LocalModelPaths {
  root: string
  modelsDir: string
  runtimesDir: string
  downloadsDir: string
  statePath: string
  platform: string
}

function pathApiFor(platform: string): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

/**
 * Build normalized managed paths below the Phoenix Local root.
 * @param root - Filesystem root dedicated to Phoenix Local.
 * @param platform - Node platform whose path semantics should be used.
 * @returns Normalized managed Phoenix Local paths.
 */
export function createLocalModelPaths(root: string, platform: string = process.platform): LocalModelPaths {
  const api = pathApiFor(platform)
  const normalizedRoot = api.resolve(root)
  return {
    root: normalizedRoot,
    modelsDir: api.join(normalizedRoot, 'models'),
    runtimesDir: api.join(normalizedRoot, 'runtimes'),
    downloadsDir: api.join(normalizedRoot, 'downloads'),
    statePath: api.join(normalizedRoot, 'state.json'),
    platform,
  }
}

/**
 * Check whether a candidate path remains inside the managed Phoenix Local root.
 * @param paths - Managed Phoenix Local path set.
 * @param candidate - Candidate filesystem path.
 * @returns Whether the resolved candidate is contained by the managed root.
 */
export function isManagedLocalModelPath(paths: LocalModelPaths, candidate: string): boolean {
  const api = pathApiFor(paths.platform)
  const root = api.resolve(paths.root)
  const resolved = api.resolve(candidate)
  const relative = api.relative(root, resolved)
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative))
}

/**
 * Resolve a candidate path and reject it if it escapes the managed Phoenix Local root.
 * @param paths - Managed Phoenix Local path set.
 * @param candidate - Candidate filesystem path.
 * @returns The resolved candidate path when it is safe to manage.
 */
export function assertManagedLocalModelPath(paths: LocalModelPaths, candidate: string): string {
  if (!isManagedLocalModelPath(paths, candidate)) {
    throw new Error(`Refusing local-model path outside managed root: ${candidate}`)
  }
  return pathApiFor(paths.platform).resolve(candidate)
}
