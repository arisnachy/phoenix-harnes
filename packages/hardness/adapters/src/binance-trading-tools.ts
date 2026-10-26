import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { runBinanceAdaptiveCycle } from './binance-adaptive.ts'
import type { BinancePaperAutomation, BinancePaperAutomationView } from './binance-paper-automation.ts'
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
  automation?: BinancePaperAutomation
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

function adaptiveCycleTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_adaptive_cycle',
    description: 'Run a token-free multi-strategy Binance Spot scan over 1-5 USDT pairs. SCAN returns ranked signals without trading. PAPER-STEP can place at most ONE VIRTUAL order per call with deterministic position/exposure caps; it never accesses or trades a real account. Use this tool instead of guessing a profitable strategy. Live automation is not implemented by this tool.',
    parameters: {
      watchlist: { type: 'string', required: true, description: 'Comma-separated Spot symbols, for example BTCUSDT,ETHUSDT. Maximum five unique USDT pairs.' },
      interval: { type: 'string', enum: ['15m', '1h', '4h', '1d'], description: 'Closed-candle analysis interval; default 1h.' },
      mode: { type: 'string', enum: ['scan', 'paper-step'], description: 'Default scan. paper-step authorizes only a virtual trade.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const result = await runBinanceAdaptiveCycle(deps.broker, {
        symbols: args.watchlist.split(','),
        ...(args.interval === undefined ? {} : { interval: args.interval }),
        ...(args.mode === undefined ? {} : { mode: args.mode }),
      })
      return {
        mode: result.mode,
        interval: result.interval,
        decision: result.decision,
        rationale: result.rationale,
        signals: result.signals.map(signal => ({
          symbol: signal.symbol,
          regime: signal.regime,
          strategy: signal.strategy,
          action: signal.action,
          score: signal.score,
          lastClose: signal.lastClose,
          reason: signal.reason,
        })),
        ...(result.trade === undefined ? {} : { trade: paperTradeJson(result.trade) }),
        account: paperAccountJson(result.account),
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.mode === 'paper-step' ? 'Adaptive Binance PAPER trade' : 'Adaptive Binance scan',
        kind: args.mode === 'paper-step' ? 'execute' : 'read',
        rawInput: args.watchlist,
      }
    },
  })
}

function dashboardJson(view: BinancePaperAutomationView): Record<string, JsonValue> {
  return {
    mode: 'paper', phase: view.phase, enabled: view.enabled,
    settings: { symbols: [...view.settings.symbols], interval: view.settings.interval, pollMs: view.settings.pollMs },
    ...(view.lastAttemptAt === undefined ? {} : { lastAttemptAt: view.lastAttemptAt }),
    ...(view.lastSuccessAt === undefined ? {} : { lastSuccessAt: view.lastSuccessAt }),
    ...(view.nextCheckAt === undefined ? {} : { nextCheckAt: view.nextCheckAt }),
    ...(view.lastError === undefined ? {} : { lastError: view.lastError }),
    account: paperAccountJson(view.account),
    recentTrades: view.recentTrades.map(paperTradeJson),
    signals: view.lastCycle?.signals.map(signal => ({
      symbol: signal.symbol, regime: signal.regime, strategy: signal.strategy,
      action: signal.action, score: signal.score, reason: signal.reason,
    })) ?? [],
    lastDecision: view.lastCycle?.decision ?? 'none',
    rationale: view.lastCycle?.rationale ?? 'No analysis executed in the current Host session',
  }
}

function dashboardTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_paper_dashboard',
    description: 'Open a first-party PHOENIX trading dashboard inside chat. Read real PAPER ledger, strategy signals, last engine decision, verified virtual fills, and auto-run status. Does not place an order. An enabled automation runs independently of the chat model; use the dashboard to inspect why it traded or held.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      if (deps.automation === undefined) throw new Error('PAPER automation is unavailable')
      const view = await deps.automation.dashboard()
      const dashboard = dashboardJson(view)
      return {
        dashboard,
        uiBlock: {
          component: 'trading_dashboard',
          version: 1,
          props: {
            title: 'Phoenix Trading · Binance',
            ...dashboard,
          },
        },
      }
    },
    presentCall() { return { card: 'generic', title: 'Visor de trading Binance', kind: 'read' } },
  })
}

function paperAutoTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_paper_auto',
    description: 'Start, stop, or request one immediate check of REAL background PAPER trading automation, independently of ChatGPT tokens. Start requires an explicitly user-requested virtual automation and a comma-separated 1-5 pair USDT watchlist; future checks run automatically while the Host runs, and resume after restart. It never connects to real funds or bypasses Binance order confirmation. Always report genuine tradeCount from the dashboard, not a fabricated fill.',
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'stop', 'check-now'] },
      requestedByUser: { type: 'boolean', description: 'Required true to START and only when the user asked for automatic paper trading.' },
      watchlist: { type: 'string', description: 'Comma-separated unique Spot USDT pairs; required on START.' },
      interval: { type: 'string', enum: ['15m', '1h', '4h', '1d'], description: 'Closed-candle strategy interval; default 15m.' },
      pollMinutes: { type: 'integer', description: 'How often the Host checks, 1–60 minutes; default 1.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if (deps.automation === undefined) throw new Error('PAPER automation is unavailable')
      if (args.action === 'start') {
        if (args.requestedByUser !== true) throw new Error('Starting automatic paper trading requires an explicit user request')
        if (typeof args.watchlist !== 'string') throw new Error('Starting paper trading requires a watchlist')
        await deps.automation.start({
          symbols: args.watchlist.split(','),
          ...(args.interval === undefined ? {} : { interval: args.interval }),
          ...(args.pollMinutes === undefined ? {} : { pollMs: args.pollMinutes * 60_000 }),
        })
      } else if (args.action === 'stop') {
        await deps.automation.stop()
      } else {
        await deps.automation.step()
      }
      return dashboardJson(await deps.automation.dashboard())
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.action === 'start' ? 'Iniciar trading PAPER' : args.action === 'stop'
          ? 'Detener trading PAPER' : 'Comprobar trading PAPER',
        kind: args.action === 'check-now' ? 'read' : 'execute',
        rawInput: args.action,
      }
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
    adaptiveCycleTool(deps),
    dashboardTool(deps),
    paperAutoTool(deps),
  ]
}
