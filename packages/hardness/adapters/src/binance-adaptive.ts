import type { BinanceCandle, BinancePaperAccount, BinancePaperBroker, BinancePaperTrade } from './binance-paper.ts'

/** Supported closed-candle market regimes for adaptive paper trading. */
export type BinanceMarketRegime = 'uptrend' | 'downtrend' | 'range'
/** Reproducible candidate strategy, never a prediction of guaranteed profit. */
export type BinanceAdaptiveStrategy = 'breakout' | 'trend-pullback' | 'mean-reversion' | 'defensive-exit' | 'none'

/** Bounded scan output; no raw candle arrays are sent to the language model. */
export interface BinanceAdaptiveSignal {
  readonly symbol: string
  readonly regime: BinanceMarketRegime
  readonly strategy: BinanceAdaptiveStrategy
  readonly action: 'buy' | 'sell' | 'hold'
  readonly score: number
  readonly lastClose: number
  readonly reason: string
}

/** One token-free decision against Phoenix's isolated virtual Spot ledger. */
export interface BinanceAdaptiveCycle {
  readonly mode: 'scan' | 'paper-step'
  readonly interval: '15m' | '1h' | '4h' | '1d'
  readonly signals: readonly BinanceAdaptiveSignal[]
  readonly decision: 'buy' | 'sell' | 'hold'
  readonly rationale: string
  readonly trade?: BinancePaperTrade
  readonly account: BinancePaperAccount
}

/** Bounded configuration for one deterministic scan. */
export interface BinanceAdaptiveRequest {
  readonly symbols: readonly string[]
  readonly interval?: BinanceAdaptiveCycle['interval']
  readonly mode?: BinanceAdaptiveCycle['mode']
}

/** Minimal paper-only broker dependency; no real-account connector is accessible. */
export type BinanceAdaptiveBroker = Pick<BinancePaperBroker, 'candles' | 'account' | 'order'>

