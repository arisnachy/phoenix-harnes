import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { BinancePaperBroker } from './binance-paper.ts'
import { runBinanceAdaptiveCycle, type BinanceAdaptiveCycle } from './binance-adaptive.ts'
import { discoverBinanceSpotMarkets } from './binance-market-discovery.ts'

const POLL_MIN_MS = 60_000
const POLL_MAX_MS = 3_600_000
const DEFAULT_POLL_MS = 60_000
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
const MAX_RECENT_TRADES = 12
const MAX_SCAN_SYMBOLS = 12
const UNIVERSE_REFRESH_MS = 3_600_000

/** Rare, meaningful events only; normal minute-by-minute monitoring costs no tokens. */
export interface BinancePaperAttention {
  readonly kind: 'paper-trade' | 'paper-error' | 'paper-risk-review'
  readonly symbol: string
  readonly detail: string
}

/** Settings saved separately from the virtual portfolio; never contains credentials. */
export interface BinancePaperAutomationConfig {
  readonly schema: 1
  readonly enabled: boolean
  readonly symbols: readonly string[]
  readonly interval: '15m' | '1h' | '4h' | '1d'
  readonly pollMs: number
  readonly autoDiscover: boolean
}

/** Host-side activity used by the read-only in-chat trading viewer. */
export interface BinancePaperAutomationView {
  readonly mode: 'paper'
  readonly phase: 'stopped' | 'running' | 'error'
  readonly enabled: boolean
  readonly lastAttemptAt?: string
  readonly lastSuccessAt?: string
  readonly nextCheckAt?: string
  readonly lastError?: string
  readonly lastCycle?: BinanceAdaptiveCycle
  readonly successfulCycles: number
  readonly filledCycles: number
  readonly signalsQualified: number
  readonly universeSize: number
  readonly lastScannedSymbols: readonly string[]
  readonly lastDiscoveryAt?: string
  readonly lastDiscoveryIssue?: string
  readonly settings: BinancePaperAutomationConfig
  readonly account: Awaited<ReturnType<BinancePaperBroker['account']>>
  readonly markedAt: string
  readonly recentTrades: Awaited<ReturnType<BinancePaperBroker['journal']>>
}

/**
 * Verify an unattended run's complete user-owned configuration before enabling it.
 * @param input - Watchlist and bounded period selected by the user.
 * @param enabled - Persisted PAPER-only enablement switch.
 * @returns Validated PAPER scheduler settings.
 */
export function binancePaperAutomationConfig(input: {
  symbols: readonly string[]
  interval?: BinancePaperAutomationConfig['interval']
  pollMs?: number
  autoDiscover?: boolean
}, enabled = true): BinancePaperAutomationConfig {
  const symbols = input.symbols.map(item => item.trim().toUpperCase())
  if (symbols.length < 1 || symbols.length > 12 || new Set(symbols).size !== symbols.length
    || symbols.some(symbol => !/^[A-Z0-9]{3,16}USDT$/u.test(symbol))) {
    throw new Error('Trading watchlist must contain 1-12 unique Spot USDT symbols')
  }
  const interval = input.interval ?? '15m'
  if (!['15m', '1h', '4h', '1d'].includes(interval)) throw new Error('Unsupported paper trading interval')
  const pollMs = input.pollMs ?? DEFAULT_POLL_MS
  if (!Number.isInteger(pollMs) || pollMs < POLL_MIN_MS || pollMs > POLL_MAX_MS) {
    throw new Error('Paper trading poll interval must be 60,000 to 3,600,000 milliseconds')
  }
  if (input.autoDiscover !== undefined && typeof input.autoDiscover !== 'boolean') {
    throw new Error('Invalid auto discovery setting')
  }
  return { schema: 1, enabled, symbols, interval, pollMs, autoDiscover: input.autoDiscover ?? false }
}

