import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BinancePaperBroker,
  type BinanceCandle,
  type BinancePublicMarket,
} from '../src/binance-paper.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function ledger(): string {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-binance-paper-'))
  roots.push(root)
  return join(root, 'paper.json')
}

function market(startPrice = 100): BinancePublicMarket & { setPrice(value: number): void } {
  let price = startPrice
  return {
    setPrice(value: number) { price = value },
    async price() { return price },
    async prices(symbols) { return Object.fromEntries(symbols.map(symbol => [symbol, price])) },
    async candles(_symbol, _interval, limit): Promise<BinanceCandle[]> {
      return Array.from({ length: limit }, (_, index) => ({
        openTime: index * 60_000,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
        closeTime: index * 60_000 + 59_999,
        quoteVolume: price,
        trades: 1,
      }))
    },
  }
}

describe('BinancePaperBroker', () => {
  it('starts isolated paper capital and persists a fee-aware buy/sell lifecycle', async () => {
    const feed = market(100)
    const path = ledger()
    const broker = new BinancePaperBroker(path, feed)

    const started = await broker.activate({ initialCashUsdt: 1_000, reset: true })
    expect(started).toMatchObject({
      mode: 'paper',
      initialCashUsdt: 1_000,
      cashUsdt: 1_000,
      equityUsdt: 1_000,
      tradeCount: 0,
    })

    const bought = await broker.order({
      symbol: 'BTCUSDT',
      side: 'buy',
      quoteAmountUsdt: 500,
      strategyId: 'trend-v1',
      reason: 'test entry',
    })
    expect(bought.trade).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'buy',
      quantity: 5,
      grossUsdt: 500,
      feeUsdt: 0.5,
      strategyId: 'trend-v1',
    })
    expect(bought.account.cashUsdt).toBe(499.5)

    feed.setPrice(120)
    const marked = await broker.account()
    expect(marked.equityUsdt).toBe(1_099.5)
    expect(marked.unrealizedPnlUsdt).toBe(99.5)

    const sold = await broker.order({
      symbol: 'BTCUSDT',
      side: 'sell',
      quantity: 5,
      strategyId: 'trend-v1',
      reason: 'test exit',
    })
    expect(sold.trade.realizedPnlUsdt).toBe(98.9)
    expect(sold.account).toMatchObject({
      positions: [],
      cashUsdt: 1_098.9,
      equityUsdt: 1_098.9,
      realizedPnlUsdt: 98.9,
      closedTradeCount: 1,
      winRatePct: 100,
    })

    const resumed = new BinancePaperBroker(path, feed)
    await expect(resumed.journal()).resolves.toHaveLength(2)
    await expect(resumed.account()).resolves.toMatchObject({ equityUsdt: 1_098.9 })
  })

  it('fails closed on overselling and never creates a short paper position', async () => {
    const broker = new BinancePaperBroker(ledger(), market())
    await broker.activate({ initialCashUsdt: 1_000, reset: true })
    await expect(broker.order({
      symbol: 'BTCUSDT',
      side: 'sell',
      quantity: 1,
    })).rejects.toThrow('exceeds the virtual BTCUSDT position')
  })

  it('rejects ambiguous BUY sizing and caps candle requests at the public API limit', async () => {
    const feed = market()
    const broker = new BinancePaperBroker(ledger(), feed)
    await expect(broker.order({
      symbol: 'BTCUSDT',
      side: 'buy',
      quantity: 1,
      quoteAmountUsdt: 100,
    })).rejects.toThrow('requires exactly one')
    await expect(broker.candles('BTCUSDT', '1h', 10_000)).resolves.toHaveLength(1_000)
  })

  it.each([[0, 1], [1, 1], [2.9, 2], [1000, 1000], [10000, 1000]])(
    'bounds the complete candle result for request %s to %s',
    async (requested, expected) => {
      const feed = market()
      const calls: number[] = []
      feed.candles = async (_symbol, _interval, limit) => {
        calls.push(limit)
        return Array.from({ length: limit + 1 }, (_, index) => ({
          openTime: index, open: 1, high: 1, low: 1, close: 1, volume: 1,
          closeTime: index + 1, quoteVolume: 1, trades: 1,
        }))
      }
      const broker = new BinancePaperBroker(ledger(), feed)
      await expect(broker.candles('BTCUSDT', '1h', requested)).resolves.toHaveLength(expected)
      expect(calls).toEqual([expected])
    },
  )
})
