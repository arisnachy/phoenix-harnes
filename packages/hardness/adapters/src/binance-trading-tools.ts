import type { ApprovalService } from '@phoenix-ai/dsh-user-approval'
import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { runBinanceAdaptiveCycle } from './binance-adaptive.ts'
import { BinanceSpotTestnet } from './binance-spot-testnet.ts'
import type { BinanceCloudPaperClient } from './binance-cloud-bridge.ts'
import type { WakeEngine } from './wake-engine.ts'
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
  reasonCode?: 'connection-failed' | 'endpoint-not-found' | 'connection-lost' | 'authorization-required' | 'retry-exhausted'
  toolNames?: readonly string[]
}

/** Host operations exposed to the model-facing Binance activation boundary. */
export interface BinanceAgentOsHostService {
  binanceAgentOsState(): Promise<BinanceAgentOsSnapshot>
  enableBinanceAgentOs(): Promise<{
    status: 'installed' | 'already-installed'
    connector: { entryId: string; serverName: string; url: string }
  }>
  disableBinanceAgentOs(): Promise<{ disabled: boolean }>
  reconnectBinanceAgentOs?(): Promise<{ accepted: boolean }>
  repairBinanceAgentOs?(): Promise<{ status: 'installed' | 'already-installed'; connector: { entryId: string; serverName: string; url: string } }>
}

