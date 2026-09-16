export type LocalModelMode = 'off' | 'on-demand' | 'always-on'

export type LocalModelPhase =
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

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

export interface LocalRuntimeManifest {
  version: string
  archiveName: string
  sourceUrl: string
  sha256: string
  archiveSizeBytes: number
  executableRelativePath: string
}

export interface LocalModelPersistentState {
  mode: LocalModelMode
  selectedModelId: string
  installedModelIds: string[]
}

export interface LocalModelProgress {
  receivedBytes: number
  totalBytes?: number
}

export interface LocalModelRuntimeError {
  code: string
  message: string
}

export interface LocalModelRuntimeSnapshot extends LocalModelPersistentState {
  phase: LocalModelPhase
  progress?: LocalModelProgress
  pid?: number
  port?: number
  baseUrl?: string
  error?: LocalModelRuntimeError
}
