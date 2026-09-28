import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_INITIAL_CASH_USDT = 10_000
const DEFAULT_FEE_RATE = 0.001
const MAX_TRADES_RETAINED = 10_000
const BINANCE_PUBLIC_API = 'https://api.binance.com'
const SUPPORTED_INTERVALS = new Set([
  '1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h',
  '12h', '1d', '3d', '1w', '1M',
])

const PATH_LOCKS = new Map<string, Promise<void>>()

export interface BinancePaperPosition {
  symbol: string
  quantity: number
  costBasisUsdt: number
}

export interface BinancePaperTrade {
  id: string
  executedAt: string
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  grossUsdt: number
  feeUsdt: number
  realizedPnlUsdt: number
  equityAfterUsdt: number
  strategyId?: string
  reason?: string
}

export interface BinancePaperState {
  schema: 1
  initialCashUsdt: number
  cashUsdt: number
  realizedPnlUsdt: number
  feeRate: number
  positions: Record<string, BinancePaperPosition>
  trades: BinancePaperTrade[]
}

export interface BinanceCandle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
  quoteVolume: number
  trades: number
}

export interface BinancePaperAccount {
  mode: 'paper'
  initialCashUsdt: number
  cashUsdt: number
  equityUsdt: number
  realizedPnlUsdt: number
  unrealizedPnlUsdt: number
  totalPnlUsdt: number
  totalReturnPct: number
  feeRate: number
  tradeCount: number
  closedTradeCount: number
  winRatePct: number | null
  profitFactor: number | null
  maxDrawdownPct: number
  positions: Array<{
    symbol: string
    quantity: number
    averageEntryUsdt: number
    marketPriceUsdt: number
    marketValueUsdt: number
    costBasisUsdt: number
    unrealizedPnlUsdt: number
  }>
}

export interface BinancePublicMarket {
  price(symbol: string): Promise<number>
  prices(symbols: readonly string[]): Promise<Record<string, number>>
  candles(symbol: string, interval: string, limit: number): Promise<BinanceCandle[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{5,20}$/u.test(symbol)) {
    throw new Error('Binance symbol must be 5-20 alphanumeric characters, for example BTCUSDT')
  }
  return symbol
}

function normalizeInterval(value: string): string {
  const interval = value.trim()
  if (!SUPPORTED_INTERVALS.has(interval)) {
    throw new Error(`Unsupported Binance candle interval: ${interval}`)
  }
  return interval
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) {
    throw new Error(`Binance public API failed with HTTP ${response.status}`)
  }
  return response.json()
}

function parsePrice(value: unknown, symbol: string): number {
  if (!isRecord(value) || typeof value.price !== 'string') {
    throw new Error(`Binance returned an invalid price payload for ${symbol}`)
  }
  const price = Number(value.price)
  if (!finitePositive(price)) throw new Error(`Binance returned an invalid price for ${symbol}`)
  return price
}

/** Public, credential-free Binance Spot market reader used by paper trading. */
export class BinancePublicMarketClient implements BinancePublicMarket {
  async price(rawSymbol: string): Promise<number> {
    const symbol = normalizeSymbol(rawSymbol)
    const url = new URL('/api/v3/ticker/price', BINANCE_PUBLIC_API)
    url.searchParams.set('symbol', symbol)
    return parsePrice(await fetchJson(url), symbol)
  }

  async prices(rawSymbols: readonly string[]): Promise<Record<string, number>> {
    const symbols = [...new Set(rawSymbols.map(normalizeSymbol))]
    if (symbols.length === 0) return {}
    const entries = await Promise.all(symbols.map(async symbol => [symbol, await this.price(symbol)] as const))
    return Object.fromEntries(entries)
  }