/** Runtime dependencies for the on-demand Binance tool family. */
export interface BinanceTradingToolDependencies {
  broker: BinancePaperBroker
  automation?: BinancePaperAutomation
  wake?: Pick<WakeEngine, 'create' | 'list'>
  approval: Pick<ApprovalService, 'request'>
  agentOs?: Partial<BinanceAgentOsHostService>
  testnet?: BinanceSpotTestnet
  cloud?: BinanceCloudPaperClient
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
      unrealizedReturnPct: position.unrealizedReturnPct,
      ...(position.exitPlan === undefined ? {} : {
        exitPlan: {
          strategyId: position.exitPlan.strategyId,
          entryPriceUsdt: position.exitPlan.entryPriceUsdt,
          stopLossPrice: position.exitPlan.stopLossPrice,
          tp1Price: position.exitPlan.tp1Price,
          tp2Price: position.exitPlan.tp2Price,
          tp1Taken: position.exitPlan.tp1Taken,
          tp1Fraction: position.exitPlan.tp1Fraction,
          origin: position.exitPlan.origin,
          createdAt: position.exitPlan.createdAt,
        },
      }),
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

function testnetStatusJson(status: Awaited<ReturnType<BinanceSpotTestnet['status']>>): Record<string, JsonValue> {
  return {
    mode: status.mode,
    configured: status.configured,
    connected: status.connected,
    nextAction: status.nextAction,
    ...(status.canTrade === undefined ? {} : { canTrade: status.canTrade }),
    ...(status.balances === undefined ? {}
      : { balances: status.balances.map(row => ({ asset: row.asset, free: row.free, locked: row.locked })) }),
  }
}

function agentOsJson(state: BinanceAgentOsSnapshot): Record<string, JsonValue> {
  return {
    configured: state.configured,
    ...(state.status === undefined ? {} : { status: state.status }),
    ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
    ready: state.configured && state.status === 'ready' && (state.toolNames?.length ?? 0) > 0,
    toolCount: state.toolNames?.length ?? 0,
    toolNames: (state.toolNames ?? []).slice(0, 60),
    nextAction: !state.configured ? 'install'
      : state.status === 'auth-required' ? 'authorize-in-settings'
        : state.status === 'ready' && (state.toolNames?.length ?? 0) > 0 ? 'use-live-mcp-tools'
          : 'reconnect-or-repair',
  }
}

function activateTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_trading_activate',
    description: 'Start the explicitly selected Binance mode. Before calling, ASK whether the user wants TESTING/PAPER or REAL if not stated. PAPER uses a local virtual ledger. REAL requires explicit user consent and one-shot high-risk approval to install the official Streamable HTTP OAuth MCP. The subsequent Binance browser OAuth/scope grant must be completed separately. This never executes real orders.',
    parameters: {
      mode: { type: 'string', required: true, enum: ['paper', 'testnet', 'real'] },
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

      if (args.mode === 'testnet') {
        const readiness = await (deps.testnet ?? new BinanceSpotTestnet()).status()
        return {
          ...testnetStatusJson(readiness),
          realTradingEnabled: false,
          message: 'Spot Testnet uses separate testing API keys and test funds, NOT the Binance Agentic OAuth MCP. No test order has been placed.',
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
      // Installation is not proof of OAuth consent, Trade scope or funding.
      // The runtime may be waiting for Binance user authorization.
      return {
        mode: 'real',
        realTradingEnabled: false,
        mcpOperational: state?.status === 'ready' && (state.toolNames?.length ?? 0) > 0,
        tradeScopeVerified: false,
        status: receipt.status,
        connector: {
          serverName: receipt.connector.serverName,
          url: receipt.connector.url,
        },
        ...(state === undefined ? {} : { connectorState: agentOsJson(state) }),
        message: state?.status === 'ready' && (state.toolNames?.length ?? 0) > 0
          ? 'Binance MCP tools discovered. Verify actual price data and permitted account scope using the MCP tools; REAL orders still require provider confirmation.'
          : 'Binance MCP installed, NOT YET VERIFIED. Authorize the Binance Agentic sub-account in Settings > Connectors > Binance, grant the intended scopes, and recheck MCP tools. No real order has been placed.',
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.mode === 'real' ? 'Autorizar Binance Agentic REAL'
          : args.mode === 'testnet' ? 'Comprobar Binance Spot Testnet' : 'Start Binance PAPER',
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

/**
 * Operational probe for the official Binance Agentic MCP. A ready transport
 * with discovered tools proves MCP readiness, NOT Binance Trade scope.
 */
function agentOsHealthTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_mcp_health',
    description: 'Check the official Binance Agentic MCP after user authorization. Return configured/auth-required/ready, actual discovered tool names, and next step. If it reports ready, CALL a discovered Binance MCP market-data tool for BTCUSDT to verify a live response. Do not claim REAL trading is authorized from this probe alone.',
    parameters: {
      action: { type: 'string', enum: ['status', 'reconnect', 'repair'],
        description: 'Default status is read-only. Reconnect retries a live MCP transport; repair replaces the old managed MCP row without erasing the vault grant.' },
      requestedByUser: { type: 'boolean', description: 'Required true for repair; do not repair automatically.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      if (deps.agentOs?.binanceAgentOsState === undefined) {
        return { configured: false, ready: false, nextAction: 'host-service-unavailable' }
      }
      if (args.action === 'repair') {
        if (args.requestedByUser !== true) throw new Error('Binance MCP repair requires explicit user request')
        if (deps.agentOs.repairBinanceAgentOs === undefined) {
          throw new Error('Binance MCP host repair is unavailable')
        }
        await deps.agentOs.repairBinanceAgentOs()
      } else if (args.action === 'reconnect') {
        if (deps.agentOs.reconnectBinanceAgentOs === undefined) {
          throw new Error('Binance MCP reconnect is unavailable')
        }
        const receipt = await deps.agentOs.reconnectBinanceAgentOs()
        if (!receipt.accepted) return {
          ...(agentOsJson(await deps.agentOs.binanceAgentOsState())),
          reconnectAccepted: false,
        }
      }
      const state = await deps.agentOs.binanceAgentOsState()
      return {
        ...agentOsJson(state),
        ...(args.action === 'reconnect' ? { reconnectAccepted: true } : {}),
        note: 'This checks MCP tool synchronization, NOT Trade scope, Agentic balance or order confirmation.',
      }
    },
    presentCall(args) {
      return { card: 'generic',
        title: args.action === 'repair' ? 'Reparar MCP Binance' : 'Diagnóstico MCP Binance',
        kind: args.action === 'repair' ? 'execute' : 'read' }
    },
  })
}

/**
 * Read only Binance Spot Testnet account state; this API is never the Agentic MCP.
 */
function testnetAccountTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_testnet_account',
    description: 'Check your actual Binance SPOT TESTNET account and fake-asset balances using dedicated Host-only testnet credentials. This is NOT the Binance Agentic MCP and cannot access real funds.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute() { return testnetStatusJson(await (deps.testnet ?? new BinanceSpotTestnet()).status()) },
    presentCall() { return { card: 'generic', title: 'Binance Spot Testnet', kind: 'read' } },
  })
}