const INTERVAL_MS: Record<BinanceAdaptiveCycle['interval'], number> = {
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
}
const MAX_SYMBOLS = 5
const MAX_POSITION_FRACTION = 0.05
const MAX_PORTFOLIO_EXPOSURE = 0.20
const MAX_OPEN_POSITIONS = 2
const PAPER_STOP_PCT = -2.5
const MAX_MARKET_DATA_AGE = 2
const cycleLocks = new WeakMap<BinanceAdaptiveBroker, Promise<void>>()

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function movingAverage(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function ema(values: readonly number[], period: number): number {
  const multiplier = 2 / (period + 1)
  let current = values[0] ?? 0
  for (const value of values.slice(1)) current = value * multiplier + current * (1 - multiplier)
  return current
}

function hold(symbol: string, reason: string): BinanceAdaptiveSignal {
  return { symbol, regime: 'range', strategy: 'none', action: 'hold', score: 0, lastClose: 0, reason }
}

/**
 * Evaluate only confirmed, chronologically ordered OHLCV bars. Returns a signal
 * score, not a forecast probability; incomplete and stale data fail closed.
 * @param symbol - Normalized Spot USDT pair.
 * @param candles - Public Binance candles in chronological order.
 * @param intervalMs - Expected closed-bar interval in milliseconds.
 * @param now - Reference clock, injected for deterministic tests.
 * @returns Ranked signal for the latest confirmed bar.
 */
export function evaluateBinanceAdaptiveSignal(
  symbol: string,
  candles: readonly BinanceCandle[],
  intervalMs: number,
  now: number,
): BinanceAdaptiveSignal {
  if (!positive(intervalMs) || !Number.isFinite(now)) throw new Error('Invalid adaptive scan clock')
  if (candles.length < 42) return hold(symbol, 'Insufficient candle history')
  let previous = -Infinity
  for (const candle of candles) {
    if (!positive(candle.close) || !positive(candle.open) || !positive(candle.high)
      || !positive(candle.low) || !Number.isFinite(candle.volume) || candle.volume < 0
      || !Number.isFinite(candle.closeTime) || candle.closeTime <= previous
      || candle.high < Math.max(candle.open, candle.close)
      || candle.low > Math.min(candle.open, candle.close)) {
      return hold(symbol, 'Invalid or out-of-order market candles')
    }
    previous = candle.closeTime
  }
  const closed = candles.filter(candle => candle.closeTime <= now)
  if (closed.length < 40) return hold(symbol, 'No sufficient closed candles')
  const last = closed.at(-1)
  if (last === undefined || now - last.closeTime > intervalMs * MAX_MARKET_DATA_AGE) {
    return hold(symbol, 'Stale market data')
  }
  const closes = closed.map(candle => candle.close)
  const recent = closes.slice(-20)
  const earlier = closes.slice(-41, -1)
  const previousWindow = closes.slice(-21, -1)
  const lastClose = last.close
  const fast = ema(closes, 8)
  const slow = ema(closes, 21)
  const mean = movingAverage(recent)
  const variance = movingAverage(recent.map(value => (value - mean) ** 2))
  const deviation = Math.sqrt(variance)
  const zScore = deviation > 0 ? (lastClose - mean) / deviation : 0
  const volumes = closed.slice(-21, -1).map(candle => candle.volume)
  const averageVolume = movingAverage(volumes)
  const volumeRatio = averageVolume > 0 ? last.volume / averageVolume : 0
  const slope = (fast - slow) / slow
  const regime: BinanceMarketRegime = slope > 0.006 ? 'uptrend' : slope < -0.006 ? 'downtrend' : 'range'
  const previousHigh = Math.max(...previousWindow)
  const previousLow = Math.min(...previousWindow)
  const historicMean = movingAverage(earlier)
  // A closed-bar breakout requires volume confirmation; no live-tick chasing.
  if (regime === 'uptrend' && lastClose > previousHigh * 1.001 && volumeRatio >= 1.15) {
    return { symbol, regime, strategy: 'breakout', action: 'buy', score: 80,
      lastClose, reason: 'Closed-bar breakout with confirmed volume and positive trend' }
  }
  // Avoid buying a falling trend; a pullback must recover the fast EMA.
  if (regime === 'uptrend' && lastClose >= fast && lastClose <= fast * 1.012
    && lastClose > (closes.at(-2) ?? lastClose) && historicMean > 0) {
    return { symbol, regime, strategy: 'trend-pullback', action: 'buy', score: 65,
      lastClose, reason: 'Uptrend pullback recovering the fast moving average' }
  }
  if (regime === 'range' && zScore <= -1.5 && lastClose > previousLow * 0.995
    && volumeRatio > 0) {
    return { symbol, regime, strategy: 'mean-reversion', action: 'buy', score: 60,
      lastClose, reason: 'Range-bound discount relative to recent mean' }
  }
  if (regime === 'downtrend') {
    return { symbol, regime, strategy: 'defensive-exit', action: 'sell', score: 85,
      lastClose, reason: 'Confirmed negative trend; consider reducing existing exposure' }
  }
  return { symbol, regime, strategy: 'none', action: 'hold', score: 0,
    lastClose, reason: 'No validated entry or defensive exit signal' }
}

function normalizedSymbols(raw: readonly string[]): string[] {
  if (raw.length === 0 || raw.length > MAX_SYMBOLS) {
    throw new Error('Adaptive Binance scan requires between 1 and 5 symbols')
  }
  const symbols = [...new Set(raw.map(symbol => symbol.trim().toUpperCase()))]
  if (symbols.length !== raw.length || symbols.some(symbol => !/^[A-Z0-9]{3,16}USDT$/u.test(symbol))) {
    throw new Error('Adaptive Binance scan accepts unique Spot USDT symbols only')
  }
  return symbols
}

async function serialized<T>(broker: BinanceAdaptiveBroker, fn: () => Promise<T>): Promise<T> {
  const prior = cycleLocks.get(broker) ?? Promise.resolve()
  let unlock: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { unlock = resolve })
  const next = prior.catch(() => undefined).then(() => gate)
  cycleLocks.set(broker, next)
  await prior.catch(() => undefined)
  try {
    return await fn()
  } finally {
    unlock?.()
    if (cycleLocks.get(broker) === next) cycleLocks.delete(broker)
  }
}