  async candles(rawSymbol: string, rawInterval: string, rawLimit: number): Promise<BinanceCandle[]> {
    const symbol = normalizeSymbol(rawSymbol)
    const interval = normalizeInterval(rawInterval)
    const limit = Math.max(1, Math.min(1000, Math.floor(rawLimit)))
    const url = new URL('/api/v3/klines', BINANCE_PUBLIC_API)
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('interval', interval)
    url.searchParams.set('limit', String(limit))
    const payload = await fetchJson(url)
    if (!Array.isArray(payload)) throw new Error('Binance returned an invalid candle payload')
    return payload.map((row, index) => {
      if (!Array.isArray(row) || row.length < 9) throw new Error(`Binance candle ${index} is invalid`)
      const candle: BinanceCandle = {
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
        quoteVolume: Number(row[7]),
        trades: Number(row[8]),
      }
      if (!Number.isFinite(candle.openTime) || !finitePositive(candle.open)
        || !finitePositive(candle.high) || !finitePositive(candle.low)
        || !finitePositive(candle.close) || !finiteNonNegative(candle.volume)
        || !Number.isFinite(candle.closeTime) || !finiteNonNegative(candle.quoteVolume)
        || !Number.isFinite(candle.trades)) {
        throw new Error(`Binance candle ${index} contains invalid numeric values`)
      }
      return candle
    })
  }
}

function freshState(initialCashUsdt: number, feeRate: number): BinancePaperState {
  return {
    schema: 1,
    initialCashUsdt,
    cashUsdt: initialCashUsdt,
    realizedPnlUsdt: 0,
    feeRate,
    positions: {},
    trades: [],
  }
}

function parseState(raw: string): BinancePaperState {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || value.schema !== 1
    || !finitePositive(value.initialCashUsdt)
    || !finiteNonNegative(value.cashUsdt)
    || typeof value.realizedPnlUsdt !== 'number' || !Number.isFinite(value.realizedPnlUsdt)
    || !finiteNonNegative(value.feeRate) || value.feeRate >= 0.1
    || !isRecord(value.positions) || !Array.isArray(value.trades)) {
    throw new Error('Binance paper ledger is corrupted or incompatible; refusing to trade')
  }

  const positions: Record<string, BinancePaperPosition> = {}
  for (const [key, position] of Object.entries(value.positions)) {
    if (!isRecord(position) || position.symbol !== key
      || !finitePositive(position.quantity) || !finitePositive(position.costBasisUsdt)) {
      throw new Error('Binance paper ledger contains an invalid position; refusing to trade')
    }
    positions[key] = {
      symbol: key,
      quantity: position.quantity,
      costBasisUsdt: position.costBasisUsdt,
    }
  }

  const trades: BinancePaperTrade[] = value.trades.map((trade, index) => {
    if (!isRecord(trade) || typeof trade.id !== 'string' || typeof trade.executedAt !== 'string'
      || typeof trade.symbol !== 'string' || (trade.side !== 'buy' && trade.side !== 'sell')
      || !finitePositive(trade.quantity) || !finitePositive(trade.price)
      || !finitePositive(trade.grossUsdt) || !finiteNonNegative(trade.feeUsdt)
      || typeof trade.realizedPnlUsdt !== 'number' || !Number.isFinite(trade.realizedPnlUsdt)
      || !finiteNonNegative(trade.equityAfterUsdt)) {
      throw new Error(`Binance paper ledger contains invalid trade ${index}; refusing to trade`)
    }
    return {
      id: trade.id,
      executedAt: trade.executedAt,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      grossUsdt: trade.grossUsdt,
      feeUsdt: trade.feeUsdt,
      realizedPnlUsdt: trade.realizedPnlUsdt,
      equityAfterUsdt: trade.equityAfterUsdt,
      ...(typeof trade.strategyId === 'string' ? { strategyId: trade.strategyId } : {}),
      ...(typeof trade.reason === 'string' ? { reason: trade.reason } : {}),
    }
  })

  return {
    schema: 1,
    initialCashUsdt: value.initialCashUsdt,
    cashUsdt: value.cashUsdt,
    realizedPnlUsdt: value.realizedPnlUsdt,
    feeRate: value.feeRate,
    positions,
    trades,
  }
}

