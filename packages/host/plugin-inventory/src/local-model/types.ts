/** Supported Phoenix Local runtime lifecycle policies. */
export type LocalModelMode = 'off' | 'on-demand' | 'always-on'

/** Observable lifecycle phases for Phoenix Local. */
export type LocalModelPhase =
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

/** Immutable metadata for one supported local model artifact. */
export interface LocalModelCatalogEntry {
  id: string
  displayName: string
  modelFileName: string
  sourceUrl: string
  sha256: string
  sizeBytes: number
  estimatedRamBytes: number
  contextWindow: number
  maxTokens: number
  recommended: boolean
}

/** Pinned native inference runtime artifact for one platform target. */
export interface LocalRuntimeManifest {
  version: string
  archiveName: string
  sourceUrl: string
  sha256: string
  archiveSizeBytes: number
  executableRelativePath: string
}

/** Durable Phoenix Local preferences and installed-model inventory. */
export interface LocalModelPersistentState {
  mode: LocalModelMode
  selectedModelId: string
  installedModelIds: string[]
}

/** Byte-level progress for a Phoenix Local artifact download. */
export interface LocalModelProgress {
  receivedBytes: number
  totalBytes?: number
}

/** Sanitized Phoenix Local runtime error exposed outside the Host. */
export interface LocalModelRuntimeError {
  code: string
  message: string
}

/** Public runtime snapshot combining persistent state with transient process state. */
export interface LocalModelRuntimeSnapshot extends LocalModelPersistentState {
  phase: LocalModelPhase
  progress?: LocalModelProgress
  pid?: number
  port?: number
  baseUrl?: string
  error?: LocalModelRuntimeError
}
