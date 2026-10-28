import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BinancePaperBroker, type BinancePublicMarket, type BinanceCandle } from '../src/binance-paper.ts'
import { BinancePaperAutomation } from '../src/binance-paper-automation.ts'
import { mountBinancePaperDashboardRoute } from '../src/binance-paper-route.ts'
import { BinanceSpotTestnet } from '../src/binance-spot-testnet.ts'

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

async function serverWithTrading(options: Parameters<typeof mountBinancePaperDashboardRoute>[2] = {}) {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-trading-route-'))
  roots.push(root)
  const engine = new BinancePaperAutomation(
    new BinancePaperBroker(join(root, 'paper.json'), market()),
    join(root, 'paper.auto.json'),
  )
  let handle: ((req: IncomingMessage, res: ServerResponse) => Promise<void> | void) | undefined
  const disposeRoute = mountBinancePaperDashboardRoute({
    register(input) { handle = input.handler; return () => { handle = undefined } },
  }, engine, options)
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
    // HTTP acknowledgement must contain the completed initial scan, not a
    // 'running' state that hides a pending first execution.
    expect(await start.json()).toMatchObject({
      mode: 'paper', enabled: true, account: { tradeCount: 1 },
      recentTrades: [{ symbol: 'BTCUSDT', side: 'buy' }],
    })
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

  it('serves real-source market candles without exposing an account or accepting unsafe queries', async () => {
    const { origin } = await serverWithTrading()
    const path = origin + '/phoenix-trading/paper/candles'
    const result = await fetch(path + '?symbol=BTCUSDT&interval=1h')
    expect(result.status).toBe(200)
    const payload = await result.json()
    expect(payload).toMatchObject({ source: 'binance-spot-public', symbol: 'BTCUSDT', interval: '1h' })
    expect(payload.candles).toHaveLength(80)
    expect(payload).not.toHaveProperty('account')
    expect(payload).not.toHaveProperty('credentials')
    expect((await fetch(path + '?symbol=BTCUSDT&interval=1m')).status).toBe(400)
    expect((await fetch(path + '?symbol=BTCUSDT&interval=1h&mode=real')).status).toBe(400)
    expect((await fetch(path + '?symbol=../ETHUSDT&interval=1h')).status).toBe(400)
    expect((await fetch(path + '?symbol=BTCUSDT&interval=1h', { method: 'POST' })).status).toBe(405)
  })

  it('checks real MCP lifecycle without claiming account or Trade scopes', async () => {
    const { origin } = await serverWithTrading({
      agentOs: { async binanceAgentOsState() {
        return { configured: true, status: 'ready', toolNames: ['binance_spot_ticker'] }
      } },
    })
    const reply = await fetch(origin + '/phoenix-trading/paper/mcp-status')
    expect(reply.status).toBe(200)
    expect(await reply.json()).toMatchObject({
      configured: true, connected: true, toolCount: 1,
      tradeScopeVerified: false, accountVerified: false,
    })
    const rejected = await fetch(origin + '/phoenix-trading/paper/mcp-reconnect', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(rejected.status).toBe(409)
  })

  it('validates keys only against Spot Testnet and never echoes or logs secrets', async () => {
    const secretValues = new Map<string, string>()
    const credentials = {
      async set(ref: string, value: string) { secretValues.set(ref, value) },
      async unset(ref: string) { secretValues.delete(ref) },
      async resolve(ref: string) {
        const value = secretValues.get(ref)
        return value === undefined ? undefined : { value, source: 'file' }
      },
      async describe() { return { configured: true, writable: true } },
    }
    const request: typeof fetch = async (input, init) => {
      expect(String(input)).toContain('https://testnet.binance.vision/api/v3/account')
      expect(init?.headers).toMatchObject({ 'X-MBX-APIKEY': 'TESTNET_KEY_1234567890' })
      return new Response(JSON.stringify({ canTrade: true, balances: [] }), { status: 200 })
    }
    const testnet = new BinanceSpotTestnet(async () => {
      const key = secretValues.get('PHOENIX_BINANCE_TESTNET_API_KEY')
      const secret = secretValues.get('PHOENIX_BINANCE_TESTNET_API_SECRET')
      return key && secret ? { apiKey: key, secret } : undefined
    }, request)
    const { origin } = await serverWithTrading({ testnet, credentials: credentials as never })
    const url = origin + '/phoenix-trading/paper/testnet-connect'
    const wrongOrigin = await fetch(url, {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'TESTNET_KEY_1234567890', secret: 'TESTNET_SECRET_1234567890' }),
    })
    expect(wrongOrigin.status).toBe(403)
    expect(secretValues.size).toBe(0)
    const success = await fetch(url, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'TESTNET_KEY_1234567890', secret: 'TESTNET_SECRET_1234567890' }),
    })
    expect(success.status).toBe(200)
    const text = await success.text()
    expect(text).not.toContain('TESTNET_KEY_1234567890')
    expect(text).not.toContain('TESTNET_SECRET_1234567890')
    expect(JSON.parse(text)).toMatchObject({ mode: 'testnet', configured: true, connected: true, canTrade: true })
    expect(secretValues.size).toBe(2)
    const check = await fetch(origin + '/phoenix-trading/paper/testnet-status')
    expect(await check.json()).toMatchObject({ configured: true, connected: true, canTrade: true })
  })

  it('persists HMAC Testnet keys even if Binance is temporarily offline, and reuses them later', async () => {
    const saved = new Map<string, string>()
    const vault = {
      async set(ref: string, value: string) { saved.set(ref, value) },
      async unset(ref: string) { saved.delete(ref) },
      async resolve(ref: string) {
        const value = saved.get(ref)
        return value === undefined ? undefined : { value, source: 'file' }
      },
      async describe() { return { configured: true, writable: true } },
    }
    let reachable = false
    const testnet = new BinanceSpotTestnet(async () => {
      const apiKey = saved.get('PHOENIX_BINANCE_TESTNET_API_KEY')
      const secret = saved.get('PHOENIX_BINANCE_TESTNET_API_SECRET')
      return apiKey && secret ? { apiKey, secret } : undefined
    }, async (input, init) => {
      expect(String(input)).toContain('https://testnet.binance.vision/api/v3/account')
      expect(init?.headers).toEqual({ 'X-MBX-APIKEY': 'TESTNET_KEY_1234567890' })
      return reachable
        ? new Response(JSON.stringify({ canTrade: true, balances: [] }), { status: 200 })
        : new Response(JSON.stringify({ code: -1003, msg: 'Rate limited' }), { status: 429 })
    })
    const { origin } = await serverWithTrading({ testnet, credentials: vault as never })
    const savedReply = await fetch(origin + '/phoenix-trading/paper/testnet-connect', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'TESTNET_KEY_1234567890', secret: 'TESTNET_SECRET_1234567890' }),
    })
    expect(savedReply.status).toBe(200)
    const pending = await savedReply.json()
    expect(pending).toMatchObject({
      mode: 'testnet', saved: true, configured: true,
      connected: false, issue: 'rate-limited',
    })
    expect(JSON.stringify(pending)).not.toContain('TESTNET_SECRET_1234567890')
    expect(saved.size).toBe(2)
    const disconnected = await fetch(origin + '/phoenix-trading/paper/testnet-status')
    expect(await disconnected.json()).toMatchObject({ configured: true, connected: false })
    reachable = true
    const reconnect = await fetch(origin + '/phoenix-trading/paper/testnet-status')
    expect(await reconnect.json()).toMatchObject({ configured: true, connected: true, canTrade: true })
    expect(saved.get('PHOENIX_BINANCE_TESTNET_API_SECRET')).toBe('TESTNET_SECRET_1234567890')
  })

  it('rolls back both credentials if the second vault write fails', async () => {
    const saved = new Map<string, string>([
      ['PHOENIX_BINANCE_TESTNET_API_KEY', 'OLD_TESTNET_KEY_012345678901'],
      ['PHOENIX_BINANCE_TESTNET_API_SECRET', 'OLD_TESTNET_SECRET_012345678901'],
    ])
    const vault = {
      async set(ref: string, value: string) {
        if (ref === 'PHOENIX_BINANCE_TESTNET_API_SECRET' && value !== 'OLD_TESTNET_SECRET_012345678901') {
          throw new Error('simulated-vault-write-failure')
        }
        saved.set(ref, value)
      },
      async unset(ref: string) { saved.delete(ref) },
      async resolve(ref: string) {
        const value = saved.get(ref)
        return value === undefined ? undefined : { value, source: 'file' }
      },
      async describe() { return { configured: true, writable: true } },
    }
    const testnet = new BinanceSpotTestnet(async () => undefined)
    const { origin } = await serverWithTrading({ testnet, credentials: vault as never })
    const response = await fetch(origin + '/phoenix-trading/paper/testnet-connect', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'TESTNET_KEY_1234567890', secret: 'TESTNET_SECRET_1234567890' }),
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'vault-write-failed' })
    expect(saved.get('PHOENIX_BINANCE_TESTNET_API_KEY')).toBe('OLD_TESTNET_KEY_012345678901')
    expect(saved.get('PHOENIX_BINANCE_TESTNET_API_SECRET')).toBe('OLD_TESTNET_SECRET_012345678901')
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
