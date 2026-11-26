/** Explicit, user-approved bootstrap for the official Antigravity CLI. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { LlmError } from '@phoenix-ai/dsh-llm'

const exec = promisify(execFile)

/** Resolve the official install location before consulting the current PATH. */
export function antigravityExecutable(
  platform = process.platform,
  env = process.env,
  home = homedir(),
  exists = existsSync,
): string {
  const candidate = platform === 'win32'
    ? join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'agy', 'bin', 'agy.exe')
    : join(home, '.local', 'bin', 'agy')
  return exists(candidate) ? candidate : 'agy'
}

/** Only a missing executable permits installation; broken binaries fail visibly. */
export async function antigravityInstalled(signal?: AbortSignal): Promise<boolean> {
  try {
    const result = await exec(antigravityExecutable(), ['--version'], {
      timeout: 15_000, windowsHide: true, maxBuffer: 64 * 1024,
      ...signal === undefined ? {} : { signal },
    })
    if (!result.stdout.trim() && !result.stderr.trim()) {
      throw new LlmError('Antigravity no informó su versión.', 'GOOGLE_CLI_VERSION')
    }
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

/** Official installer, fixed origin and filename, no elevated privileges. */
export async function installAntigravity(signal?: AbortSignal): Promise<void> {
  const windows = process.platform === 'win32'
  if (!windows && process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new LlmError('Sistema no compatible con instalación automática de Antigravity.', 'GOOGLE_CLI_PLATFORM')
  }
  const filename = windows ? 'install.cmd' : 'install.sh'
  const dir = await mkdtemp(join(tmpdir(), 'phoenix-agy-install-'))
  try {
    const deadline = AbortSignal.timeout(60_000)
    const downloadSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    const response = await fetch('https://antigravity.google/cli/' + filename, {
      signal: downloadSignal, redirect: 'error',
    })
    if (!response.ok) throw new LlmError('No se pudo descargar el instalador oficial de Google.', 'GOOGLE_CLI_DOWNLOAD')
    const script = new Uint8Array(await response.arrayBuffer())
    if (script.length === 0 || script.length > 2 * 1024 * 1024) {
      throw new LlmError('El instalador oficial tiene un tamaño inesperado.', 'GOOGLE_CLI_DOWNLOAD')
    }
    await writeFile(join(dir, filename), script, { flag: 'wx', mode: 0o600 })
    const command = windows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : '/bin/bash'
    const args = windows ? ['/d', '/c', filename] : [filename]
    try {
      await exec(command, args, {
        cwd: dir, windowsHide: true, timeout: 300_000, maxBuffer: 1024 * 1024,
        ...signal === undefined ? {} : { signal },
      })
    } catch {
      throw new LlmError('La instalación oficial de Antigravity no terminó correctamente.', 'GOOGLE_CLI_INSTALL_FAILED')
    }
    if (!await antigravityInstalled(signal)) {
      throw new LlmError('La instalación terminó pero no se encontró agy. Revisa la ruta oficial de instalación.', 'GOOGLE_CLI_MISSING')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

interface BootstrapSteps {
  installed: () => Promise<boolean>
  consent: () => Promise<boolean>
  install: () => Promise<void>
}

/** Never install on model listing, chat execution, or without explicit approval. */
export async function ensureAntigravityInstalled(steps: BootstrapSteps): Promise<void> {
  if (await steps.installed()) return
  if (!await steps.consent()) throw new LlmError('Instalación de Antigravity cancelada.', 'GOOGLE_CLI_INSTALL_CANCELLED')
  await steps.install()
  if (!await steps.installed()) throw new LlmError('No se encontró Antigravity después de instalar.', 'GOOGLE_CLI_MISSING')
}
