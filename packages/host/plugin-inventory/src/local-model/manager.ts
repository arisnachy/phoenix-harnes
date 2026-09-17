import path from 'node:path'
import { getLocalModel, getRuntimeManifest } from './catalog.js'
import {
  LocalModelRuntimeFault,
  type ArtifactDownloadRequest,
  type ArtifactDownloadResult,
} from './download.js'
import { assertManagedLocalModelPath, type LocalModelPaths } from './paths.js'
import type { LocalModelStateStore } from './state.js'
import type {
  LocalModelMode,
  LocalModelPersistentState,
  LocalModelRuntimeError,
  LocalModelRuntimeSnapshot,
} from './types.js'

export { LocalModelRuntimeFault } from './download.js'

/** Handle for a running local inference server process. */
export interface LocalServerHandle {
  readonly pid?: number
  stop(): Promise<void>
}

/** Injectable operating-system dependencies used by the Phoenix Local runtime manager. */
export interface LocalModelRuntimeManagerDependencies {
  platform: string
  arch: string
  paths: LocalModelPaths
  stateStore: LocalModelStateStore
  downloadArtifact(request: ArtifactDownloadRequest): Promise<ArtifactDownloadResult>
  extractArchive(archivePath: string, destinationDir: string): Promise<void>
  pathExists(target: string): Promise<boolean>
  mkdir(target: string, options?: { recursive?: boolean }): Promise<unknown>
  remove(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<unknown>
  allocatePort(): Promise<number>
  spawnServer(executable: string, args: string[], onExit: (error?: Error) => void): LocalServerHandle
  probeHealth(baseUrl: string, timeoutMs: number): Promise<void>
  freeMemoryBytes(): number
}

/** Lifecycle API for installing, starting, stopping, and configuring Phoenix Local. */
export interface LocalModelRuntimeManager {
  snapshot(): LocalModelRuntimeSnapshot
  subscribe(listener: (snapshot: LocalModelRuntimeSnapshot) => void): () => void
  install(modelId: string): Promise<LocalModelRuntimeSnapshot>
  start(): Promise<LocalModelRuntimeSnapshot>
  ensureRunning(): Promise<string>
  stop(): Promise<LocalModelRuntimeSnapshot>
  uninstall(modelId: string): Promise<LocalModelRuntimeSnapshot>
  setMode(mode: LocalModelMode): Promise<LocalModelRuntimeSnapshot>
  setDefaultModel(modelId: string): Promise<LocalModelRuntimeSnapshot>
  dispose(): Promise<void>
}

const MEMORY_HEADROOM_BYTES = 1_000_000_000
const HEALTH_TIMEOUT_MS = 60_000

function apiFor(platform: string): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

function fault(error: unknown, fallbackCode: string, fallbackMessage: string): LocalModelRuntimeFault {
  if (error instanceof LocalModelRuntimeFault) return error
  return new LocalModelRuntimeFault(fallbackCode, fallbackMessage, { cause: error })
}

function cloneSnapshot(snapshot: LocalModelRuntimeSnapshot): LocalModelRuntimeSnapshot {
  return structuredClone(snapshot)
}

class RuntimeManager implements LocalModelRuntimeManager {
  private readonly listeners = new Set<(snapshot: LocalModelRuntimeSnapshot) => void>()
  private persistent: LocalModelPersistentState
  private current: LocalModelRuntimeSnapshot
  private server: LocalServerHandle | undefined
  private ensureRunningPromise: Promise<string> | undefined

  constructor(
    private readonly dependencies: LocalModelRuntimeManagerDependencies,
    persistent: LocalModelPersistentState,
  ) {
    this.persistent = structuredClone(persistent)
    this.current = {
      ...structuredClone(persistent),
      phase: persistent.installedModelIds.includes(persistent.selectedModelId) ? 'ready' : 'not-installed',
    }
  }

  snapshot(): LocalModelRuntimeSnapshot {
    return cloneSnapshot(this.current)
  }

