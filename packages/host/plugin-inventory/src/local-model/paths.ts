import path from 'node:path'

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

export function isManagedLocalModelPath(paths: LocalModelPaths, candidate: string): boolean {
  const api = pathApiFor(paths.platform)
  const root = api.resolve(paths.root)
  const resolved = api.resolve(candidate)
  const relative = api.relative(root, resolved)
  return relative === '' || (!relative.startsWith('..') && !api.isAbsolute(relative))
}

export function assertManagedLocalModelPath(paths: LocalModelPaths, candidate: string): string {
  if (!isManagedLocalModelPath(paths, candidate)) {
    throw new Error(`Refusing local-model path outside managed root: ${candidate}`)
  }
  return pathApiFor(paths.platform).resolve(candidate)
}
