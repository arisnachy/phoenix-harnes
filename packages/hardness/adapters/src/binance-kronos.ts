import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { BinanceCandle } from './binance-paper.ts'

/** Experimental prediction data; never a calibrated confidence or guaranteed return. */
export interface BinanceKronosForecast {
  readonly source: 'kronos'
  readonly model: 'mini' | 'small'
  readonly symbol: string
  readonly interval: string
  readonly horizonBars: number
  readonly baseClose: number
  readonly projectedClose: number
  readonly projectedReturnPct: number
  readonly maxDownsidePct: number
  readonly forecastAt: number
}
export type BinanceKronosState = 'not-installed' | 'installed' | 'installing' | 'loading' | 'ready' | 'error'
const home = resolve(process.env.PHOENIX_KRONOS_HOME || join(homedir(), '.phoenix', 'kronos'))
const python = process.platform === 'win32'
  ? join(home, '.venv', 'Scripts', 'python.exe') : join(home, '.venv', 'bin', 'python')
const runner = resolve(process.cwd(), 'services', 'phoenix-kronos', 'runner.py')
const installer = resolve(process.cwd(), 'scripts', 'phoenix-kronos-install.mjs')
const forecastRequests = new Map<string, { resolve: (value: BinanceKronosForecast) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>()
let processHandle: ChildProcessWithoutNullStreams | undefined
let startup: Promise<void> | undefined
let installing = false
let failed = false
let ready = false

/** Safe to expose in the viewer: no paths, secrets, subprocess logs or private holdings. */
export function binanceKronosStatus(): { state: BinanceKronosState; model: 'mini' | 'small'; available: boolean } {
  const available = existsSync(python) && existsSync(join(home, 'source', 'model')) && existsSync(runner)
  return {
    state: installing ? 'installing' : ready ? 'ready' : startup ? 'loading'
      : failed ? 'error' : available ? 'installed' : 'not-installed',
    available,
    model: process.env.PHOENIX_KRONOS_MODEL === 'small' ? 'small' : 'mini',
  }
}

/** One explicit same-origin click installs only local Python/CPU dependencies. */
export function installBinanceKronos(): ReturnType<typeof binanceKronosStatus> {
  if (installing) return binanceKronosStatus()
  if (!existsSync(installer) || !existsSync(runner)) {
    failed = true
    return binanceKronosStatus()
  }
  if (binanceKronosStatus().available) {
    // Retry a failed model load without reinstalling a healthy venv.
    failed = false
    void ensureReady().catch(() => { /* status exposes a safe error */ })
    return binanceKronosStatus()
  }
  installing = true
  failed = false
  const child = spawn(process.execPath, [installer], {
    cwd: process.cwd(), env: process.env, stdio: 'ignore', windowsHide: true,
  })
  child.once('error', () => { installing = false; failed = true })
  child.once('close', code => {
    installing = false
    failed = code !== 0
    if (code === 0) void ensureReady().catch(() => { /* model may need repair */ })
  })
  return binanceKronosStatus()
}

function validForecast(value: unknown, symbol: string, interval: string, latest: number): value is BinanceKronosForecast {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.source === 'kronos' && ['mini', 'small'].includes(String(v.model))
    && v.symbol === symbol && v.interval === interval && v.horizonBars === 6
    && v.forecastAt === latest
    && ['baseClose', 'projectedClose', 'projectedReturnPct', 'maxDownsidePct'].every(key =>
      typeof v[key] === 'number' && Number.isFinite(v[key]))
    && Number(v.baseClose) > 0 && Number(v.projectedClose) > 0
}

async function ensureReady(): Promise<void> {
  if (ready && processHandle && !processHandle.killed) return
  if (startup) return startup
  if (!binanceKronosStatus().available || installing) throw new Error('Kronos is not installed')
  startup = new Promise<void>((resolveStart, rejectStart) => {
    failed = false
    let settled = false
    const child = spawn(python, [runner], {
      cwd: process.cwd(), env: { ...process.env, PHOENIX_KRONOS_HOME: home, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    })
    processHandle = child
    const timer = setTimeout(() => { child.kill(); reject(new Error('Kronos model loading timeout')) }, 120_000)
    const reject = (error: Error) => {
      failed = true
      ready = false
      if (!settled) { settled = true; clearTimeout(timer); rejectStart(error) }
      for (const [, pending] of forecastRequests) {
        clearTimeout(pending.timeout)
        pending.reject(error)
      }
      forecastRequests.clear()
      if (processHandle === child) processHandle = undefined
    }
    const rl = createInterface({ input: child.stdout })
    rl.on('line', line => {
      let message: Record<string, unknown>
      try { message = JSON.parse(line) as Record<string, unknown> } catch { return }
      if (!settled && message.ready === true) {
        settled = true
        clearTimeout(timer)
        ready = true
        resolveStart()
        return
      }
      const id = message.id
      if (typeof id !== 'string') return
      const pending = forecastRequests.get(id)
      if (pending === undefined) return
      forecastRequests.delete(id)
      clearTimeout(pending.timeout)
      if (message.error) pending.reject(new Error('Kronos returned no valid forecast'))
      else pending.resolve(message.forecast as BinanceKronosForecast)
    })
    child.once('error', () => { reject(new Error('Kronos process launch failed')) })
    child.once('exit', () => { reject(new Error('Kronos process ended')) })
  }).finally(() => { startup = undefined })
  return startup
}

/** Entry-only decision support. A failure never becomes a BUY recommendation. */
export async function forecastBinanceKronos(
  symbol: string, bars: readonly BinanceCandle[], interval: string,
): Promise<BinanceKronosForecast> {
  if (!/^[A-Z0-9]{3,16}USDT$/u.test(symbol) || !['15m', '1h', '4h', '1d'].includes(interval)
    || bars.length < 48 || bars.length > 512) throw new Error('Invalid Kronos forecast inputs')
  await ensureReady()
  const child = processHandle
  if (!ready || !child || !child.stdin.writable) throw new Error('Kronos unavailable')
  const id = randomUUID()
  const latest = bars.at(-1)!.closeTime
  const payload = JSON.stringify({
    id, symbol, interval, candles: bars.map(c => ({
      closeTime: c.closeTime, open: c.open, high: c.high, low: c.low,
      close: c.close, volume: c.volume,
    })),
  }) + '\n'
  const value = await new Promise<BinanceKronosForecast>((resolveForecast, rejectForecast) => {
    const timeout = setTimeout(() => {
      forecastRequests.delete(id)
      // A stalled worker must not hold stale predictions for later trade cycles.
      child.kill()
      rejectForecast(new Error('Kronos forecast timeout'))
    }, 60_000)
    forecastRequests.set(id, { resolve: resolveForecast, reject: rejectForecast, timeout })
    child.stdin.write(payload, error => {
      if (error && forecastRequests.delete(id)) {
        clearTimeout(timeout)
        rejectForecast(new Error('Kronos worker input failure'))
      }
    })
  })
  if (!validForecast(value, symbol, interval, latest)) throw new Error('Invalid Kronos output')
  return value
}
