import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BinancePaperBroker, type BinanceCandle, type BinancePublicMarket } from '../src/binance-paper.ts'
import { evaluateBinanceAdaptiveSignal, runBinanceAdaptiveCycle } from '../src/binance-adaptive.ts'

const HOUR = 3_600_000
const NOW = 80 * HOUR
const temporary: string[] = []

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

function candles(strategy: 'breakout' | 'pullback' | 'downtrend' | 'flat' = 'breakout'): BinanceCandle[] {
  return Array.from({ length: 80 }, (_, index) => {
    const close = strategy === 'downtrend' ? 150 - index * 0.5
      : strategy === 'flat' ? 100
        : strategy === 'pullback' ? 100 + index * 0.2
          : 100 + index * 0.5 + (index === 79 ? 2 : 0)
    return {
      openTime: index * HOUR,
      closeTime: (index + 1) * HOUR - 1,
      open: close, high: close * 1.005, low: close * 0.995, close,
      volume: strategy === 'breakout' && index === 79 ? 20 : 10,
      quoteVolume: close * 10, trades: 100,
    }
  })
}

function market(kinds: Record<string, 'breakout' | 'pullback' | 'downtrend' | 'flat'>): BinancePublicMarket {
  return {
    async price(symbol) { return kinds[symbol] === 'downtrend' ? 90 : 100 },
    async prices(symbols) {
      return Object.fromEntries(symbols.map(symbol => [symbol, kinds[symbol] === 'downtrend' ? 90 : 100]))
    },
    async candles(symbol) { return candles(kinds[symbol] ?? 'flat') },
  }
}

function broker(kinds: Record<string, 'breakout' | 'pullback' | 'downtrend' | 'flat'>): BinancePaperBroker {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-adaptive-'))
  temporary.push(root)
  return new BinancePaperBroker(join(root, 'paper.json'), market(kinds))
}

describe('adaptive Binance strategy selection', () => {
  it('recognizes closed-volume breakout with a reproducible score', () => {
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', candles(), HOUR, NOW)).toMatchObject({
      regime: 'uptrend', strategy: 'breakout', action: 'buy', score: 80,
    })
  })

  it('identifies a positive-trend pullback without breakout volume', () => {
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', candles('pullback'), HOUR, NOW)).toMatchObject({
      regime: 'uptrend', strategy: 'trend-pullback', action: 'buy',
    })
  })

  it('identifies a bearish regime as a defensive sell, not an automatic short', () => {
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', candles('downtrend'), HOUR, NOW)).toMatchObject({
      regime: 'downtrend', strategy: 'defensive-exit', action: 'sell',
    })
  })

  it('holds a flat market instead of inventing a signal', () => {
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', candles('flat'), HOUR, NOW)).toMatchObject({
      regime: 'range', action: 'hold', score: 0,
    })
  })

  it('rejects stale, malformed, unclosed, and insufficient market data', () => {
    const history = candles()
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', history, HOUR, NOW + HOUR * 3).reason).toBe('Stale market data')
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', history.slice(0, 12), HOUR, NOW).action).toBe('hold')
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', history, HOUR, NOW - HOUR * 60).reason)
      .toBe('No sufficient closed candles')
    const reversed = [...history]
    reversed[20] = { ...reversed[20]!, closeTime: reversed[19]!.closeTime }
    expect(evaluateBinanceAdaptiveSignal('BTCUSDT', reversed, HOUR, NOW).reason)
      .toBe('Invalid or out-of-order market candles')
  })
})

