export type CodexUpdateMode = 'auto' | 'notify' | 'off'

export interface CodexSemanticVersion {
  raw: string
  major: number
  minor: number
  patch: number
  prerelease?: string
}

export interface CodexPackageManagerCandidate {
  name: string
  version: string
  binDirs: string[]
}

export declare function normalizeCodexUpdateMode(value: string): CodexUpdateMode
export declare function parseCodexVersion(value: unknown): CodexSemanticVersion | undefined
export declare function compareCodexVersions(
  left: string | CodexSemanticVersion,
  right: string | CodexSemanticVersion,
): -1 | 0 | 1
export declare function classifyCodexUpdate(
  current: string | CodexSemanticVersion,
  latest: string | CodexSemanticVersion,
): 'invalid' | 'current' | 'available' | 'ahead'
export declare function packageVersionFromListJson(value: unknown): string | undefined
export declare function chooseCodexPackageManager(input: {
  currentVersion: string
  codexPaths: string[]
  managers: CodexPackageManagerCandidate[]
}): string | undefined
export declare function inspectCodexUpdate(home?: string): {
  status: string
  managedStatus: string
  current?: string
  managedCurrent?: string
  latest?: string
  runtimeRoot: string
  manager?: string
  codexPaths: string[]
  managers: Array<{ name: string; version: string }>
}