/** Explicit consent and one-shot approval on each real TESTNET API request. */
function testnetOrderTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_testnet_order',
    description: 'Send ONE Spot Testnet market order with fake exchange funds. Never uses production Binance account or Agentic MCP. Requires a specific user-requested test order and one-shot Phoenix approval; no unattended Testnet orders.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Spot Testnet USDT trading pair.' },
      side: { type: 'string', required: true, enum: ['BUY', 'SELL'] },
      quoteUsdt: { type: 'number', description: 'BUY: 10–100 TESTNET USDT.' },
      quantity: { type: 'number', description: 'SELL: >0 and <=100 TESTNET asset units.' },
      requestedByUser: { type: 'boolean', required: true, description: 'Must be true only for the user specified test order.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!args.requestedByUser || exec.agent === undefined) {
        throw new Error('A specific user request and active session are required for a Testnet order')
      }
      const testnet = deps.testnet ?? new BinanceSpotTestnet()
      const status = await testnet.status()
      if (!status.connected || status.canTrade !== true) {
        throw new Error('Spot Testnet account is not authenticated with trading enabled')
      }
      const outcome = await deps.approval.request({
        agent: exec.agent,
        toolName: 'binance_testnet_order',
        callId: exec.callId,
        reason: 'Send an actual Binance Spot TESTNET market order using FAKE testing funds only. Confirm symbol, side, and quantity.',
        risk: 'high',
        reversible: false,
        signal: exec.signal,
      })
      if (outcome !== 'allowed-once') return { mode: 'testnet', status: 'denied', approvalOutcome: outcome }
      const receipt = await testnet.order({
        symbol: args.symbol, side: args.side,
        ...(args.quoteUsdt === undefined ? {} : { quoteUsdt: args.quoteUsdt }),
        ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
      })
      return { ...receipt, filled: receipt.status === 'FILLED' && Number(receipt.executedQty) > 0 }
    },
    presentCall(args) {
      return { card: 'generic', title: 'Binance TESTNET ' + args.side + ' ' + args.symbol,
        kind: 'execute', rawInput: args.quoteUsdt ?? args.quantity ?? '' }
    },
  })
}