async function readState(path: string): Promise<BinancePaperState | undefined> {
  try {
    return parseState(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeState(path: string, state: BinancePaperState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, path)
}

async function withPathLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const previous = PATH_LOCKS.get(path) ?? Promise.resolve()
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const current = previous.catch(() => undefined).then(() => gate)
  PATH_LOCKS.set(path, current)
  await previous.catch(() => undefined)
  try {
    return await run()
  } finally {
    release?.()
    if (PATH_LOCKS.get(path) === current) PATH_LOCKS.delete(path)
  }
}

function round(value: number, digits = 8): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function performance(state: BinancePaperState, equityUsdt: number): {
  closedTradeCount: number
  winRatePct: number | null
  profitFactor: number | null
  maxDrawdownPct: number
} {
  const closes = state.trades.filter(trade => trade.side === 'sell')
  const wins = closes.filter(trade => trade.realizedPnlUsdt > 0)
  const grossProfit = closes.reduce((sum, trade) => sum + Math.max(0, trade.realizedPnlUsdt), 0)
  const grossLoss = Math.abs(closes.reduce((sum, trade) => sum + Math.min(0, trade.realizedPnlUsdt), 0))
  const curve = [state.initialCashUsdt, ...state.trades.map(trade => trade.equityAfterUsdt), equityUsdt]
  let peak = curve[0] ?? state.initialCashUsdt
  let maxDrawdown = 0
  for (const point of curve) {
    peak = Math.max(peak, point)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point) / peak)
  }
  return {
    closedTradeCount: closes.length,
    winRatePct: closes.length === 0 ? null : round((wins.length / closes.length) * 100, 4),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit / grossLoss, 6),
    maxDrawdownPct: round(maxDrawdown * 100, 4),
  }
}

/** Persistent spot-only paper broker. It cannot access Binance account credentials or place real orders. */
export class BinancePaperBroker {
  constructor(
    private readonly path: string,
    private readonly market: BinancePublicMarket = new BinancePublicMarketClient(),
  ) {}

  async activate(options: { initialCashUsdt?: number; reset?: boolean } = {}): Promise<BinancePaperAccount> {
    const initialCashUsdt = options.initialCashUsdt ?? DEFAULT_INITIAL_CASH_USDT
    if (!finitePositive(initialCashUsdt) || initialCashUsdt > 1_000_000_000) {
      throw new Error('Paper initial cash must be a finite positive USDT amount up to 1,000,000,000')
    }
    await withPathLock(this.path, async () => {
      const existing = await readState(this.path)
      if (existing !== undefined && options.reset !== true) return
      await writeState(this.path, freshState(initialCashUsdt, DEFAULT_FEE_RATE))
    })
    return this.account()
  }

  async candles(symbol: string, interval: string, limit = 200): Promise<BinanceCandle[]> {
    return this.market.candles(symbol, interval, limit)
  }

  async account(): Promise<BinancePaperAccount> {
    const state = await readState(this.path) ?? freshState(DEFAULT_INITIAL_CASH_USDT, DEFAULT_FEE_RATE)
    const symbols = Object.keys(state.positions)
    const marks = await this.market.prices(symbols)
    const positions = symbols.map(symbol => {
      const position = state.positions[symbol]
      if (position === undefined) throw new Error(`Missing paper position for ${symbol}`)
      const marketPriceUsdt = marks[symbol]
      if (!finitePositive(marketPriceUsdt)) throw new Error(`Missing market price for ${symbol}`)
      const marketValueUsdt = position.quantity * marketPriceUsdt
      return {
        symbol,
        quantity: round(position.quantity),
        averageEntryUsdt: round(position.costBasisUsdt / position.quantity),
        marketPriceUsdt: round(marketPriceUsdt),
        marketValueUsdt: round(marketValueUsdt),
        costBasisUsdt: round(position.costBasisUsdt),
        unrealizedPnlUsdt: round(marketValueUsdt - position.costBasisUsdt),
      }
    })
    const marketValue = positions.reduce((sum, position) => sum + position.marketValueUsdt, 0)
    const equityUsdt = state.cashUsdt + marketValue
    const unrealizedPnlUsdt = positions.reduce((sum, position) => sum + position.unrealizedPnlUsdt, 0)
    const metrics = performance(state, equityUsdt)
    return {
      mode: 'paper',
      initialCashUsdt: round(state.initialCashUsdt),
      cashUsdt: round(state.cashUsdt),
      equityUsdt: round(equityUsdt),
      realizedPnlUsdt: round(state.realizedPnlUsdt),
      unrealizedPnlUsdt: round(unrealizedPnlUsdt),
      totalPnlUsdt: round(equityUsdt - state.initialCashUsdt),
      totalReturnPct: round(((equityUsdt / state.initialCashUsdt) - 1) * 100, 4),
      feeRate: state.feeRate,
      tradeCount: state.trades.length,
      ...metrics,
      positions,
    }
  }

  async journal(limit = 100): Promise<readonly BinancePaperTrade[]> {
    const state = await readState(this.path)
    if (state === undefined) return []
    const size = Math.max(1, Math.min(1000, Math.floor(limit)))
    return state.trades.slice(-size)
  }

