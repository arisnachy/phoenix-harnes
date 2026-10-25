#!/usr/bin/env node
/**
 * Run a trusted updater command in a separate child process.
 * The parent may use spawnSync while this helper STREAMS the child's output to
 * a bounded, redacted Git-owned journal. No shell interpolation is performed.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { sanitizePhoenixUpdateDiagnostic, recordPhoenixUpdateStep } from './phoenix-update-state.mjs'

const LIVE_FILE = 'phoenix-update-live.jsonl'
const MAX_FILE_BYTES = 512 * 1024
const RETAIN_BYTES = 256 * 1024
const MAX_LINE_CHARS = 2500
const SHA = /^[a-f0-9]{40}$/iu
const STEPS = new Set(['git-worktree', 'git-reset', 'git-clean', 'dependencies', 'build',
  'smoke', 'boot-preflight', 'handoff', 'host-restart', 'health-check', 'runtime-activation', 'rollback'])

function writeLine(config, stream, line) {
  if (!SHA.test(config.target) || !STEPS.has(config.step)) return
  const safe = sanitizePhoenixUpdateDiagnostic(line)
  if (!safe) return
  const entry = {
    schema: 1, target: config.target, step: config.step, stream,
    at: new Date().toISOString(),
    line: safe.slice(0, MAX_LINE_CHARS) + (safe.length > MAX_LINE_CHARS ? ' [línea recortada]' : ''),
  }
  const path = join(dirname(config.statePath), LIVE_FILE)
  try {
    // Keep the retained tail bounded even through hours of verbose builds.
    if (existsSync(path) && statSync(path).size > MAX_FILE_BYTES) {
      const old = readFileSync(path, 'utf8')
      const suffix = old.slice(-RETAIN_BYTES)
      const firstBreak = suffix.indexOf('\n')
      const retained = firstBreak < 0 ? '' : suffix.slice(firstBreak + 1)
      const tmp = path + '.' + String(process.pid) + '.tmp'
      try {
        writeFileSync(tmp, retained, { mode: 0o600 })
        renameSync(tmp, path)
      } finally { try { unlinkSync(tmp) } catch { /* best effort */ } }
    }
    appendFileSync(path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Losing presentation telemetry must not fail installation or recovery.
  }
}

function main() {
  let config
  try { config = JSON.parse(process.argv[2] ?? '') } catch { return 2 }
  if (!config || typeof config.bin !== 'string' || !Array.isArray(config.args)
    || !config.args.every(arg => typeof arg === 'string')
    || typeof config.cwd !== 'string' || typeof config.statePath !== 'string') return 2

  const tails = { stdout: '', stderr: '' }
  let failureTail = ''
  let child
  try {
    child = spawn(config.bin, config.args, {
      cwd: config.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
  } catch (error) {
    writeLine(config, 'stderr', error instanceof Error ? error.stack ?? error.message : String(error))
    return 1
  }

  const consume = (stream, chunk) => {
    process[stream].write(chunk)
    const text = tails[stream] + String(chunk)
    const lines = text.split(/\r\n|\n|\r/gu)
    tails[stream] = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      writeLine(config, stream, line)
      if (stream === 'stderr') failureTail = (failureTail + line + '\n').slice(-96 * 1024)
    }
    if (tails[stream].length > 10000) {
      writeLine(config, stream, tails[stream])
      tails[stream] = ''
    }
  }
  child.stdout?.on('data', chunk => consume('stdout', chunk))
  child.stderr?.on('data', chunk => consume('stderr', chunk))
  let recorded = false
  const finish = (code, reason) => {
    if (recorded) return
    recorded = true
    for (const stream of ['stdout', 'stderr']) {
      if (tails[stream]) {
        writeLine(config, stream, tails[stream])
        if (stream === 'stderr') failureTail += tails[stream]
      }
    }
    const exitCode = Number.isSafeInteger(code) && code >= 0 ? code : 1
    if (exitCode !== 0) {
      const diagnostic = failureTail || reason || 'El proceso terminó con error sin escribir en stderr; revisa la consola en vivo.'
      recordPhoenixUpdateStep(config.statePath, config.step, 'failed', config.target, exitCode, diagnostic)
      writeLine(config, 'stderr', reason || 'Proceso terminado con código ' + String(exitCode))
    }
    process.exitCode = exitCode
  }
  child.on('error', error => {
    const reason = error instanceof Error ? error.stack ?? error.message : String(error)
    writeLine(config, 'stderr', reason)
    finish(1, reason)
  })
  child.on('close', (code, signal) => finish(code, signal ? 'Proceso terminado por señal ' + signal : undefined))
  return undefined
}
const result = main()
if (typeof result === 'number') process.exitCode = result
