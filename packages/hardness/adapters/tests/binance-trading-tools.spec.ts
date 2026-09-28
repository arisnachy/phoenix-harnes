import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import {
  createBinanceTradingTools,
  type BinanceAgentOsHostService,
} from '../src/binance-trading-tools.ts'

function exec(agent: Agent | undefined = {} as Agent) {
  return {
    agent,
    callId: 'call-binance' as never,
    rootCallId: 'call-binance' as never,
    name: 'binance_trading_activate',
    arguments: {},
    token: Symbol('tool') as never,
    signal: new AbortController().signal,
    deferContext: vi.fn(),
    concludeTurn: vi.fn(),
  } as never
}

function broker() {
  const account = {
    mode: 'paper' as const,
    initialCashUsdt: 10_000,
    cashUsdt: 10_000,
    equityUsdt: 10_000,
    realizedPnlUsdt: 0,
    unrealizedPnlUsdt: 0,
    totalPnlUsdt: 0,
    totalReturnPct: 0,
    feeRate: 0.001,
    tradeCount: 0,
    closedTradeCount: 0,
    winRatePct: null,
    profitFactor: null,
    maxDrawdownPct: 0,
    positions: [],
  }
  return {
    activate: vi.fn(async () => account),
    account: vi.fn(async () => account),
    candles: vi.fn(async () => []),
    journal: vi.fn(async () => []),
    order: vi.fn(),
  }
}

function agentOs(): BinanceAgentOsHostService & {
  enableBinanceAgentOs: ReturnType<typeof vi.fn>
  disableBinanceAgentOs: ReturnType<typeof vi.fn>
  binanceAgentOsState: ReturnType<typeof vi.fn>
} {
  return {
    enableBinanceAgentOs: vi.fn(async () => ({
      status: 'installed' as const,
      connector: {
        entryId: 'binance-live',
        serverName: 'binance-agent-os',
        url: 'https://agent.binance.com/mcp/agentic',
      },
    })),
    disableBinanceAgentOs: vi.fn(async () => ({ disabled: true })),
    binanceAgentOsState: vi.fn(async () => ({
      configured: true,
      status: 'auth-required' as const,
      reasonCode: 'authorization-required' as const,
    })),
  }
}

function activateTool(deps: Parameters<typeof createBinanceTradingTools>[0]) {
  const tool = createBinanceTradingTools(deps).find(candidate => candidate.name === 'binance_trading_activate')
  if (tool === undefined) throw new Error('binance_trading_activate missing')
  return tool
}

describe('Binance trading activation boundary', () => {
  it('enters PAPER without approval and removes an earlier managed REAL connector', async () => {
    const paper = broker()
    const host = agentOs()
    const approval = { request: vi.fn() }
    const tool = activateTool({ broker: paper as never, approval: approval as never, agentOs: host })

    await expect(tool.execute({ mode: 'paper' }, exec())).resolves.toMatchObject({
      mode: 'paper',
      realTradingEnabled: false,
      account: { equityUsdt: 10_000 },
    })
    expect(host.disableBinanceAgentOs).toHaveBeenCalledTimes(1)
    expect(paper.activate).toHaveBeenCalledWith({ reset: false })
    expect(approval.request).not.toHaveBeenCalled()
    expect(host.enableBinanceAgentOs).not.toHaveBeenCalled()
  })

  it('cannot enable REAL without an explicit user request flag', async () => {
    const paper = broker()
    const host = agentOs()
    const approval = { request: vi.fn() }
    const tool = activateTool({ broker: paper as never, approval: approval as never, agentOs: host })

    await expect(tool.execute({ mode: 'real' }, exec())).resolves.toMatchObject({
      mode: 'paper',
      realTradingEnabled: false,
      status: 'denied',
    })
    expect(approval.request).not.toHaveBeenCalled()
    expect(host.enableBinanceAgentOs).not.toHaveBeenCalled()
  })

  it('asks high-risk approval before installing the pinned REAL connector', async () => {
    const paper = broker()
    const host = agentOs()
    const approval = { request: vi.fn(async () => 'allowed-once' as const) }
    const tool = activateTool({ broker: paper as never, approval: approval as never, agentOs: host })
    const context = exec()

    await expect(tool.execute({
      mode: 'real',
      requestedByUser: true,
    }, context)).resolves.toMatchObject({
      mode: 'real',
      realTradingEnabled: true,
      status: 'installed',
      connector: {
        serverName: 'binance-agent-os',
        url: 'https://agent.binance.com/mcp/agentic',
      },
      connectorState: {
        configured: true,
        status: 'auth-required',
      },
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      agent: (context as { agent: Agent }).agent,
      toolName: 'binance_trading_activate',
      callId: 'call-binance',
      risk: 'high',
      reversible: true,
      signal: expect.any(AbortSignal),
    }))
    expect(host.enableBinanceAgentOs).toHaveBeenCalledTimes(1)
  })

  it('stays out of REAL when approval is rejected', async () => {
    const host = agentOs()
    const approval = { request: vi.fn(async () => 'rejected' as const) }
    const tool = activateTool({ broker: broker() as never, approval: approval as never, agentOs: host })

    await expect(tool.execute({
      mode: 'real',
      requestedByUser: true,
    }, exec())).resolves.toMatchObject({
      mode: 'paper',
      realTradingEnabled: false,
      status: 'denied',
      approvalOutcome: 'rejected',
    })
    expect(host.enableBinanceAgentOs).not.toHaveBeenCalled()
  })
})
