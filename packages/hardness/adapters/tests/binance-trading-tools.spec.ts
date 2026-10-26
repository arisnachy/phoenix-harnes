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
    const tool = activateTool({ broker: paper as never, approval: approval, agentOs: host })

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
    const tool = activateTool({ broker: paper as never, approval: approval, agentOs: host })

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
    const tool = activateTool({ broker: paper as never, approval: approval, agentOs: host })
    const context = exec()

    await expect(tool.execute({
      mode: 'real',
      requestedByUser: true,
    }, context)).resolves.toMatchObject({
      mode: 'real',
      realTradingEnabled: false,
      mcpOperational: false,
      tradeScopeVerified: false,
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
    const tool = activateTool({ broker: broker() as never, approval: approval, agentOs: host })

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

describe('Official Binance Agentic MCP readiness and recovery', () => {
  it('does not confuse OAuth-required installation with a tradable account', async () => {
    const host = agentOs()
    const tool = createBinanceTradingTools({
      broker: broker() as never, approval: { request: vi.fn() }, agentOs: host,
    }).find(candidate => candidate.name === 'binance_mcp_health')
    if (tool === undefined) throw new Error('binance_mcp_health missing')
    const report = await tool.execute({ action: 'status' }, exec())
    expect(report).toMatchObject({
      configured: true, ready: false, toolCount: 0,
      nextAction: 'authorize-in-settings',
    })
    expect(host.enableBinanceAgentOs).not.toHaveBeenCalled()
  })

  it('counts only live discovered tools and never equates them to Trade scopes', async () => {
    const host = agentOs()
    host.binanceAgentOsState.mockResolvedValue({
      configured: true, status: 'ready',
      toolNames: ['binance_spot_ticker', 'binance_account_balances'],
    })
    const tool = createBinanceTradingTools({
      broker: broker() as never, approval: { request: vi.fn() }, agentOs: host,
    }).find(candidate => candidate.name === 'binance_mcp_health')
    if (tool === undefined) throw new Error('binance_mcp_health missing')
    expect(await tool.execute({}, exec())).toMatchObject({
      configured: true, ready: true, toolCount: 2,
      toolNames: ['binance_spot_ticker', 'binance_account_balances'],
      nextAction: 'use-live-mcp-tools',
    })
  })

  it('allows MCP repair only on explicit request and preserves user approval boundary', async () => {
    const host = {
      ...agentOs(),
      repairBinanceAgentOs: vi.fn(async () => ({ status: 'installed' as const,
        connector: { entryId: 'next', serverName: 'binance-agent-os',
          url: 'https://agent.binance.com/mcp/agentic' } })),
    }
    const tool = createBinanceTradingTools({
      broker: broker() as never, approval: { request: vi.fn() }, agentOs: host,
    }).find(candidate => candidate.name === 'binance_mcp_health')
    if (tool === undefined) throw new Error('binance_mcp_health missing')
    await expect(tool.execute({ action: 'repair' }, exec())).rejects.toThrow('explicit')
    expect(host.repairBinanceAgentOs).not.toHaveBeenCalled()
    await tool.execute({ action: 'repair', requestedByUser: true }, exec())
    expect(host.repairBinanceAgentOs).toHaveBeenCalledTimes(1)
  })
})
