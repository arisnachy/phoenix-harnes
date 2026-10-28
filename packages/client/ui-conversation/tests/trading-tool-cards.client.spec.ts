import { describe, expect, it } from 'vitest'
import { parseTradingDashboard, tradingDashboardFromToolResult, tradingMarketFromToolResult } from '../src/client/chat/trading-tool-cards.ts'

const dashboard = {
  mode: 'paper' as const,
  phase: 'running' as const,
  enabled: true,
  settings: { symbols: ['BTCUSDT'], interval: '15m', pollMs: 60000 },
  account: {
    equityUsdt: 10200, cashUsdt: 9700, totalPnlUsdt: 200,
    totalReturnPct: 2, maxDrawdownPct: 1, tradeCount: 1,
    positions: [{ symbol: 'BTCUSDT', quantity: 5, marketValueUsdt: 500, unrealizedPnlUsdt: 200 }],
  },
  signals: [{ symbol: 'BTCUSDT', action: 'buy', strategy: 'breakout',
    regime: 'uptrend', score: 80, reason: 'Real rule evidence' }],
  recentTrades: [{ id: 'real-ledger-id', symbol: 'BTCUSDT',
    side: 'buy' as const, grossUsdt: 500, price: 100, executedAt: '2026-10-26T10:00:00Z' }],
  lastDecision: 'buy', rationale: 'Confirmed and executed in paper ledger',
}

describe('first-party trading viewer', () => {
  it('accepts settled Binance dashboard evidence and rejects arbitrary provider output', () => {
    expect(parseTradingDashboard(dashboard)?.account.tradeCount).toBe(1)
    expect(tradingDashboardFromToolResult({
      kind: 'tool-result',
      call: { name: 'binance_paper_dashboard' },
      content: [{ type: 'text', text: JSON.stringify({
        dashboard, uiBlock: { component: 'trading_dashboard', version: 1, props: dashboard },
      }) }],
      isError: false,
    })).toMatchObject({ mode: 'paper', recentTrades: [{ id: 'real-ledger-id' }] })
    expect(tradingDashboardFromToolResult({
      kind: 'tool-result', call: { name: 'non_binance_tool' },
      content: [{ type: 'text', text: JSON.stringify({ dashboard }) }],
    })).toBeUndefined()
  })

  it('validates explicit executed vs watched versus blocked signal evidence', () => {
    const withDecision = {
      ...dashboard,
      execution: [{ symbol: 'BTCUSDT', status: 'executed',
        explanation: 'Compra virtual confirmada en el ledger' }],
    }
    expect(parseTradingDashboard(withDecision)?.execution).toMatchObject([{ status: 'executed' }])
    expect(parseTradingDashboard({ ...withDecision, execution: [
      { symbol: 'BTCUSDT', status: 'unverified-real-fill', explanation: 'fake' },
    ] })).toBeUndefined()
    expect(parseTradingDashboard({ ...withDecision, execution: [
      { symbol: 'BTCUSDT', status: 'blocked', explanation: 'Capital insuficiente' },
    ] })?.execution).toMatchObject([{ status: 'blocked' }])
  })

  it('fails closed for forged real-mode dashboards and invalid financial data', () => {
    expect(parseTradingDashboard({ ...dashboard, mode: 'real' })).toBeUndefined()
    expect(parseTradingDashboard({ ...dashboard, account: { ...dashboard.account, equityUsdt: Infinity } })).toBeUndefined()
    expect(parseTradingDashboard({ ...dashboard, recentTrades: Array.from({ length: 13 }, () => dashboard.recentTrades[0]) }))
      .toBeUndefined()
    expect(tradingDashboardFromToolResult({
      kind: 'tool-result', call: { name: 'binance_paper_dashboard' },
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(dashboard) }],
    })).toBeUndefined()
  })
})

describe('Binance public OHLCV native chart', () => {
  it('opens native market chart only after first-party settled Binance candle result', () => {
    const result = {
      kind: 'tool-result', call: { name: 'binance_market_candles' },
      content: [{ type: 'text', text: JSON.stringify({
        mode: 'public-market-data', symbol: 'BTCUSDT', interval: '1h',
        candles: [{ openTime: 1, closeTime: 2, open: 100, high: 102, low: 99, close: 101, volume: 10 }],
      }) }],
    }
    expect(tradingMarketFromToolResult(result)).toEqual({ symbol: 'BTCUSDT', interval: '1h' })
    expect(tradingMarketFromToolResult({
      ...result, call: { name: 'phoenix_visualize' },
    })).toBeUndefined()
    expect(tradingMarketFromToolResult({
      ...result, content: [{ type: 'text', text: JSON.stringify({
        mode: 'public-market-data', symbol: 'BTCUSDT', interval: '1m', candles: [{}],
      }) }],
    })).toBeUndefined()
    expect(tradingMarketFromToolResult({ ...result, isError: true })).toBeUndefined()
  })
})