/** Token-free Host runner: one virtual cycle at a time; no real Binance credential route. */
export class BinancePaperAutomation {
  private config: BinancePaperAutomationConfig = binancePaperAutomationConfig({ symbols: DEFAULT_SYMBOLS }, false)
  private timer: ReturnType<typeof setInterval> | undefined
  private pending: Promise<void> | undefined
  private lastCycle: BinanceAdaptiveCycle | undefined
  private lastAttemptAt: string | undefined
  private lastSuccessAt: string | undefined
  private lastError: string | undefined
  private nextCheckAt: string | undefined
  private loaded = false
  private failures = 0
  private successfulCycles = 0
  private filledCycles = 0
  private signalsQualified = 0
  private universe: readonly string[] = []
  private universeCursor = 0
  private lastDiscoveryAt: string | undefined
  private lastDiscoveryIssue: string | undefined
  private lastScannedSymbols: readonly string[] = []
  private readonly discover: () => Promise<readonly string[]>
  private attentionSink: ((event: BinancePaperAttention) => void) | undefined
  private lastReviewKey: string | undefined
  private lastReviewAt = 0
  private change: Promise<void> = Promise.resolve()

  constructor(
    readonly broker: BinancePaperBroker,
    private readonly settingsPath: string,
    discover: () => Promise<readonly string[]> = discoverBinanceSpotMarkets,
  ) { this.discover = discover }

  /** Keep explicitly chosen pairs and rotate the remainder through liquid markets. */
  private async scanSymbols(): Promise<readonly string[]> {
    if (!this.config.autoDiscover) {
      this.lastDiscoveryIssue = undefined
      return this.config.symbols
    }
    const refresh = this.lastDiscoveryAt === undefined
      || Date.now() - Date.parse(this.lastDiscoveryAt) >= UNIVERSE_REFRESH_MS
    if (refresh) {
      try {
        const fresh = await this.discover()
        const candidates = [...new Set(fresh)]
          .filter(symbol => /^[A-Z0-9]{3,16}USDT$/u.test(symbol))
          .slice(0, 120)
        if (!candidates.length) throw new Error('No verified active Spot USDT markets')
        this.universe = candidates
        this.universeCursor = 0
        this.lastDiscoveryAt = new Date().toISOString()
        this.lastDiscoveryIssue = undefined
      } catch {
        this.lastDiscoveryIssue = 'El proveedor no entregó un universo verificable; se usó únicamente la lista fija'
        if (this.universe.length === 0) return this.config.symbols
      }
    }
    // Honor every user-selected priority; dynamic rotation uses remaining slots.
    const pinned = [...this.config.symbols]
    const choices = this.universe.filter(symbol => !pinned.includes(symbol))
    const available = Math.max(0, MAX_SCAN_SYMBOLS - pinned.length)
    const rotating = choices.length === 0 ? [] : Array.from(
      { length: Math.min(available, choices.length) },
      (_, i) => choices[(this.universeCursor + i) % choices.length]!,
    )
    this.universeCursor = choices.length ? (this.universeCursor + rotating.length) % choices.length : 0
    return [...pinned, ...rotating]
  }

  /**
   * Attach a Host-owned event sink; event delivery never changes trade execution.
   * @param sink - Process-local callback for meaningful PAPER outcomes.
   */
  setAttentionSink(sink: ((event: BinancePaperAttention) => void) | undefined): void {
    this.attentionSink = sink
  }

  private reportAttention(event: BinancePaperAttention): void {
    try { this.attentionSink?.(event) } catch { /* Notifications never block ledger writes. */ }
  }

