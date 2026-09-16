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
      server.close(error => error === undefined ? resolve(port) : reject(error))
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
 * The heavy llama-server receives an ephemeral loopback port and stays hidden
 * behind Phoenix's stable 17842 proxy; no model is downloaded until Settings
 * explicitly asks to install one.
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
    mkdir: (target, options) => mkdir(target, options),
    remove: (target, options) => rm(target, options),
    allocatePort: allocateLoopbackPort,
    spawnServer: spawnLocalServer,
    probeHealth,
    freeMemoryBytes: freemem,
  })
}
