import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BinancePaperBroker, type BinancePublicMarket, type BinanceCandle } from '../src/binance-paper.ts'
import { BinancePaperAutomation } from '../src/binance-paper-automation.ts'
import { mountBinancePaperDashboardRoute } from '../src/binance-paper-route.ts'

const roots: string[] = []
const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function market(): BinancePublicMarket {
  return {
    async price() { return 100 },
    async prices(symbols) { return Object.fromEntries(symbols.map(s => [s, 100])) },
    async candles(): Promise<BinanceCandle[]> {
      const end = Date.now() - 1
      return Array.from({ length: 80 }, (_, index) => {
        const close = 100 + index * .5 + (index === 79 ? 3 : 0)
        const closeTime = end - (79 - index) * 900_000
        return {
          openTime: closeTime - 899_999, closeTime,
          open: close, high: close * 1.001, low: close * .999, close,
          volume: index === 79 ? 30 : 10, quoteVolume: close * 10, trades: 100,
        }
      })
    },
  }
}

async function serverWithTrading() {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-trading-route-'))
  roots.push(root)
  const engine = new BinancePaperAutomation(
    new BinancePaperBroker(join(root, 'paper.json'), market()),
    join(root, 'paper.auto.json'),
  )
  let handle: ((req: IncomingMessage, res: ServerResponse) => Promise<void> | void) | undefined
  const disposeRoute = mountBinancePaperDashboardRoute({
    register(input) { handle = input.handler; return () => { handle = undefined } },
  }, engine)
  const server = createServer((req, res) => {
    if (handle === undefined) { res.writeHead(404).end(); return }
    void Promise.resolve(handle(req, res)).catch(() => { res.writeHead(503).end() })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No listening HTTP server')
  const origin = `http://127.0.0.1:${address.port}`
  disposers.push(async () => {
    disposeRoute()
    await engine.dispose()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
  })
  return { engine, origin }
}

describe('Binance chat viewer HTTP integration', () => {
  it('reads only PAPER state and starts/stops real virtual fills from same-origin click', async () => {
    const { engine, origin } = await serverWithTrading()
    const endpoint = origin + '/phoenix-trading/paper/'
    const first = await fetch(endpoint + 'dashboard')
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ mode: 'paper', enabled: false })
    const start = await fetch(endpoint + 'control', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ action: 'start', symbols: ['BTCUSDT'], interval: '15m', pollMinutes: 1 }),
    })
    expect(start.status).toBe(200)
    await engine.step()
    const current = await fetch(endpoint + 'dashboard')
    expect(await current.json()).toMatchObject({
      mode: 'paper', enabled: true, account: { tradeCount: 1 },
      recentTrades: [{ symbol: 'BTCUSDT', side: 'buy' }],
    })
    const stop = await fetch(endpoint + 'control', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    })
    expect(stop.status).toBe(200)
    expect(await stop.json()).toMatchObject({ enabled: false })
  })

  it('rejects CSRF and REAL fields before any account action', async () => {
    const { engine, origin } = await serverWithTrading()
    const url = origin + '/phoenix-trading/paper/control'
    const rejected = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', symbols: ['BTCUSDT'] }),
    })
    expect(rejected.status).toBe(403)
    const real = await fetch(url, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', symbols: ['BTCUSDT'], mode: 'real' }),
    })
    expect(real.status).toBe(400)
    expect((await engine.dashboard()).enabled).toBe(false)
    const unsafe = await fetch(url, {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', symbols: ['BTCUSDT'] }),
    })
    expect(unsafe.status).toBe(403)
  })
})
