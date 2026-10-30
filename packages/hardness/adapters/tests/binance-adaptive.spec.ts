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
  it('does not misclassify a moderate 15-minute uptrend as sideways', () => {
    const QUARTER_HOUR = 900_000
    const bars = candles('flat').map((bar, index) => {
      const close = 100 + index * 0.045
      return { ...bar,
        openTime: index * QUARTER_HOUR, closeTime: (index + 1) * QUARTER_HOUR - 1,
        open: close, high: close * 1.005, low: close * 0.995, close,
        volume: index === 79 ? 12 : 10 }
    })
    expect(evaluateBinanceAdaptiveSignal('SOLUSDT', bars,
      QUARTER_HOUR, 80 * QUARTER_HOUR)).toMatchObject({
      regime: 'uptrend', strategy: 'trend-pullback', action: 'buy', score: 75,
    })
  })

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

  it('promotes a recovered uptrend only when candle volume confirms the recovery', () => {
    const weak = candles('pullback')
    const low = evaluateBinanceAdaptiveSignal('BTCUSDT', weak, HOUR, NOW)
    expect(low).toMatchObject({ strategy: 'trend-pullback', action: 'buy', score: 65 })
    const confirmed = candles('pullback')
    confirmed[79] = { ...confirmed[79]!, volume: 12 }
    const high = evaluateBinanceAdaptiveSignal('BTCUSDT', confirmed, HOUR, NOW)
    expect(high).toMatchObject({ strategy: 'trend-pullback', action: 'buy' })
    expect(high.score).toBeGreaterThanOrEqual(75)
  })

  it('detects confirmed trend momentum without falsely requiring a breakout volume spike', () => {
    const bars = candles('pullback')
    const close = bars[79]!.close * 1.02
    bars[79] = { ...bars[79]!, open: close, close,
      high: close * 1.005, low: close * 0.995, volume: 10.8 }
    expect(evaluateBinanceAdaptiveSignal('LTCUSDT', bars, HOUR, NOW)).toMatchObject({
      strategy: 'momentum-continuation', action: 'buy', score: 75,
    })
  })

  it('records a confirmed volume-backed virtual entry rather than showing BUY without filling', async () => {
    const feed = market({ LTCUSDT: 'pullback' })
    const original = feed.candles.bind(feed)
    const boosted: BinancePublicMarket = {
      price: feed.price.bind(feed), prices: feed.prices.bind(feed),
      async candles(symbol, interval, limit) {
        const bars = await original(symbol, interval, limit)
        bars[79] = { ...bars[79]!, volume: 12 }
        return bars
      },
    }
    const root = mkdtempSync(join(tmpdir(), 'phoenix-recovery-fill-'))
    temporary.push(root)
    const paper = new BinancePaperBroker(join(root, 'paper.json'), boosted)
    const cycle = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['LTCUSDT'],
    }, NOW)
    expect(cycle.trade).toMatchObject({
      symbol: 'LTCUSDT', side: 'buy', strategyId: 'adaptive-trend-pullback-v1',
    })
    expect(cycle.execution).toContainEqual(expect.objectContaining({
      symbol: 'LTCUSDT', status: 'executed',
    }))
    expect((await paper.journal()).map(row => row.id)).toContain(cycle.trade!.id)
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

  it('tries the next ranked qualified market when Binance marks the first Spot pair ineligible', async () => {
    const feed = market({ BTCUSDT: 'breakout', LTCUSDT: 'breakout' })
    const guarded: BinancePublicMarket = {
      price: feed.price.bind(feed), prices: feed.prices.bind(feed),
      candles: feed.candles.bind(feed),
      async eligible(symbol) { return symbol !== 'BTCUSDT' },
    }
    const root = mkdtempSync(join(tmpdir(), 'phoenix-spot-fallback-'))
    temporary.push(root)
    const paper = new BinancePaperBroker(join(root, 'paper.json'), guarded)
    const cycle = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['BTCUSDT', 'LTCUSDT'],
    }, NOW)
    expect(cycle.trade).toMatchObject({ symbol: 'LTCUSDT', side: 'buy' })
    expect(cycle.execution.find(item => item.symbol === 'BTCUSDT'))
      .toMatchObject({ status: 'blocked' })
    expect(cycle.execution.find(item => item.symbol === 'LTCUSDT'))
      .toMatchObject({ status: 'executed' })
    expect((await paper.journal()).map(row => row.symbol)).toEqual(['LTCUSDT'])
  })

  it('does not confuse a weak BUY indicator with an autonomous PAPER fill', async () => {
    const paper = broker({ ETHUSDT: 'pullback' })
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['ETHUSDT'],
    }, NOW)
    expect(result.signals[0]).toMatchObject({ action: 'buy', score: 65 })
    expect(result.execution[0]).toMatchObject({
      symbol: 'ETHUSDT', status: 'watch',
    })
    expect(result.execution[0]?.explanation).toContain('75/100')
    expect(result.decision).toBe('hold')
    expect(result.trade).toBeUndefined()
    expect(result.account.tradeCount).toBe(0)
  })

  it('automatically buys the qualifying signal and returns a real PAPER fill receipt', async () => {
    const paper = broker({ LTCUSDT: 'breakout', DOTUSDT: 'pullback' })
    const cycle = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['DOTUSDT', 'LTCUSDT'],
    }, NOW)
    expect(cycle.decision).toBe('buy')
    expect(cycle.execution.find(row => row.symbol === 'LTCUSDT')).toMatchObject({
      status: 'executed', explanation: 'Compra virtual confirmada en el ledger',
    })
    expect(cycle.execution.find(row => row.symbol === 'DOTUSDT')).toMatchObject({ status: 'watch' })
    expect(cycle.trade).toMatchObject({ symbol: 'LTCUSDT', side: 'buy' })
    expect((await paper.journal()).at(-1)?.id).toBe(cycle.trade?.id)
  })

  it('blocks a fifth simultaneous PAPER position without weakening the 20% exposure fence', async () => {
    const kinds = { BTCUSDT: 'breakout', ETHUSDT: 'breakout', SOLUSDT: 'breakout',
      BNBUSDT: 'breakout', XRPUSDT: 'breakout' } as const
    const paper = broker(kinds)
    for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']) {
      await paper.order({ symbol, side: 'buy', quoteAmountUsdt: 100 })
    }
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['XRPUSDT'],
    }, NOW)
    expect(result.execution[0]).toMatchObject({ status: 'blocked' })
    expect(result.execution[0]?.explanation).toContain('4 posiciones simultáneas')
    expect(result.rationale).toContain('posiciones abiertas')
    expect(result.trade).toBeUndefined()
    expect(result.account.tradeCount).toBe(4)
  })

  it('confirms four distinct autonomous PAPER entries across cycles under one portfolio limit', async () => {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
    const paper = broker(Object.fromEntries(symbols.map(symbol => [symbol, 'breakout'])))
    for (const symbol of symbols) {
      const cycle = await runBinanceAdaptiveCycle(paper, { mode: 'paper-step',
        symbols: [symbol] }, NOW)
      expect(cycle.trade).toMatchObject({ symbol, side: 'buy',
        strategyId: 'adaptive-breakout-v1' })
    }
    const account = await paper.account()
    expect(account.tradeCount).toBe(4)
    expect(account.positions).toHaveLength(4)
    const exposure = account.positions.reduce((sum, position) => sum + position.marketValueUsdt, 0)
    expect(exposure).toBeLessThanOrEqual(account.equityUsdt * 0.20 + 0.02)
    expect((await paper.journal()).map(trade => trade.symbol)).toEqual(symbols)
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

  it('scans public candles concurrently without exceeding four Binance requests', async () => {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
      'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LTCUSDT']
    const underlying = market(Object.fromEntries(symbols.map(symbol => [symbol, 'flat' as const])))
    let active = 0
    let peak = 0
    const feed: BinancePublicMarket = {
      price: underlying.price.bind(underlying),
      prices: underlying.prices.bind(underlying),
      async candles(symbol, interval, limit) {
        active += 1
        peak = Math.max(peak, active)
        try {
          await Promise.resolve()
          return await underlying.candles(symbol, interval, limit)
        } finally {
          active -= 1
        }
      },
    }
    const paper = new BinancePaperBroker(
      join(mkdtempSync(join(tmpdir(), 'phoenix-bounded-scan-')), 'paper.json'),
      feed,
    )
    const result = await runBinanceAdaptiveCycle(paper, { mode: 'scan', symbols }, NOW)
    expect(peak).toBe(4)
    expect(result.signals).toHaveLength(symbols.length)
    expect(result.trade).toBeUndefined()
    expect(result.account.tradeCount).toBe(0)
  })

  it('persists TP1 partial execution exactly once and exits remaining units at TP2', async () => {
    const base = market({ BTCUSDT: 'flat' })
    let quote = 100
    const feed: BinancePublicMarket = {
      async price() { return quote },
      async prices(symbols) { return Object.fromEntries(symbols.map(symbol => [symbol, quote])) },
      candles: base.candles.bind(base),
    }
    const root = mkdtempSync(join(tmpdir(), 'phoenix-paper-exit-'))
    temporary.push(root)
    const paper = new BinancePaperBroker(join(root, 'paper.json'), feed)
    const first = await paper.order({
      symbol: 'BTCUSDT', side: 'buy', quoteAmountUsdt: 100,
      strategyId: 'adaptive-mean-reversion-v1',
    })
    expect(first.account.positions[0]?.exitPlan).toMatchObject({
      strategyId: 'adaptive-mean-reversion-v1',
      stopLossPrice: 98.6, tp1Price: 101.2, tp2Price: 102.5,
      tp1Taken: false, origin: 'execution',
    })
    quote = 101.3
    const tp1 = await runBinanceAdaptiveCycle(paper,
      { mode: 'paper-step', symbols: ['BTCUSDT'] }, NOW)
    expect(tp1.trade).toMatchObject({ side: 'sell', reason: 'paper-tp1' })
    expect(tp1.trade?.quantity).toBe(0.5)
    expect(tp1.account.positions[0]?.exitPlan?.tp1Taken).toBe(true)
    const holdAfterTp1 = await runBinanceAdaptiveCycle(paper,
      { mode: 'paper-step', symbols: ['BTCUSDT'] }, NOW)
    expect(holdAfterTp1.trade).toBeUndefined()
    expect((await paper.account()).tradeCount).toBe(2)
    quote = 102.6
    const tp2 = await runBinanceAdaptiveCycle(paper,
      { mode: 'paper-step', symbols: ['BTCUSDT'] }, NOW)
    expect(tp2.trade).toMatchObject({ side: 'sell', reason: 'paper-tp2', quantity: 0.5 })
    expect(tp2.account.positions).toHaveLength(0)
    expect((await paper.journal()).map(row => row.reason)).toEqual([
      undefined, 'paper-tp1', 'paper-tp2',
    ])
  })

  it('services a marked stop before requesting candles for any unrelated entry symbol', async () => {
    let mark = 100
    let candleCalls = 0
    const feed: BinancePublicMarket = {
      async price() { return mark },
      async prices(symbols) { return Object.fromEntries(symbols.map(symbol => [symbol, mark])) },
      async candles() { candleCalls++; throw new Error('Market candle provider unavailable') },
    }
    const root = mkdtempSync(join(tmpdir(), 'phoenix-priority-risk-'))
    temporary.push(root)
    const paper = new BinancePaperBroker(join(root, 'paper.json'), feed)
    await paper.order({ symbol: 'BTCUSDT', side: 'buy', quoteAmountUsdt: 100,
      strategyId: 'adaptive-breakout-v1' })
    mark = 97
    const result = await runBinanceAdaptiveCycle(paper, {
      mode: 'paper-step', symbols: ['ETHUSDT'],
    }, NOW)
    expect(result.trade).toMatchObject({ symbol: 'BTCUSDT', side: 'sell', reason: 'paper-stop-loss' })
    expect(result.account.positions).toHaveLength(0)
    expect(candleCalls).toBe(0)
    expect((await paper.journal()).map(row => row.side)).toEqual(['buy', 'sell'])
  })

  it('exits legacy positions on a marked stop even if excluded from the watchlist', async () => {
    const base = market({ ETHUSDT: 'flat', BTCUSDT: 'flat' })
    let quote = 100
    const feed: BinancePublicMarket = {
      async price() { return quote },
      async prices(symbols) { return Object.fromEntries(symbols.map(symbol => [symbol, quote])) },
      candles: base.candles.bind(base),
    }
    const root = mkdtempSync(join(tmpdir(), 'phoenix-paper-stop-'))
    temporary.push(root)
    const paper = new BinancePaperBroker(join(root, 'paper.json'), feed)
    await paper.order({ symbol: 'ETHUSDT', side: 'buy', quoteAmountUsdt: 100,
      strategyId: 'adaptive-breakout-v1' })
    quote = 97
    const exit = await runBinanceAdaptiveCycle(paper,
      { mode: 'paper-step', symbols: ['BTCUSDT'] }, NOW)
    expect(exit.trade).toMatchObject({ side: 'sell', symbol: 'ETHUSDT', reason: 'paper-stop-loss' })
    expect(exit.account.positions).toHaveLength(0)
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
