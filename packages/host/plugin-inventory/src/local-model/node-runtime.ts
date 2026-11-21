import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, freemem } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import type { LocalThinkingCapabilities } from './types.js'
import { createLocalModelPaths } from './paths.js'
import { validOllamaTag, type OllamaDiscoveredModel } from './catalog.js'
import { createLocalModelStateStore } from './state.js'
import { downloadVerifiedArtifact } from './download.js'
import { extractArchiveWithTar } from './extract.js'
import {
  createLocalModelRuntimeManager,
  LocalModelRuntimeFault,
  type LocalModelRuntimeManager,
  type LocalServerHandle,
} from './manager.js'

/**
 * Resolve the Phoenix-owned application data root for local-model storage.
 * `PHOENIX_HOME` is the only environment override; legacy DeepSeek namespaces
 * are intentionally ignored so new Phoenix data never lands under `.dsh`.
 * @param environment - Environment values used to resolve the override.
 * @param homeDirectory - User home directory used for the default location.
 * @returns Absolute Phoenix application-data root.
 */
export function resolvePhoenixHome(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory: string = homedir(),
): string {
  const configured = environment['PHOENIX_HOME']?.trim()
  return configured === undefined || configured.length === 0
    ? path.join(homeDirectory, '.phoenix')
    : path.resolve(configured)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/** Reserve an ephemeral TCP port reachable only through loopback. */
async function allocateLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new LocalModelRuntimeFault('port-unavailable', 'Phoenix Local no pudo reservar un puerto loopback.'))
        return
      }
      const port = address.port
      server.close((error) =>{  error === undefined ? resolve(port) : reject(error) })
    })
  })
}

function spawnLocalServer(executable: string, args: string[], onExit: (error?: Error) => void): LocalServerHandle {
  const child = spawn(executable, args, {
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  const remember = (chunk: Buffer | string): void => {
    diagnostics = `${diagnostics}${String(chunk)}`.slice(-16_384)
  }
  child.stdout?.on('data', remember)
  child.stderr?.on('data', remember)
  child.once('error', (error) =>{  onExit(error) })
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') onExit()
    else onExit(new Error(
      `llama-server terminó con código ${String(code)}${signal === null ? '' : ` (${signal})`}`
      + (diagnostics.trim().length === 0 ? '' : `: ${diagnostics.trim()}`),
    ))
  })
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    async stop(): Promise<void> {
      if (child.exitCode !== null || child.killed) return
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
          resolve()
        }, 3_000)
        timeout.unref()
        child.once('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    },
  }
}

