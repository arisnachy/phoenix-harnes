import { execFile as nodeExecFile } from 'node:child_process'
import { existsSync as nodeExistsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

type ProbeExecutor = (binary: string, args: string[], options: {
  encoding: 'utf8'
  windowsHide: boolean
  timeout: number
  maxBuffer: number
}, callback: (error: Error | null, stdout: string) => void) => unknown

interface WindowsProbeOptions {
  readonly platform?: string
  readonly supervised?: boolean
  readonly runtimeRoot?: string
  readonly exists?: (path: string) => boolean
  readonly execute?: ProbeExecutor
}

/** Translate only validated local prerequisites into actionable, bounded model context.
 * @param raw - Read-only capability probe response to validate.
 * @returns Safe platform guidance, or an empty string for invalid probes.
 */
export function windowsCapabilityGuidance(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || !('probe' in raw) || raw.probe !== 'completed'
    || !('executables' in raw) || typeof raw.executables !== 'object' || raw.executables === null) return ''
  const commands = raw.executables as Record<string, unknown>
  const available = ['winget', 'wsl', 'ollama', 'foundry', 'pwsh'].filter(name => commands[name] === true)
  const installed = available.length > 0 ? available.join(', ') : 'none detected'
  const hardware = 'hardware' in raw && typeof raw.hardware === 'object' && raw.hardware !== null
    ? raw.hardware as Record<string, unknown> : null
  const memory = hardware?.memoryGiB
  const memoryHint = typeof memory === 'number' && Number.isFinite(memory) && memory > 0 && memory < 2048
    ? ' Available physical RAM: ' + memory.toFixed(1) + ' GiB (not a model benchmark).' : ''
  return [
    'Windows free capabilities (automatically inspected, read-only): ' + installed + '.' + memoryHint,
    'Decision policy for Kira: use existing Phoenix-approved filesystem and shell tools for ordinary Windows work. Use WinGet only to inspect packages when relevant; never silently install or upgrade anything. Use WSL only when a real Linux task benefits and it is configured. Treat Ollama/Foundry command presence as a candidate, NOT a ready model: require a configured, healthy local provider and a quality check before routing tasks; retain the selected cloud model otherwise. Never download models, enable services, modify settings, or switch providers without the applicable user authorization. Native Windows notifications, Windows AI and MXC are NOT enabled by this inventory. Prefer no action over inventing Windows API availability. Keep this inventory silent unless relevant or requested.',
  ].join('\n')
}

/**
 * Run the free inventory outside the critical startup path. The caller reads
 * an empty context until a validated inspection arrives; errors stay silent.
 * @param onChange - Called when a valid discovery result is available.
 * @param options - Optional injected platform and execution prerequisites.
 * @returns Accessor for the latest validated, non-secret platform guidance.
 */
export function startWindowsCapabilityDiscovery(
  onChange: () => void,
  options: WindowsProbeOptions = {},
): () => string {
  const platform = options.platform ?? process.platform
  const supervised = options.supervised ?? process.env.PHOENIX_UPDATE_SUPERVISED === '1'
  const root = options.runtimeRoot ?? process.env.PHOENIX_RUNTIME_ROOT ?? process.cwd()
  const path = join(root, 'scripts', 'phoenix-windows-free-capabilities.mjs')
  const exists = options.exists ?? nodeExistsSync
  if (platform !== 'win32' || !supervised || !exists(path)) return () => ''

  let snapshot = ''
  const execute: ProbeExecutor = options.execute ?? ((binary, args, execOptions, callback) =>
    nodeExecFile(binary, args, execOptions, (error, stdout) => callback(error, stdout)))
  try {
    execute(process.execPath, [path], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 9000,
      maxBuffer: 262144,
    }, (error, stdout) => {
      if (error !== null) return
      try {
        const guidance = windowsCapabilityGuidance(JSON.parse(stdout) as unknown)
        if (guidance.length === 0) return
        snapshot = guidance
        onChange()
      } catch {
        // A missing or malformed platform inventory is never model-visible.
      }
    })
  } catch {
    // Even a synchronous Windows process creation failure cannot block Host boot.
  }
  return () => snapshot
}