  subscribe(listener: (snapshot: LocalModelRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(next: LocalModelRuntimeSnapshot): void {
    this.current = cloneSnapshot(next)
    const publicSnapshot = this.snapshot()
    for (const listener of this.listeners) listener(publicSnapshot)
  }

  private publishPhase(phase: LocalModelRuntimeSnapshot['phase']): void {
    this.publish({ ...this.current, phase })
  }

  private publishError(error: LocalModelRuntimeFault): void {
    const publicError: LocalModelRuntimeError = { code: error.code, message: error.message }
    this.publish({ ...this.current, phase: 'error', error: publicError })
  }

  private async savePersistent(next: LocalModelPersistentState): Promise<void> {
    await this.dependencies.stateStore.save(next)
    this.persistent = structuredClone(next)
    this.current = { ...this.current, ...structuredClone(next) }
  }

  private modelPath(modelId: string): string {
    const model = getLocalModel(modelId)
    if (model === undefined) throw new LocalModelRuntimeFault('unknown-model', `Modelo local desconocido: ${modelId}`)
    const target = apiFor(this.dependencies.platform).join(this.dependencies.paths.modelsDir, model.modelFileName)
    return assertManagedLocalModelPath(this.dependencies.paths, target)
  }

  private runtimePaths(): { archivePath: string; runtimeDir: string; executablePath: string } {
    const runtime = getRuntimeManifest(this.dependencies.platform, this.dependencies.arch)
    if (runtime === undefined) {
      throw new LocalModelRuntimeFault(
        'unsupported-platform',
        `Phoenix Local todavía no tiene un runtime verificado para ${this.dependencies.platform}/${this.dependencies.arch}.`,
      )
    }
    const api = apiFor(this.dependencies.platform)
    const archivePath = assertManagedLocalModelPath(
      this.dependencies.paths,
      api.join(this.dependencies.paths.downloadsDir, runtime.archiveName),
    )
    const runtimeDir = assertManagedLocalModelPath(
      this.dependencies.paths,
      api.join(this.dependencies.paths.runtimesDir, runtime.version),
    )
    const executablePath = assertManagedLocalModelPath(
      this.dependencies.paths,
      api.join(runtimeDir, runtime.executableRelativePath),
    )
    return { archivePath, runtimeDir, executablePath }
  }

  async install(modelId: string): Promise<LocalModelRuntimeSnapshot> {
    const model = getLocalModel(modelId)
    if (model === undefined) throw new LocalModelRuntimeFault('unknown-model', `Modelo local desconocido: ${modelId}`)
    const runtime = getRuntimeManifest(this.dependencies.platform, this.dependencies.arch)
    if (runtime === undefined) {
      throw new LocalModelRuntimeFault(
        'unsupported-platform',
        `Phoenix Local todavía no tiene un runtime verificado para ${this.dependencies.platform}/${this.dependencies.arch}.`,
      )
    }
    const { archivePath, runtimeDir, executablePath } = this.runtimePaths()
    const modelPath = this.modelPath(modelId)
    this.publish({ ...this.current, phase: 'installing', progress: { receivedBytes: 0 } })
    try {
      await this.dependencies.mkdir(this.dependencies.paths.downloadsDir, { recursive: true })
      await this.dependencies.mkdir(this.dependencies.paths.modelsDir, { recursive: true })
      await this.dependencies.mkdir(this.dependencies.paths.runtimesDir, { recursive: true })
      await this.dependencies.downloadArtifact({
        sourceUrl: runtime.sourceUrl,
        destinationPath: archivePath,
        expectedSha256: runtime.sha256,
        expectedSizeBytes: runtime.archiveSizeBytes,
        onProgress: progress => {
          if (this.current.phase === 'installing') this.publish({ ...this.current, progress })
        },
      })
      await this.dependencies.remove(runtimeDir, { recursive: true, force: true })
      await this.dependencies.extractArchive(archivePath, runtimeDir)
      if (!await this.dependencies.pathExists(executablePath)) {
        throw new LocalModelRuntimeFault('runtime-invalid', 'llama-server no apareció después de extraer el runtime verificado.')
      }
      await this.dependencies.downloadArtifact({
        sourceUrl: model.sourceUrl,
        destinationPath: modelPath,
        expectedSha256: model.sha256,
        expectedSizeBytes: model.sizeBytes,
        onProgress: progress => {
          if (this.current.phase === 'installing') this.publish({ ...this.current, progress })
        },
      })
      const installedModelIds = [...new Set([...this.persistent.installedModelIds, modelId])]
      await this.savePersistent({ ...this.persistent, selectedModelId: modelId, installedModelIds })
      this.publish({ ...this.current, phase: 'ready' })
      if (this.current.mode === 'always-on') await this.start()
      return this.snapshot()
    } catch (error) {
      const runtimeError = fault(error, 'install-failed', 'No se pudo instalar Phoenix Local.')
      this.publishError(runtimeError)
      throw runtimeError
    }
  }

  async start(): Promise<LocalModelRuntimeSnapshot> {
    if (this.current.phase === 'running' && this.server !== undefined) return this.snapshot()
    if (this.persistent.mode === 'off') {
      throw new LocalModelRuntimeFault('local-model-disabled', 'Phoenix Local está apagado en Settings.')
    }
    const model = getLocalModel(this.persistent.selectedModelId)
    if (model === undefined) throw new LocalModelRuntimeFault('unknown-model', 'El modelo local seleccionado ya no existe en el catálogo.')
    if (!this.persistent.installedModelIds.includes(model.id)) {
      throw new LocalModelRuntimeFault('model-not-installed', 'Phoenix Local no está instalado. Instálalo desde Settings → Models.')
    }
    const { executablePath } = this.runtimePaths()
    const modelPath = this.modelPath(model.id)
    if (!await this.dependencies.pathExists(executablePath) || !await this.dependencies.pathExists(modelPath)) {
      throw new LocalModelRuntimeFault('installation-incomplete', 'La instalación de Phoenix Local está incompleta. Vuelve a instalarla desde Settings.')
    }
    if (this.dependencies.freeMemoryBytes() < model.estimatedRamBytes + MEMORY_HEADROOM_BYTES) {
      throw new LocalModelRuntimeFault('insufficient-memory', 'No hay memoria libre suficiente para iniciar Phoenix Local de forma segura.')
    }

    this.publishPhase('starting')
    const port = await this.dependencies.allocatePort()
    const base = `http://127.0.0.1:${String(port)}`
    const args = [
      '--model', modelPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--ctx-size', String(model.contextWindow),
    ]
    let handle: LocalServerHandle | undefined
    try {
      handle = this.dependencies.spawnServer(executablePath, args, (processError) => {
        if (this.server !== handle) return
        this.server = undefined
        if (this.current.phase === 'stopping') return
        const exitFault = new LocalModelRuntimeFault(
          'runtime-exited',
          processError?.message ?? 'El proceso de Phoenix Local terminó inesperadamente.',
        )
        this.publishError(exitFault)
      })
      this.server = handle
      await this.dependencies.probeHealth(base, HEALTH_TIMEOUT_MS)
      const pid = handle.pid
      this.publish({
        ...this.current,
        phase: 'running',
        port,
        baseUrl: `${base}/v1`,
        ...(pid === undefined ? {} : { pid }),
      })
      return this.snapshot()
    } catch (error) {
      if (handle !== undefined) await handle.stop().catch(() => undefined)
      if (this.server === handle) this.server = undefined
      const runtimeError = fault(error, 'start-failed', 'Phoenix Local no pudo iniciar llama-server.')
      this.publishError(runtimeError)
      throw runtimeError
    }
  }

  async ensureRunning(): Promise<string> {
    if (this.persistent.mode === 'off') {
      throw new LocalModelRuntimeFault('local-model-disabled', 'Phoenix Local está apagado en Settings.')
    }
    if (this.current.phase === 'running' && this.server !== undefined && this.current.baseUrl !== undefined) {
      return this.current.baseUrl
    }
    if (this.ensureRunningPromise !== undefined) return this.ensureRunningPromise

    const operation = (async (): Promise<string> => {
      if (this.current.phase !== 'running' || this.server === undefined || this.current.baseUrl === undefined) {
        await this.start()
      }
      const baseUrl = this.current.baseUrl
      if (baseUrl === undefined) throw new LocalModelRuntimeFault('start-failed', 'Phoenix Local no publicó su endpoint local.')
      return baseUrl
    })()
    this.ensureRunningPromise = operation
    try {
      return await operation
    } finally {
      if (this.ensureRunningPromise === operation) this.ensureRunningPromise = undefined
    }
  }

  async stop(): Promise<LocalModelRuntimeSnapshot> {
    const handle = this.server
    if (handle === undefined) {
      const phase = this.persistent.installedModelIds.includes(this.persistent.selectedModelId) ? 'ready' : 'not-installed'
      this.publish({ ...this.current, phase })
      return this.snapshot()
    }
    this.publishPhase('stopping')
    this.server = undefined
    try {
      await handle.stop()
    } finally {
      const phase = this.persistent.installedModelIds.includes(this.persistent.selectedModelId) ? 'ready' : 'not-installed'
      const { pid: _pid, port: _port, baseUrl: _baseUrl, error: _error, progress: _progress, ...rest } = this.current
      this.publish({ ...rest, phase })
    }
    return this.snapshot()
  }

  async uninstall(modelId: string): Promise<LocalModelRuntimeSnapshot> {
    const model = getLocalModel(modelId)
    if (model === undefined) throw new LocalModelRuntimeFault('unknown-model', `Modelo local desconocido: ${modelId}`)
    if (modelId === this.persistent.selectedModelId && this.server !== undefined) await this.stop()
    const modelPath = this.modelPath(modelId)
    await this.dependencies.remove(assertManagedLocalModelPath(this.dependencies.paths, modelPath), { force: true })
    const installedModelIds = this.persistent.installedModelIds.filter(id => id !== modelId)
    await this.savePersistent({ ...this.persistent, installedModelIds })
    if (installedModelIds.length === 0) {
      await this.dependencies.remove(assertManagedLocalModelPath(this.dependencies.paths, this.dependencies.paths.runtimesDir), { recursive: true, force: true })
      await this.dependencies.remove(assertManagedLocalModelPath(this.dependencies.paths, this.dependencies.paths.downloadsDir), { recursive: true, force: true })
    }
    const phase = installedModelIds.includes(this.persistent.selectedModelId) ? 'ready' : 'not-installed'
    this.publish({ ...this.current, phase })
    return this.snapshot()
  }

  async setMode(mode: LocalModelMode): Promise<LocalModelRuntimeSnapshot> {
    if (mode !== 'off' && mode !== 'on-demand' && mode !== 'always-on') {
      throw new LocalModelRuntimeFault('invalid-mode', `Modo local inválido: ${String(mode)}`)
    }
    await this.savePersistent({ ...this.persistent, mode })
    if (mode === 'off') return this.stop()
    if (mode === 'always-on' && this.persistent.installedModelIds.includes(this.persistent.selectedModelId)) return this.start()
    return this.snapshot()
  }

  async setDefaultModel(modelId: string): Promise<LocalModelRuntimeSnapshot> {
    if (getLocalModel(modelId) === undefined) throw new LocalModelRuntimeFault('unknown-model', `Modelo local desconocido: ${modelId}`)
    if (this.server !== undefined) await this.stop()
    await this.savePersistent({ ...this.persistent, selectedModelId: modelId })
    const phase = this.persistent.installedModelIds.includes(modelId) ? 'ready' : 'not-installed'
    this.publish({ ...this.current, phase })
    if (this.persistent.mode === 'always-on' && phase === 'ready') return this.start()
    return this.snapshot()
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.listeners.clear()
  }
}

/**
 * Create a Phoenix Local runtime manager from its injected platform dependencies.
 * @param dependencies - Runtime, filesystem, downloader, and process dependencies.
 * @returns A manager initialized from the durable local-model state.
 */
export async function createLocalModelRuntimeManager(
  dependencies: LocalModelRuntimeManagerDependencies,
): Promise<LocalModelRuntimeManager> {
  const persistent = await dependencies.stateStore.load()
  return new RuntimeManager(dependencies, persistent)
}