  private async persist(config: BinancePaperAutomationConfig): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true, mode: 0o700 })
    const temp = `${this.settingsPath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(config) + '\n', { encoding: 'utf8', mode: 0o600 })
    await rename(temp, this.settingsPath)
  }

  private schedule(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    if (!this.config.enabled) return
    this.nextCheckAt = new Date(Date.now() + this.config.pollMs).toISOString()
    this.timer = setInterval(() => {
      this.nextCheckAt = new Date(Date.now() + this.config.pollMs).toISOString()
      void this.step()
    }, this.config.pollMs)
    this.timer.unref()
  }

  /**
   * Recover explicit PAPER-only user enablement after Host restart. Corrupted
   * settings fail closed rather than granting execution or resetting a ledger.
   * @returns Current safe scheduler state.
   */
  async restore(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const data: unknown = JSON.parse(raw)
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Invalid saved paper settings')
      const record = data as Record<string, unknown>
      if (record.schema !== 1 || typeof record.enabled !== 'boolean'
        || !Array.isArray(record.symbols) || !record.symbols.every(s => typeof s === 'string')
        || typeof record.interval !== 'string' || typeof record.pollMs !== 'number') {
        throw new Error('Invalid saved paper settings')
      }
      this.config = binancePaperAutomationConfig({
        symbols: record.symbols,
        interval: record.interval as BinancePaperAutomationConfig['interval'],
        pollMs: record.pollMs,
        autoDiscover: record.autoDiscover === true,
      }, record.enabled)
      if (this.config.enabled) {
        this.schedule()
        void this.step()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.config = binancePaperAutomationConfig({ symbols: DEFAULT_SYMBOLS }, false)
      this.lastError = 'Saved PAPER configuration invalid; automatic execution remains disabled'
    }
  }

  /**
   * Explicitly enable a bounded paper-only trading loop and scan immediately.
   * @param input - User watchlist, timeframe and polling cadence.
   * @returns Read-only control state, without assuming an order was filled.
   */
  async start(input: {
    symbols: readonly string[]
    interval?: BinancePaperAutomationConfig['interval']
    pollMs?: number
    autoDiscover?: boolean
  }): Promise<void> {
    const next = binancePaperAutomationConfig(input)
    await this.control(async () => {
      await this.persist(next)
      this.config = next
      this.failures = 0
      this.lastError = undefined
      this.universeCursor = 0
      this.schedule()
    })
    // Do not acknowledge a newly started worker before its first scan settles.
    // A HOLD is an explicit result; it must never be presented as a fill.
    await this.step()
  }

  /** Disable future virtual entries and await an already-running decision cycle. */
  async stop(): Promise<void> {
    await this.control(async () => {
      const next = { ...this.config, enabled: false }
      this.config = next
      if (this.timer !== undefined) clearInterval(this.timer)
      this.timer = undefined
      this.nextCheckAt = undefined
      await this.pending?.catch(() => undefined)
      await this.persist(next)
    })
  }

  private async control(operation: () => Promise<void>): Promise<void> {
    const next = this.change.catch(() => undefined).then(operation)
    this.change = next
    await next
  }

  /**
   * Run one cycle using fresh Binance public candles. A hold is a legitimate
   * decision and never reported as a trade. Repeated concurrent ticks collapse.
   * @returns Current cycle, or undefined when the worker is disabled.
   */
  async step(): Promise<BinanceAdaptiveCycle | undefined> {
    if (this.pending !== undefined) {
      await this.pending
      return this.lastCycle
    }
    if (!this.config.enabled) return undefined
    let result: BinanceAdaptiveCycle | undefined
    const run = (async (): Promise<void> => {
      this.lastAttemptAt = new Date().toISOString()
      try {
        // Snapshot only the latest explicitly approved PAPER configuration.
        const { interval } = this.config
        const symbols = await this.scanSymbols()
        this.lastScannedSymbols = symbols
        const cycle = await runBinanceAdaptiveCycle(this.broker, { symbols, interval, mode: 'paper-step' })
        result = cycle
        this.lastCycle = cycle
        this.lastSuccessAt = new Date().toISOString()
        this.lastError = undefined
        this.failures = 0
        this.successfulCycles++
        this.signalsQualified += cycle.signals.filter(signal => signal.action === 'buy' && signal.score >= 75).length
        if (cycle.trade !== undefined) {
          this.filledCycles++
          this.reportAttention({
            kind: 'paper-trade', symbol: cycle.trade.symbol,
            detail: `${cycle.trade.side} virtual confirmado por ledger; ${cycle.rationale}`,
          })
        } else {
          const review = cycle.signals.find(signal => signal.action === 'buy' && signal.score >= 80)
          if (review !== undefined) {
            const key = `${review.symbol}:${review.strategy}`
            if (key !== this.lastReviewKey || Date.now() - this.lastReviewAt > 1_800_000) {
              this.lastReviewKey = key
              this.lastReviewAt = Date.now()
              this.reportAttention({
                kind: 'paper-risk-review', symbol: review.symbol,
                detail: 'Entrada potencial bloqueada o no ejecutada; revisar límites y exposición virtual',
              })
            }
          }
        }
      } catch {
        // Provider text can contain remote diagnostic details; do not reveal it in chat.
        this.lastError = 'Public Binance data or virtual execution failed; no order confirmed'
        this.failures++
        if (this.failures >= 3) {
          this.config = { ...this.config, enabled: false }
          if (this.timer !== undefined) clearInterval(this.timer)
          this.timer = undefined
          this.nextCheckAt = undefined
          await this.persist(this.config)
          this.reportAttention({
            kind: 'paper-error', symbol: this.config.symbols[0] ?? 'BTCUSDT',
            detail: 'Tres fallos de datos o ejecución PAPER; motor pausado de forma segura',
          })
        }
      }
    })()
    this.pending = run
    try { await run } finally { if (this.pending === run) this.pending = undefined }
    return result
  }

  /**
   * Read genuine account and journal for the Phoenix chat trading dashboard.
   * @returns Actual virtual account and latest persisted PAPER operations.
   */
  async dashboard(): Promise<BinancePaperAutomationView> {
    const [account, trades] = await Promise.all([
      this.broker.account(),
      this.broker.journal(MAX_RECENT_TRADES),
    ])
    return {
      mode: 'paper',
      phase: this.lastError !== undefined ? 'error' : this.config.enabled ? 'running' : 'stopped',
      enabled: this.config.enabled,
      ...(this.lastAttemptAt === undefined ? {} : { lastAttemptAt: this.lastAttemptAt }),
      ...(this.lastSuccessAt === undefined ? {} : { lastSuccessAt: this.lastSuccessAt }),
      ...(this.nextCheckAt === undefined ? {} : { nextCheckAt: this.nextCheckAt }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      ...(this.lastCycle === undefined ? {} : { lastCycle: this.lastCycle }),
      successfulCycles: this.successfulCycles,
      filledCycles: this.filledCycles,
      signalsQualified: this.signalsQualified,
      universeSize: this.universe.length,
      lastScannedSymbols: this.lastScannedSymbols,
      ...(this.lastDiscoveryAt === undefined ? {} : { lastDiscoveryAt: this.lastDiscoveryAt }),
      ...(this.lastDiscoveryIssue === undefined ? {} : { lastDiscoveryIssue: this.lastDiscoveryIssue }),
      settings: this.config,
      account,
      markedAt: new Date().toISOString(),
      recentTrades: trades,
    }
  }

  /** Close timers during Host disposal; do not disable the user's saved PAPER setting. */
  async dispose(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.config = { ...this.config, enabled: false }
    await this.pending?.catch(() => undefined)
  }
}

const automationByPath = new Map<string, { instance: BinancePaperAutomation; refs: number }>()

/**
 * Share one Host-scoped virtual worker across agent tool registries.
 * @param path - Host-owned virtual portfolio ledger path.
 * @returns Automation service and reversible process ownership handle.
 */
export function acquireBinancePaperAutomation(path: string): {
  readonly engine: BinancePaperAutomation
  release(): void
} {
  const key = resolve(path)
  let current = automationByPath.get(key)
  if (current === undefined) {
    current = { instance: new BinancePaperAutomation(new BinancePaperBroker(key), key + '.auto.json'), refs: 0 }
    automationByPath.set(key, current)
  }
  current.refs++
  const entry = current
  return {
    engine: entry.instance,
    release() {
      entry.refs--
      if (entry.refs === 0 && automationByPath.get(key) === entry) {
        automationByPath.delete(key)
        void entry.instance.dispose()
      }
    },
  }
}