function candlesTool(deps: BinanceTradingToolDependencies): ToolDefinition {
  return defineTool({
    name: 'binance_market_candles',
    description: 'Read real public Binance Spot OHLCV candles. Phoenix renders a native light-theme candlestick, volume and MA chart automatically from the verified tool result; do not call phoenix_visualize for an 8-candle imitation. No account credentials are used.',
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
      const dashboard = deps.automation === undefined
        ? undefined : dashboardJson(await deps.automation.dashboard())
      return {
        trade: paperTradeJson(result.trade),
        account: paperAccountJson(result.account),
        ...(dashboard === undefined ? {} : { uiBlock: {
          component: 'trading_dashboard',
          version: 1,
          props: { title: 'Phoenix Trading · Binance', ...dashboard },
        } }),
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
      watchlist: { type: 'string', required: true, description: 'Comma-separated Spot symbols, for example BTCUSDT,ETHUSDT. Maximum twelve unique USDT pairs.' },
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
        ...(deps.automation === undefined ? {} : { uiBlock: {
          component: 'trading_dashboard',
          version: 1,
          props: { title: 'Phoenix Trading · Binance',
            ...dashboardJson(await deps.automation.dashboard()) },
        } }),
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

/**
 * Project only public virtual account evidence for the in-chat viewer.
 * @param view - Host-backed PAPER scheduler and portfolio data.
 * @returns Sanitized UI-friendly JSON without credentials.
 */
export function dashboardJson(view: BinancePaperAutomationView): Record<string, JsonValue> {
  return {
    mode: 'paper', phase: view.phase, enabled: view.enabled,
    settings: { symbols: [...view.settings.symbols], interval: view.settings.interval, pollMs: view.settings.pollMs },
    ...(view.lastAttemptAt === undefined ? {} : { lastAttemptAt: view.lastAttemptAt }),
    ...(view.lastSuccessAt === undefined ? {} : { lastSuccessAt: view.lastSuccessAt }),
    ...(view.nextCheckAt === undefined ? {} : { nextCheckAt: view.nextCheckAt }),
    ...(view.lastError === undefined ? {} : { lastError: view.lastError }),
    account: paperAccountJson(view.account),
    markedAt: view.markedAt,
    recentTrades: view.recentTrades.map(paperTradeJson),
    signals: view.lastCycle?.signals.map(signal => ({
      symbol: signal.symbol, regime: signal.regime, strategy: signal.strategy,
      action: signal.action, score: signal.score, reason: signal.reason,
    })) ?? [],
    execution: view.lastCycle?.execution.map(row => ({
      symbol: row.symbol, status: row.status, explanation: row.explanation,
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
    description: 'Start, stop, or request one immediate check of REAL background PAPER trading automation, independently of ChatGPT tokens. Start requires an explicitly user-requested virtual automation and a comma-separated 1-12 pair USDT watchlist; future checks run automatically while the Host runs, and resume after restart. It never connects to real funds or bypasses Binance order confirmation. Always report genuine tradeCount from the dashboard, not a fabricated fill.',
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'stop', 'check-now'] },
      requestedByUser: { type: 'boolean', description: 'Required true to START and only when the user asked for automatic paper trading.' },
      watchlist: { type: 'string', description: 'Comma-separated 1-12 unique Spot USDT pairs; required on START.' },
      interval: { type: 'string', enum: ['15m', '1h', '4h', '1d'], description: 'Closed-candle strategy interval; default 15m.' },
      pollMinutes: { type: 'integer', description: 'How often the Host checks, 1–60 minutes; default 1.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (deps.automation === undefined) throw new Error('PAPER automation is unavailable')
      if (args.action === 'start') {
        if (args.requestedByUser !== true) throw new Error('Starting automatic paper trading requires an explicit user request')
        if (typeof args.watchlist !== 'string') throw new Error('Starting paper trading requires a watchlist')
        // A durable wake rule belongs to the explicit initiating conversation.
        // Subsequent evaluations use zero LLM tokens unless a significant
        // PAPER event arrives. No real order authority is granted.
        if (deps.wake !== undefined && exec.agent?.id !== undefined) {
          const target = exec.agent.id
          try {
            const existing = (await deps.wake.list()).some(trigger =>
              trigger.source === 'phoenix-trading' && trigger.eventType === 'paper.attention'
              && trigger.targetAgentId === target && trigger.status === 'active')
            if (!existing) await deps.wake.create({
              title: 'Kira · supervision trading PAPER',
              source: 'phoenix-trading', eventType: 'paper.attention',
              instruction: 'Review the persisted PAPER ledger, market evidence and risk. Explain verified fills, denied entries or Host failures. Only adjust virtual strategy settings if the user authorized that action. Never place a REAL exchange order from an event.',
              mode: 'act', once: false, createdBy: 'user',
              targetAgentId: target,
            })
          } catch {
            // A notification setup issue must not claim a trading failure.
          }
        }
        // Create the wake trigger before the first cycle so the first actual
        // virtual fill can be reviewed by the initiating conversation.
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

function cloudStatusTool(client: BinanceCloudPaperClient): ToolDefinition {
  return defineTool({
    name: 'binance_cloud_status',
    description: 'Read authenticated PHOENIX Cloud PAPER ledger, market universe, risk halts, and event counters. Cloud is a separate virtual portfolio from Desktop PAPER, and never implies REAL Binance access.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
    },
    async execute() {
      const value = await client.snapshot()
      if (typeof value !== 'object' || value === null
        || !('mode' in value) || value.mode !== 'paper') {
        throw new Error('Cloud provider did not return a verified PAPER account')
      }
      return { mode: 'paper', origin: 'phoenix-cloud', snapshot: value as JsonValue }
    },
    presentCall() {
      return { card: 'generic', title: 'PHOENIX Cloud · Estado PAPER', kind: 'read' }
    },
  })
}

function cloudControlTool(
  client: BinanceCloudPaperClient, wake: Pick<WakeEngine, 'create' | 'list'> | undefined,
): ToolDefinition {
  return defineTool({
    name: 'binance_cloud_control',
    description: 'Start or stop only the independent CLOUD PAPER research runner. Requires explicitly requested user control. Never touches Binance real accounts, tests or API keys; a stopped or risk-halted worker does not auto-start.',
    parameters: {
      action: { type: 'string', enum: ['start', 'stop'], required: true },
      requestedByUser: { type: 'boolean', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
    },
    async execute(args, exec) {
      if (args.requestedByUser !== true) {
        throw new Error('Cloud PAPER control requires an explicit user request')
      }
      // Bind Kira to the originating Phoenix conversation before the first
      // remote PAPER event. The Host fetches queued events after reconnect.
      if (args.action === 'start' && wake !== undefined && exec.agent?.id !== undefined) {
        const target = exec.agent.id
        const current = await wake.list()
        const registered = current.some(item => item.source === 'phoenix-trading'
          && item.eventType === 'paper.attention' && item.targetAgentId === target
          && item.status === 'active')
        if (!registered) await wake.create({
          title: 'Kira · PHOENIX Cloud PAPER',
          source: 'phoenix-trading', eventType: 'paper.attention',
          instruction: 'Review independently persisted cloud PAPER fills, protective exits and warnings. Check freshness, risk and receipt evidence. Never claim REAL Binance execution or autonomously approve provider transfers.',
          mode: 'act', once: false, createdBy: 'user', targetAgentId: target,
        })
      }
      return {
        mode: 'paper', origin: 'phoenix-cloud',
        result: await client.control(args.action) as JsonValue,
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.action === 'start' ? 'Iniciar PHOENIX Cloud PAPER' : 'Detener PHOENIX Cloud PAPER',
        kind: 'execute', rawInput: args.action,
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
    agentOsHealthTool(deps),
    testnetAccountTool(deps),
    testnetOrderTool(deps),
    candlesTool(deps),
    paperOrderTool(deps),
    paperAccountTool(deps),
    paperJournalTool(deps),
    adaptiveCycleTool(deps),
    dashboardTool(deps),
    paperAutoTool(deps),
    ...(deps.cloud === undefined ? [] : [cloudStatusTool(deps.cloud), cloudControlTool(deps.cloud, deps.wake)]),
  ]
}