/**
 * Scan a bounded watchlist and optionally perform exactly one virtual trade.
 * The strategy comparison uses zero LLM tokens and never calls a real API.
 * @param broker - Phoenix isolated paper broker.
 * @param request - Watchlist, candle interval, and scan or paper-step mode.
 * @param now - Scan clock for fresh-bar validation.
 * @returns Signals, decision, virtual trade if any, and updated paper account.
 */
export async function runBinanceAdaptiveCycle(
  broker: BinanceAdaptiveBroker,
  request: BinanceAdaptiveRequest,
  now = Date.now(),
): Promise<BinanceAdaptiveCycle> {
  return serialized(broker, async () => {
    const symbols = normalizedSymbols(request.symbols)
    const requestedInterval: string = request.interval ?? '1h'
    if (!Object.hasOwn(INTERVAL_MS, requestedInterval)) throw new Error('Unsupported Binance adaptive interval')
    const interval = requestedInterval as keyof typeof INTERVAL_MS
    const intervalMs = INTERVAL_MS[interval]
    const requestedMode: string = request.mode ?? 'scan'
    if (!['scan', 'paper-step'].includes(requestedMode)) throw new Error('Invalid adaptive mode')
    const mode = requestedMode as BinanceAdaptiveCycle['mode']
    const account = await broker.account()
    const signals: BinanceAdaptiveSignal[] = []
    for (const symbol of symbols) {
      const bars = await broker.candles(symbol, interval, 80)
      signals.push(evaluateBinanceAdaptiveSignal(symbol, bars, intervalMs, now))
    }
    const sorted = [...signals].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    const exits = sorted.flatMap((signal) => {
      const position = account.positions.find(item => item.symbol === signal.symbol)
      if (position === undefined) return []
      const pnl = (position.marketPriceUsdt / position.averageEntryUsdt - 1) * 100
      return pnl <= PAPER_STOP_PCT || signal.action === 'sell'
        ? [{ signal, position }] : []
    })
    const exit = exits[0]
    const exposure = account.positions.reduce((sum, position) => sum + position.marketValueUsdt, 0)
    const candidate = sorted.find(signal => signal.action === 'buy'
      && !account.positions.some(position => position.symbol === signal.symbol))
    const budget = Math.min(account.equityUsdt * MAX_POSITION_FRACTION,
      Math.max(0, account.equityUsdt * MAX_PORTFOLIO_EXPOSURE - exposure),
      account.cashUsdt / (1 + account.feeRate))

    if (mode === 'scan') {
      return { mode, interval, signals: sorted, decision: 'hold',
        rationale: 'Read-only ranked scan; paper orders require paper-step mode', account }
    }
    if (exit !== undefined) {
      const result = await broker.order({
        symbol: exit.signal.symbol,
        side: 'sell',
        quantity: exit.position.quantity,
        strategyId: 'adaptive-defensive-v1',
        reason: exit.signal.reason,
      })
      return { mode, interval, signals: sorted, decision: 'sell',
        rationale: 'Risk or defensive exit from an existing virtual position',
        trade: result.trade, account: result.account }
    }
    if (candidate !== undefined && budget >= 10
      && account.positions.length < MAX_OPEN_POSITIONS
      && account.maxDrawdownPct < 5) {
      const result = await broker.order({
        symbol: candidate.symbol,
        side: 'buy',
        quoteAmountUsdt: Math.floor(budget * 100) / 100,
        strategyId: 'adaptive-' + candidate.strategy + '-v1',
        reason: candidate.reason,
      })
      return { mode, interval, signals: sorted, decision: 'buy',
        rationale: 'Highest scored eligible virtual entry within portfolio limits',
        trade: result.trade, account: result.account }
    }
    return { mode, interval, signals: sorted, decision: 'hold',
      rationale: 'No eligible virtual order within signal and portfolio risk limits', account }
  })
}
