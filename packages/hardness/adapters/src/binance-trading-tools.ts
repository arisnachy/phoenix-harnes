import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import type {
  BinanceCandle,
  BinancePaperAccount,
  BinancePaperBroker,
  BinancePaperTrade,
} from './binance-paper.ts'

/** Secret-free lifecycle state of the pinned Binance Agent OS connector. */
export interface BinanceAgentOsSnapshot {
  configured: boolean
  status?: 'starting' | 'ready' | 'disconnected' | 'failed' | 'auth-required'
  reasonCode?: 'connection-failed' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
}

/** Host operations exposed to the model-facing Binance activation boundary. */
export interface BinanceAgentOsHostService {
  binanceAgentOsState(): Promise<BinanceAgentOsSnapshot>
  enableBinanceAgentOs(): Promise<{
    status: 'installed' | 'already-installed'
    connector: { entryId: string; serverName: string; url: string }
  }>
  disableBinanceAgentOs(): Promise<{ disabled: boolean }>
}

/** Runtime dependencies for the on-demand Binance tool family. */
export interface BinanceTradingToolDependencies {
  broker: BinancePaperBroker
  approval: Pick<ApprovalService, 'request'>
  agentOs?: Partial<BinanceAgentOsHostService>
}

function accountSummary(account: Awaited<ReturnType<BinancePaperBroker['account']>>): string {
  const sign = account.totalPnlUsdt >= 0 ? '+' : ''
  return `Paper equity ${account.equityUsdt.toFixed(2)} USDT · PnL ${sign}${account.totalPnlUsdt.toFixed(2)} USDT (${sign}${account.totalReturnPct.toFixed(2)}%) · ${account.tradeCount} trades`
}

function paperAccountJson(account: BinancePaperAccount): Record<string, JsonValue> {
  return {
    mode: account.mode,
    initialCashUsdt: account.initialCashUsdt,
    cashUsdt: account.cashUsdt,
    equityUsdt: account.equityUsdt,
    realizedPnlUsdt: account.realizedPnlUsdt,
    unrealizedPnlUsdt: account.unrealizedPnlUsdt,
    totalPnlUsdt: account.totalPnlUsdt,
    totalReturnPct: account.totalReturnPct,
    feeRate: account.feeRate,
    tradeCount: account.tradeCount,
    closedTradeCount: account.closedTradeCount,
    winRatePct: account.winRatePct,
    profitFactor: account.profitFactor,
    maxDrawdownPct: account.maxDrawdownPct,
    positions: account.positions.map(position => ({
      symbol: position.symbol,
      quantity: position.quantity,
      averageEntryUsdt: position.averageEntryUsdt,
      marketPriceUsdt: position.marketPriceUsdt,
      marketValueUsdt: position.marketValueUsdt,
      costBasisUsdt: position.costBasisUsdt,
      unrealizedPnlUsdt: position.unrealizedPnlUsdt,
    })),
  }
}

function paperTradeJson(trade: BinancePaperTrade): Record<string, JsonValue> {
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
    ...(trade.strategyId === undefined ? {} : { strategyId: trade.strategyId }),
    ...(trade.reason === undefined ? {} : { reason: trade.reason }),
  }
}

function candleJson(candle: BinanceCandle): Record<string, JsonValue> {
  return {
    openTime: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    closeTime: candle.closeTime,
    quoteVolume: candle.quoteVolume,
    trades: candle.trades,
  }
}

function agentOsJson(state: BinanceAgentOsSnapshot): Record<string, JsonValue> {
  return {
    configured: state.configured,
    ...(state.status === undefined ? {} : { status: state.status }),
    ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  }
}

function activateTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_trading_activate',
    description: 'Activate the special Binance capability on demand. PAPER is the default and uses only public market data plus a local virtual ledger. REAL may be requested only after the user explicitly asks for real Binance operation; set requestedByUser=true and PHOENIX will ask for one-shot high-risk approval before installing the pinned official Binance Agent OS MCP. Activating REAL does not place an order.',
    parameters: {
      mode: { type: 'string', required: true, enum: ['paper', 'real'] },
      requestedByUser: { type: 'boolean', description: 'Must be true for REAL and only when the user explicitly requested real operation.' },
      initialCashUsdt: { type: 'number', description: 'Virtual starting balance for a new/reset paper ledger.' },
      resetPaper: { type: 'boolean', description: 'Reset the local PAPER ledger before starting. This never affects Binance.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args.mode === 'paper') {
        if (deps.agentOs?.disableBinanceAgentOs !== undefined) {
          await deps.agentOs.disableBinanceAgentOs()
        }
        const account = await deps.broker.activate({
          ...(args.initialCashUsdt === undefined ? {} : { initialCashUsdt: args.initialCashUsdt }),
          reset: args.resetPaper === true,
        })
        return {
          mode: 'paper',
          realTradingEnabled: false,
          account: paperAccountJson(account),
          message: `${accountSummary(account)}. Real Binance tools are not used in PAPER mode.`,
        }
      }

      if (args.requestedByUser !== true) {
        return {
          mode: 'paper',
          realTradingEnabled: false,
          status: 'denied',
          message: 'REAL activation requires an explicit user request; staying in PAPER mode.',
        }
      }
      if (exec.agent === undefined) throw new Error('REAL Binance activation requires an active agent session')
      if (deps.agentOs?.enableBinanceAgentOs === undefined) {
        throw new Error('Binance Agent OS host integration is unavailable in this Phoenix runtime')
      }
      const outcome = await deps.approval.request({
        agent: exec.agent,
        toolName: 'binance_trading_activate',
        callId: exec.callId,
        reason: 'Enable the official Binance Agent OS connector for REAL account access. This activation places no order, but authorized Binance tools may later act on real funds within provider permissions.',
        risk: 'high',
        reversible: true,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') {
        return {
          mode: 'paper',
          realTradingEnabled: false,
          status: 'denied',
          approvalOutcome: outcome,
          message: 'REAL Binance activation was not approved; Phoenix remains in PAPER/read-only operation.',
        }
      }
      const receipt = await deps.agentOs.enableBinanceAgentOs()
      const state = deps.agentOs.binanceAgentOsState === undefined
        ? undefined
        : await deps.agentOs.binanceAgentOsState()
      return {
        mode: 'real',
        realTradingEnabled: true,
        status: receipt.status,
        connector: {
          serverName: receipt.connector.serverName,
          url: receipt.connector.url,
        },
        ...(state === undefined ? {} : { connectorState: agentOsJson(state) }),
        message: 'Binance Agent OS is enabled. Complete Binance authorization/scopes if requested. No real order has been placed.',
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.mode === 'real' ? 'Enable Binance REAL' : 'Start Binance PAPER',
        kind: args.mode === 'real' ? 'edit' : 'execute',
        rawInput: args.mode,
      }
    },
  })
}

function statusTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_trading_status',
    description: 'Read the local Binance PAPER account and secret-free Binance Agent OS connector state. This never places an order or changes authorization.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      const [paper, real] = await Promise.all([
        deps.broker.account(),
        deps.agentOs?.binanceAgentOsState?.() ?? Promise.resolve({ configured: false }),
      ])
      return { paper: paperAccountJson(paper), real: agentOsJson(real) }
    },
    presentCall() {
      return { card: 'generic', title: 'Binance trading status', kind: 'read' }
    },
  })
}

function candlesTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_market_candles',
    description: 'Read public Binance Spot OHLCV candles for analysis and charting. No Binance account or API key is used. Use phoenix_visualize when the user would benefit from a chart.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Binance Spot symbol such as BTCUSDT.' },
      interval: { type: 'string', required: true, description: 'Binance interval such as 1m, 5m, 1h, 4h, 1d.' },
      limit: { type: 'integer', description: '1-1000 candles. Defaults to 200.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const candles = await deps.broker.candles(args.symbol, args.interval, args.limit ?? 200)
      return {
        mode: 'public-market-data',
        symbol: args.symbol.trim().toUpperCase(),
        interval: args.interval,
        candles: candles.map(candleJson),
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Binance candles: ${args.symbol}`, kind: 'read', rawInput: args.interval }
    },
  })
}

function paperOrderTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_paper_order',
    description: 'Place a VIRTUAL Binance Spot paper order in Phoenix. This tool cannot access a Binance account or move real funds. BUY accepts exactly one of quantity or quoteAmountUsdt; SELL requires quantity. Record strategyId/reason so HARDNESS can evaluate learning evidence.',
    parameters: {
      symbol: { type: 'string', required: true },
      side: { type: 'string', required: true, enum: ['buy', 'sell'] },
      quantity: { type: 'number' },
      quoteAmountUsdt: { type: 'number' },
      strategyId: { type: 'string' },
      reason: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await deps.broker.order({
        symbol: args.symbol,
        side: args.side,
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        ...(args.quoteAmountUsdt === undefined ? {} : { quoteAmountUsdt: args.quoteAmountUsdt }),
        ...(args.strategyId === undefined ? {} : { strategyId: args.strategyId }),
        ...(args.reason === undefined ? {} : { reason: args.reason }),
      })
      return {
        trade: paperTradeJson(result.trade),
        account: paperAccountJson(result.account),
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `PAPER ${args.side.toUpperCase()} ${args.symbol.toUpperCase()}`,
        kind: 'execute',
        rawInput: args.quantity ?? args.quoteAmountUsdt ?? '',
      }
    },
  })
}

function paperAccountTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_paper_account',
    description: 'Mark the Phoenix Binance PAPER portfolio to fresh public Binance prices and report equity, PnL, drawdown, win rate, profit factor, and positions. This is virtual only.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return paperAccountJson(await deps.broker.account())
    },
    presentCall() {
      return { card: 'generic', title: 'Binance PAPER account', kind: 'read' }
    },
  })
}

function paperJournalTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_paper_journal',
    description: 'Read recent virtual Binance PAPER fills, including strategyId, rationale, fees, realized PnL, and equity-after snapshots for HARDNESS learning/review.',
    parameters: {
      limit: { type: 'integer', description: '1-1000 recent paper trades. Defaults to 100.' },
    },
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return [...await deps.broker.journal(args.limit ?? 100)].map(paperTradeJson)
    },
    presentCall() {
      return { card: 'generic', title: 'Binance PAPER journal', kind: 'read' }
    },
  })
}

/**
 * Build the complete on-demand Binance model-tool family.
 * @param deps - Paper broker, approval seam, and optional Agent OS host controls.
 * @returns Tool definitions for activation, status, market data, and paper execution.
 */
export function createBinanceTradingTools(deps: BinanceTradingToolDependencies): readonly ToolDefinition[] {
  return [
    activateTool(deps),
    statusTool(deps),
    candlesTool(deps),
    paperOrderTool(deps),
    paperAccountTool(deps),
    paperJournalTool(deps),
  ]
}
