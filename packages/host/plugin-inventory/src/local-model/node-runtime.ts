import { spawn } from 'node:child_process'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, freemem } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createLocalModelPaths } from './paths.js'
import { createLocalModelStateStore } from './state.js'
import { downloadVerifiedArtifact } from './download.js'
import { extractArchiveWithTar } from './extract.js'
import {
  createLocalModelRuntimeManager,
  LocalModelRuntimeFault,
  type LocalModelRuntimeManager,
  type LocalServerHandle,
} from './manager.js'

/** Fixed loopback port used by the first-class `phoenix-local` LLM route. */
export const PHOENIX_LOCAL_PORT = 17_842

/** Fixed OpenAI-compatible endpoint exposed by Phoenix Local when running. */
export const PHOENIX_LOCAL_BASE_URL = `http://127.0.0.1:${String(PHOENIX_LOCAL_PORT)}/v1`

function phoenixHome(): string {
  const configured = process.env['DSH_HOME']?.trim()
  return configured === undefined || configured.length === 0
    ? path.join(homedir(), '.dsh')
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

async function assertPortFree(port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => reject(new LocalModelRuntimeFault(
      'port-unavailable',
      `Phoenix Local no puede usar el puerto local ${String(port)}. Cierra el proceso que lo está usando e inténtalo de nuevo.`,
      { cause: error },
    )))
    server.listen(port, '127.0.0.1', () => {
      server.close(error => error === undefined ? resolve() : reject(error))
    })
  })
  return port
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
  child.once('error', error => onExit(error))
  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM') onExit()
    else onExit(new Error(
      `llama-server terminó con código ${String(code)}${signal === null ? '' : ` (${signal})`}`
      + (diagnostics.trim().length === 0 ? '' : `: ${diagnostics.trim()}`),
    ))
  })
  return {
    pid: child.pid,
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
 * Create the production Phoenix Local runtime manager for this Host process.
 * The manager owns only `$DSH_HOME/local-models`, binds inference to loopback,
 * and never downloads a model until Settings asks it to install one.
 */
export async function createNodeLocalModelRuntimeManager(): Promise<LocalModelRuntimeManager> {
  const paths = createLocalModelPaths(path.join(phoenixHome(), 'local-models'), process.platform)
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
    mkdir,
    remove: rm,
    allocatePort: () => assertPortFree(PHOENIX_LOCAL_PORT),
    spawnServer: spawnLocalServer,
    probeHealth,
    freeMemoryBytes: freemem,
  })
}
