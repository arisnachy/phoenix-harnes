/** Supported Phoenix Local runtime lifecycle policies. */
export type LocalModelMode = 'off' | 'on-demand' | 'always-on'

/** Exact model-native thinking value; null delegates to the Ollama default. */
export type LocalThinking = boolean | string | null

/** Only values reported by Ollama /api/show should be offered as named levels. */
export interface LocalThinkingCapabilities {
  values: Array<boolean | string>
  default: LocalThinking
}

/** Observable lifecycle phases for Phoenix Local. */
export type LocalModelPhase =
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

/** Shared metadata of a local device model, regardless of inference backend. */
interface LocalModelMetadata {
  id: string
  displayName: string
  sizeBytes: number
  estimatedRamBytes: number
  /** Runtime-allocated request context, not the upstream model's maximum. */
  contextWindow: number
  /** Native architecture limit, if independently known. */
  nativeContextWindow?: number
  maxTokens: number
  recommended: boolean
}

/** Distinguish an already installed Ollama model from a managed GGUF artifact. */
export type LocalModelCatalogEntry = LocalModelMetadata & (
  | {
    backend: 'ollama'
    ollamaModel: string
  }
  | {
    backend: 'llama-server'
    modelFileName: string
    sourceUrl: string
    sha256: string
  }
)

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
  /** User choice; existing Qwen installations keep their previous off default. */
  thinking?: LocalThinking
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
  thinkingCapabilities?: LocalThinkingCapabilities
}
