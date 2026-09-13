#!/usr/bin/env node
/**
 * Boot-safe configuration preflight for PHOENIX.
 *
 * Stage 1 composes the exact Web profile without starting the app. Stage 2
 * starts a second Web Host on an OS-assigned loopback port with browser handoff
 * and auto-update disabled. The live supervised Host is never stopped by this
 * script. A candidate is accepted only after the isolated Host announces its
 * own URL, proving that the composed plugin tree can actually reach startup.
 */

import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(process.cwd())
const DEFAULT_TIMEOUT_MS = 30_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 120_000

function timeoutMs() {
  const raw = Number(process.env.PHOENIX_CONFIG_PREFLIGHT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.trunc(raw)))
}

function preflightEnvironment() {
  return {
    ...process.env,
    PHOENIX_UPDATE_SUPERVISED: '1',
    PHOENIX_AUTO_UPDATE: '0',
    PHOENIX_CONFIG_PREFLIGHT: '1',
    DSH_TELEMETRY_DISABLED: '1',
  }
}

function boundedDetail(...values) {
  return values
    .filter(value => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim()
    .slice(-6000)
}

function composeConfiguration() {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web', '--dump-config',
  ], {
    cwd: root,
    env: preflightEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: timeoutMs(),
  })
  if (result.error !== undefined) {
    return { ok: false, detail: `configuration composition failed to launch: ${result.error.message}` }
  }
  if (result.status !== 0) {
    return {
      ok: false,
      detail: boundedDetail(result.stderr, result.stdout) || `configuration composition exited with ${String(result.status ?? 1)}`,
    }
  }
  return { ok: true, detail: 'effective web profile parsed and composed successfully' }
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

async function terminate(child) {
  if (child.exitCode !== null) return
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(1500)])
  if (child.exitCode === null && child.pid !== undefined && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
    })
    await Promise.race([exited, sleep(1500)])
  }
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function isolatedStartup() {
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    'web', '--port', '0', '--no-open',
  ], {
    cwd: root,
    env: preflightEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let output = ''
  let finished = false
  let timer

  return await new Promise(resolveResult => {
    const finish = async result => {
      if (finished) return
      finished = true
      if (timer !== undefined) clearTimeout(timer)
      if (result.ok) await terminate(child)
      resolveResult(result)
    }

    const capture = chunk => {
      output = (output + String(chunk)).slice(-12_000)
      if (/dsh web:\s+https?:\/\//u.test(output)) {
        void finish({ ok: true, detail: 'isolated Host reached its ready URL on an OS-assigned port' })
      }
    }

    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('error', error => {
      void finish({ ok: false, detail: `isolated Host failed to launch: ${error.message}` })
    })
    child.once('exit', (code, signal) => {
      if (finished) return
      const suffix = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${String(code)}`
      void finish({
        ok: false,
        detail: boundedDetail(output, `isolated Host exited before readiness (${suffix})`),
      })
    })
    timer = setTimeout(() => {
      const detail = boundedDetail(output, `isolated Host did not reach readiness within ${String(timeoutMs())}ms`)
      void terminate(child).finally(() => finish({ ok: false, detail }))
    }, timeoutMs())
    timer.unref?.()
  })
}

const composition = composeConfiguration()
if (!composition.ok) {
  console.error(`[PHOENIX PREFLIGHT] ${composition.detail}`)
  process.exitCode = 1
} else {
  const startup = await isolatedStartup()
  if (!startup.ok) {
    console.error(`[PHOENIX PREFLIGHT] ${startup.detail}`)
    process.exitCode = 1
  } else {
    console.error('[PHOENIX PREFLIGHT] configuration composition and isolated Host startup passed.')
  }
}
