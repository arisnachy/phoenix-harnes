interface TradingPosition {
  readonly symbol: string
  readonly quantity: number
  readonly marketValueUsdt: number
  readonly unrealizedPnlUsdt: number
}
interface TradingSignal {
  readonly symbol: string
  readonly action: string
  readonly strategy: string
  readonly regime: string
  readonly score: number
  readonly reason: string
}
interface TradingTrade {
  readonly id: string
  readonly symbol: string
  readonly side: 'buy' | 'sell'
  readonly executedAt: string
  readonly grossUsdt: number
  readonly price: number
  readonly strategyId?: string
}
/** First-party, read-only Binance PAPER evidence projected from settled tool output. */
export interface TradingDashboardSnapshot {
  readonly mode: 'paper'
  readonly phase: 'running' | 'stopped' | 'error'
  readonly enabled: boolean
  readonly settings: { readonly symbols: readonly string[]; readonly interval: string; readonly pollMs: number }
  readonly account: {
    readonly equityUsdt: number
    readonly cashUsdt: number
    readonly totalPnlUsdt: number
    readonly totalReturnPct: number
    readonly maxDrawdownPct: number
    readonly tradeCount: number
    readonly positions: readonly TradingPosition[]
  }
  readonly signals: readonly TradingSignal[]
  readonly recentTrades: readonly TradingTrade[]
  readonly lastDecision: string
  readonly rationale: string
  readonly lastAttemptAt?: string
  readonly lastSuccessAt?: string
  readonly nextCheckAt?: string
  readonly lastError?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Reject malformed virtual dashboard payloads rather than styling arbitrary JSON.
 * @param value - Unknown tool or Host response.
 * @returns Validated read-only trading evidence, or undefined.
 */
export function parseTradingDashboard(value: unknown): TradingDashboardSnapshot | undefined {
  const root = record(value)
  if (root?.mode !== 'paper' || !['running', 'stopped', 'error'].includes(String(root.phase))
    || typeof root.enabled !== 'boolean') return undefined
  const account = record(root.account)
  const settings = record(root.settings)
  if (account === undefined || settings === undefined
    || !Array.isArray(settings.symbols) || settings.symbols.length > 12
    || !settings.symbols.every(s => typeof s === 'string' && /^[A-Z0-9]{3,16}USDT$/u.test(s))
    || typeof settings.interval !== 'string' || !finite(settings.pollMs)
    || !['equityUsdt', 'cashUsdt', 'totalPnlUsdt', 'totalReturnPct', 'maxDrawdownPct', 'tradeCount']
      .every(key => finite(account[key]))
    || !Array.isArray(account.positions) || account.positions.length > 12
    || !Array.isArray(root.signals) || root.signals.length > 12
    || !Array.isArray(root.recentTrades) || root.recentTrades.length > 12
    || typeof root.lastDecision !== 'string' || typeof root.rationale !== 'string') return undefined
  const positions = account.positions.map(record)
  if (positions.some(p => p === undefined || typeof p.symbol !== 'string'
    || !finite(p.quantity) || !finite(p.marketValueUsdt) || !finite(p.unrealizedPnlUsdt))) return undefined
  const signals = root.signals.map(record)
  if (signals.some(s => s === undefined || typeof s.symbol !== 'string' || typeof s.action !== 'string'
    || typeof s.strategy !== 'string' || typeof s.regime !== 'string'
    || typeof s.reason !== 'string' || !finite(s.score))) return undefined
  const trades = root.recentTrades.map(record)
  if (trades.some(t => t === undefined || typeof t.id !== 'string' || typeof t.symbol !== 'string'
    || (t.side !== 'buy' && t.side !== 'sell') || typeof t.executedAt !== 'string'
    || !finite(t.grossUsdt) || !finite(t.price)
    || (t.strategyId !== undefined && typeof t.strategyId !== 'string'))) return undefined
  return root as unknown as TradingDashboardSnapshot
}

type ResultBlock = {
  kind?: unknown
  call?: { name?: string } | null
  content?: readonly { type?: string; text?: string }[]
  isError?: boolean
  subCalls?: readonly ResultBlock[]
}
const NAMES = new Set(['binance_paper_dashboard', 'binance_paper_auto', 'binance_paper_order', 'binance_adaptive_cycle'])
const MAX_TEXT = 65_000

/**
 * Recover only the verified first-party Binance tool's settled PAPER snapshot.
 * @param root - Durable tool result, potentially with nested code-mode calls.
 * @returns Real virtual ledger evidence, or undefined when not verified.
 */
export function tradingDashboardFromToolResult(root: unknown): TradingDashboardSnapshot | undefined {
  if (record(root) === undefined) return undefined
  const stack: ResultBlock[] = [root as ResultBlock]
  let visits = 0
  while (stack.length > 0 && visits++ < 40) {
    const node = stack.pop()
    if (node === undefined) continue
    for (const child of [...(node.subCalls ?? [])].slice(0, 16).reverse()) stack.push(child)
    if (node.kind !== 'tool-result' || node.isError === true || !NAMES.has(node.call?.name ?? '')) continue
    const raw = node.content?.filter(part => part.type === 'text')
      .map(part => part.text ?? '').join('') ?? ''
    if (!raw || raw.length > MAX_TEXT) continue
    try {
      const payload = record(JSON.parse(raw))
      if (payload === undefined) continue
      const block = record(payload.uiBlock)
      const view = block?.component === 'trading_dashboard' && block.version === 1
        ? record(block.props) : record(payload.dashboard) ?? payload
      const parsed = parseTradingDashboard(view)
      if (parsed !== undefined) return parsed
    } catch { /* Ignore non-JSON provider results. */ }
  }
  return undefined
}

/** Market chart is public Binance Spot context, not evidence of a funded account. */
export type TradingMarketSelection = {
  readonly symbol: string
  readonly interval: '15m' | '1h' | '4h' | '1d'
}

/**
 * Recognize first-party OHLCV results rather than accepting assistant prose.
 * @param root - Settled tool output and nested code-mode calls.
 * @returns Public chart selection, or undefined when evidence is absent.
 */
export function tradingMarketFromToolResult(root: unknown): TradingMarketSelection | undefined {
  if (record(root) === undefined) return undefined
  const stack: ResultBlock[] = [root as ResultBlock]
  let visits = 0
  while (stack.length > 0 && visits++ < 40) {
    const node = stack.pop()
    if (node === undefined) continue
    for (const child of [...(node.subCalls ?? [])].slice(0, 16).reverse()) stack.push(child)
    if (node.kind !== 'tool-result' || node.isError === true
      || node.call?.name !== 'binance_market_candles') continue
    const raw = node.content?.filter(part => part.type === 'text')
      .map(part => part.text ?? '').join('') ?? ''
    if (!raw || raw.length > 150_000) continue
    try {
      const payload = record(JSON.parse(raw))
      if (payload === undefined || payload.mode !== 'public-market-data'
        || typeof payload.symbol !== 'string' || !/^[A-Z0-9]{3,16}USDT$/u.test(payload.symbol)
        || !['15m', '1h', '4h', '1d'].includes(String(payload.interval))
        || !Array.isArray(payload.candles) || payload.candles.length < 1
        || payload.candles.length > 1000) continue
      return {
        symbol: payload.symbol,
        interval: payload.interval as TradingMarketSelection['interval'],
      }
    } catch { /* Broken or unverified tool result: do not display a fabricated chart. */ }
  }
  return undefined
}