  async order(input: {
    symbol: string
    side: 'buy' | 'sell'
    quantity?: number
    quoteAmountUsdt?: number
    strategyId?: string
    reason?: string
  }): Promise<{ trade: BinancePaperTrade; account: BinancePaperAccount }> {
    const symbol = normalizeSymbol(input.symbol)
    const strategyId = input.strategyId?.trim()
    const reason = input.reason?.trim()
    const trade = await withPathLock(this.path, async () => {
      const state = await readState(this.path) ?? freshState(DEFAULT_INITIAL_CASH_USDT, DEFAULT_FEE_RATE)
      const price = await this.market.price(symbol)
      let quantity: number
      if (input.side === 'buy') {
        const hasQuantity = input.quantity !== undefined
        const hasQuote = input.quoteAmountUsdt !== undefined
        if (hasQuantity === hasQuote) {
          throw new Error('Paper BUY requires exactly one of quantity or quoteAmountUsdt')
        }
        if (input.quantity !== undefined) quantity = input.quantity
        else if (input.quoteAmountUsdt !== undefined) quantity = input.quoteAmountUsdt / price
        else throw new Error('Paper BUY requires a quantity or quoteAmountUsdt')
      } else {
        if (input.quoteAmountUsdt !== undefined || input.quantity === undefined) {
          throw new Error('Paper SELL requires quantity and does not accept quoteAmountUsdt')
        }
        quantity = input.quantity
      }
      if (!finitePositive(quantity)) throw new Error('Paper order quantity must be finite and positive')

      const grossUsdt = quantity * price
      const feeUsdt = grossUsdt * state.feeRate
      let realizedPnlUsdt = 0

      if (input.side === 'buy') {
        const debit = grossUsdt + feeUsdt
        if (debit > state.cashUsdt + 1e-9) {
          throw new Error(`Paper order exceeds available cash: needs ${round(debit, 2)} USDT`)
        }
        state.cashUsdt -= debit
        const current = state.positions[symbol]
        state.positions[symbol] = {
          symbol,
          quantity: (current?.quantity ?? 0) + quantity,
          costBasisUsdt: (current?.costBasisUsdt ?? 0) + debit,
        }
      } else {
        const current = state.positions[symbol]
        if (current === undefined || quantity > current.quantity + 1e-12) {
          throw new Error(`Paper SELL exceeds the virtual ${symbol} position`)
        }
        const fraction = quantity / current.quantity
        const releasedBasis = current.costBasisUsdt * fraction
        const proceeds = grossUsdt - feeUsdt
        realizedPnlUsdt = proceeds - releasedBasis
        state.cashUsdt += proceeds
        state.realizedPnlUsdt += realizedPnlUsdt
        const remainingQuantity = current.quantity - quantity
        if (remainingQuantity <= 1e-12) delete state.positions[symbol]
        else {
          state.positions[symbol] = {
            symbol,
            quantity: remainingQuantity,
            costBasisUsdt: current.costBasisUsdt - releasedBasis,
          }
        }
      }

      const marks = await this.market.prices(Object.keys(state.positions))
      const markedPositions = Object.values(state.positions).reduce((sum, position) => {
        const mark = marks[position.symbol]
        if (!finitePositive(mark)) throw new Error(`Missing market price for ${position.symbol}`)
        return sum + position.quantity * mark
      }, 0)
      const equityAfterUsdt = state.cashUsdt + markedPositions
      const next: BinancePaperTrade = {
        id: randomUUID(),
        executedAt: new Date().toISOString(),
        symbol,
        side: input.side,
        quantity: round(quantity),
        price: round(price),
        grossUsdt: round(grossUsdt),
        feeUsdt: round(feeUsdt),
        realizedPnlUsdt: round(realizedPnlUsdt),
        equityAfterUsdt: round(equityAfterUsdt),
        ...(strategyId === undefined || strategyId.length === 0 ? {} : { strategyId: strategyId.slice(0, 120) }),
        ...(reason === undefined || reason.length === 0 ? {} : { reason: reason.slice(0, 500) }),
      }
      state.cashUsdt = round(state.cashUsdt)
      state.realizedPnlUsdt = round(state.realizedPnlUsdt)
      state.trades = [...state.trades, next].slice(-MAX_TRADES_RETAINED)
      await writeState(this.path, state)
      return next
    })
    return { trade, account: await this.account() }
  }
}
