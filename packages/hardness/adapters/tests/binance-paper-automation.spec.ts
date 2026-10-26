import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BinancePaperBroker, type BinancePublicMarket, type BinanceCandle } from '../src/binance-paper.ts'
import { BinancePaperAutomation, binancePaperAutomationConfig } from '../src/binance-paper-automation.ts'

const folders: string[] = []
const workers: BinancePaperAutomation[] = []

afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.dispose()))
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function breakoutHistory(): BinanceCandle[] {
  const now = Date.now()
  const bar = 15 * 60_000
  return Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index * 0.5 + (index === 79 ? 3 : 0)
    const closeTime = now - 1 - (79 - index) * bar
    return {
      openTime: closeTime - bar + 1,
      closeTime,
      close, open: close, high: close * 1.001, low: close * 0.999,
      volume: index === 79 ? 30 : 10, quoteVolume: close * 10, trades: 100,
    }
  })
}

function setup(market?: BinancePublicMarket) {
  const folder = mkdtempSync(join(tmpdir(), 'phoenix-paper-auto-'))
  folders.push(folder)
  const feed: BinancePublicMarket = market ?? {
    async price() { return 100 },
    async prices(symbols) { return Object.fromEntries(symbols.map(symbol => [symbol, 100])) },
    async candles() { return breakoutHistory() },
  }
  const paper = new BinancePaperBroker(join(folder, 'ledger.json'), feed)
  const settings = join(folder, 'auto.json')
  const worker = new BinancePaperAutomation(paper, settings)
  workers.push(worker)
  return { paper, settings, worker, feed }
}

describe('Binance Host PAPER automation', () => {
  it('runs a confirmed virtual trade immediately without a second model invocation', async () => {
    const { worker, paper } = setup()
    await worker.start({ symbols: ['BTCUSDT'], interval: '15m', pollMs: 60_000 })
    await worker.step()
    const account = await paper.account()
    expect(account.tradeCount).toBe(1)
    expect(account.positions).toHaveLength(1)
    const dashboard = await worker.dashboard()
    expect(dashboard).toMatchObject({
      mode: 'paper', phase: 'running', enabled: true,
      lastCycle: { decision: 'buy', trade: { symbol: 'BTCUSDT', side: 'buy' } },
    })
    expect(dashboard.recentTrades).toHaveLength(1)
    await worker.stop()
    expect((await worker.dashboard()).enabled).toBe(false)
  })

  it('prevents duplicate concurrent virtual entries', async () => {
    const { worker, paper } = setup()
    await worker.start({ symbols: ['BTCUSDT'] })
    await Promise.all([worker.step(), worker.step(), worker.step()])
    expect((await paper.account()).tradeCount).toBe(1)
  })

  it('restores explicit saved PAPER enablement but never real-account authority', async () => {
    const { worker, paper, settings } = setup()
    await worker.start({ symbols: ['BTCUSDT'], pollMs: 60_000 })
    await worker.step()
    await worker.dispose()
    const replacement = new BinancePaperAutomation(paper, settings)
    workers.push(replacement)
    await replacement.restore()
    await replacement.step()
    expect((await replacement.dashboard()).enabled).toBe(true)
    expect((await replacement.dashboard()).mode).toBe('paper')
    expect((await paper.account()).tradeCount).toBe(1)
    await replacement.stop()
    const stopped = new BinancePaperAutomation(paper, settings)
    workers.push(stopped)
    await stopped.restore()
    expect((await stopped.dashboard()).phase).toBe('stopped')
  })

  it('fails closed after repeated public market errors and does not fabricate trades', async () => {
    const feed: BinancePublicMarket = {
      async price() { throw new Error('network down') },
      async prices() { return {} },
      async candles() { throw new Error('network down') },
    }
    const { worker, paper } = setup(feed)
    await worker.start({ symbols: ['BTCUSDT'] })
    for (let index = 0; index < 3; index++) await worker.step()
    const data = await worker.dashboard()
    expect(data.enabled).toBe(false)
    expect(data.phase).toBe('error')
    expect((await paper.account()).tradeCount).toBe(0)
  })

  it('rejects invalid cadence and watchlists before scheduling', () => {
    expect(() => binancePaperAutomationConfig({ symbols: [] })).toThrow('1-5')
    expect(() => binancePaperAutomationConfig({ symbols: ['BTCUSDT','BTCUSDT'] })).toThrow('unique')
    expect(() => binancePaperAutomationConfig({ symbols: ['BTCUSDT'], pollMs: 200 })).toThrow('60,000')
  })
})