describe('adaptive Binance paper cycle', () => {
  it('provides a ranked read-only scan without an order', async () => {
    const paper = broker({ BTCUSDT: 'breakout', ETHUSDT: 'flat' })
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'scan', symbols: ['BTCUSDT', 'ETHUSDT'],
    }, NOW)
    expect(result).toMatchObject({ mode: 'scan', decision: 'hold' })
    expect(result.signals[0]).toMatchObject({ symbol: 'BTCUSDT', action: 'buy' })
    expect(result.signals).toHaveLength(2)
    expect(result.trade).toBeUndefined()
    expect(result.account.tradeCount).toBe(0)
  })

  it('chooses one winning-ranked candidate but only places a small virtual order', async () => {
    const paper = broker({ BTCUSDT: 'breakout', ETHUSDT: 'pullback' })
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['ETHUSDT', 'BTCUSDT'],
    }, NOW)
    expect(result.decision).toBe('buy')
    expect(result.trade).toMatchObject({
      symbol: 'BTCUSDT', side: 'buy', grossUsdt: 500,
      strategyId: 'adaptive-breakout-v1',
    })
    expect(result.account.cashUsdt).toBe(9499.5)
    expect(result.account.positions).toHaveLength(1)
    expect(result.account.tradeCount).toBe(1)
  })

  it('holds after both virtual portfolio slots are occupied', async () => {
    const paper = broker({ BTCUSDT: 'breakout', ETHUSDT: 'breakout', SOLUSDT: 'breakout' })
    await paper.order({ symbol: 'BTCUSDT', side: 'buy', quoteAmountUsdt: 100 })
    await paper.order({ symbol: 'ETHUSDT', side: 'buy', quoteAmountUsdt: 100 })
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['SOLUSDT'],
    }, NOW)
    expect(result.decision).toBe('hold')
    expect(result.account.tradeCount).toBe(2)
  })

  it('prioritizes defensive liquidation of an existing virtual position', async () => {
    const paper = broker({ BTCUSDT: 'downtrend', ETHUSDT: 'breakout' })
    await paper.order({ symbol: 'BTCUSDT', side: 'buy', quoteAmountUsdt: 100 })
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['ETHUSDT', 'BTCUSDT'],
    }, NOW)
    expect(result.decision).toBe('sell')
    expect(result.trade).toMatchObject({ symbol: 'BTCUSDT', side: 'sell' })
    expect(result.account.positions).toHaveLength(0)
  })

  it('scans twelve assets and isolates unavailable pairs without fabricating entries', async () => {
    const names = [
      'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT',
      'DOGEUSDT','LINKUSDT','AVAXUSDT','TRXUSDT','DOTUSDT','LTCUSDT',
    ]
    const feed = market(Object.fromEntries(names.map(symbol => [symbol, 'flat' as const])))
    const original = feed.candles.bind(feed)
    const brokenFeed: BinancePublicMarket = {
      price: feed.price.bind(feed), prices: feed.prices.bind(feed),
      async candles(symbol, interval, limit) {
        if (symbol === 'DOGEUSDT') throw new Error('temporary provider outage')
        return original(symbol, interval, limit)
      },
    }
    const paper = new BinancePaperBroker(
      join(mkdtempSync(join(tmpdir(), 'phoenix-twelve-pairs-')), 'paper.json'),
      brokenFeed,
    )
    const result = await runBinanceAdaptiveCycle(paper, { mode: 'scan', symbols: names }, NOW)
    expect(result.signals).toHaveLength(12)
    expect(result.signals.find(row => row.symbol === 'DOGEUSDT')).toMatchObject({
      action: 'hold', score: 0,
    })
    expect(result.trade).toBeUndefined()
  })

  it('rejects broad, duplicate, and non-USDT watchlists before fetching markets', async () => {
    const paper = broker({})
    await expect(runBinanceAdaptiveCycle(paper, { symbols: [] }, NOW)).rejects.toThrow('between 1 and 12')
    await expect(runBinanceAdaptiveCycle(paper, { symbols: ['BTCUSDT', 'BTCUSDT'] }, NOW))
      .rejects.toThrow('unique Spot USDT')
    await expect(runBinanceAdaptiveCycle(paper, { symbols: ['BTCBTC'] }, NOW))
      .rejects.toThrow('unique Spot USDT')
    await expect(runBinanceAdaptiveCycle(paper, { symbols: ['BTCUSDT'], interval: '1m' as never }, NOW))
      .rejects.toThrow('Unsupported Binance adaptive interval')
  })
})