async function probeHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
      lastError = new Error(`HTTP ${String(response.status)}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new LocalModelRuntimeFault('health-timeout', 'llama-server no respondió al health check local a tiempo.', {
    cause: lastError,
  })
}

/**
 * Check only the loopback Ollama daemon and the exact local model tag.
 * No remote hosts, cloud APIs, implicit pulls, or user-owned file writes.
 */
async function probeInstalledOllamaModel(modelTag: string): Promise<void> {
  let response: Response
  try {
    response = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(3_000),
    })
  } catch (error) {
    throw new LocalModelRuntimeFault(
      'ollama-unavailable',
      'No se puede conectar con Ollama. Inícialo en esta computadora y comprueba el puerto 11434.',
      { cause: error },
    )
  }
  if (!response.ok) {
    throw new LocalModelRuntimeFault('ollama-unavailable', `Ollama respondió HTTP ${String(response.status)}.`)
  }
  const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> }
  const wanted = modelTag.toLowerCase()
  const installed = Array.isArray(payload.models) && payload.models.some(entry =>
    entry.name?.toLowerCase() === wanted || entry.model?.toLowerCase() === wanted
  )
  if (!installed) {
    throw new LocalModelRuntimeFault(
      'ollama-model-missing',
      `No se encontró ${modelTag} en Ollama. Ejecuta: ollama pull ${modelTag}`,
    )
  }
}

/**
 * Query Ollama's authoritative local model metadata without pulling or updating
 * anything. Named reasoning levels must never be invented or inferred.
 * @param model - Exact local Ollama model tag to inspect.
 * @returns Advertised thinking choices or undefined on unsupported Ollama versions.
 */
export async function readOllamaThinkingCapabilities(model: string): Promise<LocalThinkingCapabilities | undefined> {
  const response = await fetch('http://127.0.0.1:11434/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) return undefined
  const payload = await response.json() as { thinking?: { values?: unknown; default?: unknown } }
  const raw = payload.thinking
  if (!Array.isArray(raw?.values)) return undefined
  const values = raw.values.filter((value): value is boolean | string =>
    typeof value === 'boolean' || (typeof value === 'string' && value.length > 0 && value.length <= 64))
  if (values.length === 0 || values.length > 16) return undefined
  const defaultValue = raw.default
  const selectedDefault = values.find(value => value === defaultValue) ?? null
  return { values, default: selectedDefault }
}

/** Read the installed Ollama catalog and model-reported native context.
 * The returned operational window is capped separately by local free memory. */
export async function listInstalledOllamaModels(): Promise<OllamaDiscoveredModel[]> {
  const response = await fetch('http://127.0.0.1:11434/api/tags', {
    signal: AbortSignal.timeout(4_000),
  })
  if (!response.ok) throw new Error(`Ollama /api/tags: HTTP ${String(response.status)}`)
  const result = await response.json() as { models?: Array<{ name?: string; model?: string; size?: number }> }
  const candidates = (result.models ?? []).slice(0, 128)
    .filter((entry): entry is { name: string; size?: number } =>
      typeof entry.name === 'string' && validOllamaTag(entry.name))
  // Bound metadata calls so even large installations do not flood the daemon.
  const descriptions: OllamaDiscoveredModel[] = []
  for (let index = 0; index < candidates.length; index += 6) {
    const group = await Promise.all(candidates.slice(index, index + 6).map(async entry => {
      let nativeContextWindow: number | undefined
      try {
        const response = await fetch('http://127.0.0.1:11434/api/show', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: entry.name }),
          signal: AbortSignal.timeout(3_000),
        })
        if (response.ok) {
          const metadata = await response.json() as { model_info?: Record<string, unknown> }
          const capacities = Object.entries(metadata.model_info ?? {})
            .filter(([key, value]) => key.endsWith('.context_length')
              && typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
            .map(([, value]) => value as number)
          if (capacities.length > 0) nativeContextWindow = Math.max(...capacities)
        }
      } catch {
        // Context metadata is optional; never claim an unknown native maximum.
      }
      const memory = freemem()
      const safeAllocation = memory < 4_000_000_000 ? 4_096 : memory < 8_000_000_000 ? 8_192 : 16_384
      const contextWindow = Math.min(nativeContextWindow ?? 4_096, safeAllocation)
      const sizeBytes = typeof entry.size === 'number' && entry.size > 0 ? entry.size : 0
      return {
        tag: entry.name, sizeBytes,
        estimatedRamBytes: sizeBytes + 1_000_000_000,
        contextWindow,
        ...(nativeContextWindow === undefined ? {} : { nativeContextWindow }),
        maxTokens: Math.min(2_048, Math.max(256, Math.floor(contextWindow / 8))),
      }
    }))
    descriptions.push(...group)
  }
  return descriptions
}

/** Explicit user-requested Ollama pull; surface real byte-level progress. */
export async function pullOllamaModel(
  tag: string,
  onProgress: (progress: { receivedBytes: number; totalBytes?: number }) => void,
): Promise<void> {
  if (!validOllamaTag(tag)) throw new LocalModelRuntimeFault('invalid-model', 'Nombre de modelo Ollama inválido.')
  const response = await fetch('http://127.0.0.1:11434/api/pull', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: tag, stream: true }),
    signal: AbortSignal.timeout(30 * 60_000),
  })
  if (!response.ok || response.body === null) {
    throw new LocalModelRuntimeFault('ollama-pull-failed', `Ollama rechazó la descarga (HTTP ${String(response.status)}).`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const checkLine = (line: string): void => {
    if (!line.trim()) return
    const event = JSON.parse(line) as { error?: string; completed?: number; total?: number }
    if (event.error) throw new LocalModelRuntimeFault('ollama-pull-failed', event.error.slice(0, 500))
    if (typeof event.completed === 'number') onProgress({
      receivedBytes: Math.max(0, event.completed),
      ...(typeof event.total === 'number' && event.total > 0 ? { totalBytes: event.total } : {}),
    })
  }
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      pending += decoder.decode(part.value, { stream: true })
      if (pending.length > 1_000_000) throw new Error('Ollama pull response exceeded the line budget')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) checkLine(line)
    }
    if (pending.trim()) checkLine(pending)
  } finally {
    reader.releaseLock()
  }
}

/** A destructive user action, never a side effect of disconnect. */
export async function deleteInstalledOllamaModel(tag: string): Promise<void> {
  if (!validOllamaTag(tag)) throw new LocalModelRuntimeFault('invalid-model', 'Nombre de modelo Ollama inválido.')
  const response = await fetch('http://127.0.0.1:11434/api/delete', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: tag }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new LocalModelRuntimeFault('ollama-delete-failed',
    `Ollama no pudo eliminar ${tag} (HTTP ${String(response.status)}).`)
}

/**
 * Create the production Phoenix Local runtime manager for this Host process.
 * The heavy llama-server receives an ephemeral loopback port and stays hidden
 * behind Phoenix's stable proxy; no model is downloaded until Settings asks.
 * @returns the initialized local-model runtime manager.
 */
export async function createNodeLocalModelRuntimeManager(): Promise<LocalModelRuntimeManager> {
  const paths = createLocalModelPaths(path.join(resolvePhoenixHome(), 'local-models'), process.platform)
  const stateStore = createLocalModelStateStore({
    statePath: paths.statePath,
    readFile,
    writeFile,
    rename,
    mkdir,
  })
  return createLocalModelRuntimeManager({
    platform: process.platform,
    arch: process.arch,
    paths,
    stateStore,
    downloadArtifact: downloadVerifiedArtifact,
    extractArchive: extractArchiveWithTar,
    pathExists,
    mkdir: (target, options) => mkdir(target, options),
    remove: (target, options) => rm(target, options),
    allocatePort: allocateLoopbackPort,
    spawnServer: spawnLocalServer,
    probeHealth,
    probeOllamaModel: probeInstalledOllamaModel,
    listOllamaModels: listInstalledOllamaModels,
    pullOllamaModel,
    deleteOllamaModel: deleteInstalledOllamaModel,
    readOllamaThinking: readOllamaThinkingCapabilities,
    freeMemoryBytes: freemem,
  })
}
