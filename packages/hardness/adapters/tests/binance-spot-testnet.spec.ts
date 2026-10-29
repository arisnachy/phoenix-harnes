import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { BinanceSpotTestnet, binanceTestnetCredentials } from '../src/binance-spot-testnet.ts'

function credentials() { return { apiKey: 'TEST_PUBLIC_KEY', secret: 'TEST_SECRET' } }

describe('Official Binance Spot Testnet isolation', () => {
  it('does not accept missing credentials and never uses production Binance', async () => {
    expect(binanceTestnetCredentials({})).toBeUndefined()
    const client = new BinanceSpotTestnet(() => undefined, vi.fn())
    expect(await client.status()).toMatchObject({
      mode: 'testnet', configured: false, connected: false,
    })
    await expect(client.order({ symbol: 'BTCUSDT', side: 'BUY', quoteUsdt: 20 }))
      .rejects.toThrow('Testnet API credentials')
  })

  it('reads independently priced Testnet OHLCV without credentials or production endpoints', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [
      i * 900000, '120', '121', '119', '120', '10',
      (i + 1) * 900000 - 1, '1200', 5,
    ])
    const transport = vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input)
      expect(url.origin).toBe('https://testnet.binance.vision')
      expect(url.pathname).toBe('/api/v3/klines')
      expect(url.searchParams.get('interval')).toBe('15m')
      expect(init.headers).toBeUndefined()
      expect(init.redirect).toBe('error')
      return new Response(JSON.stringify(rows), {status:200})
    })
    const client = new BinanceSpotTestnet(() => undefined, transport as never)
    const bars = await client.candles('BTCUSDT', '15m', 80)
    expect(bars).toHaveLength(80)
    expect(bars[0]).toMatchObject({ open:120, close:120, quoteVolume:1200 })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('keeps funded Testnet assets when the account contains more than 100 zero balances', async () => {
    const balances = Array.from({length: 130}, (_, index) => ({
      asset: 'EMPTY' + index, free:'0.000', locked:'0.000',
    }))
    balances.push({asset:'USDT',free:'1000.000',locked:'0.000'})
    balances.push({asset:'BTC',free:'0.500',locked:'0.000'})
    const client = new BinanceSpotTestnet(credentials, async () => new Response(
      JSON.stringify({canTrade:true,balances}), {status:200}))
    const status = await client.status()
    expect(status.balances).toEqual([
      {asset:'USDT',free:'1000.000',locked:'0.000'},
      {asset:'BTC',free:'0.500',locked:'0.000'},
    ])
  })

  it('signs the official testnet account path with HMAC and returns test balances only', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const target = new URL(url)
      expect(target.origin).toBe('https://testnet.binance.vision')
      expect(target.pathname).toBe('/api/v3/account')
      expect(init.headers).toEqual({ 'X-MBX-APIKEY': 'TEST_PUBLIC_KEY' })
      expect(init.redirect).toBe('error')
      const query = target.searchParams.toString().split('&signature=')[0]!
      expect(target.searchParams.get('signature')).toBe(
        createHmac('sha256', 'TEST_SECRET').update(query).digest('hex'),
      )
      return { ok: true, json: async () => ({
        canTrade: true,
        balances: [{ asset: 'USDT', free: '1000.00', locked: '0.00' }],
      }) }
    })
    const client = new BinanceSpotTestnet(credentials, fetcher as never, () => 1700000000000)
    const status = await client.status()
    expect(status).toMatchObject({
      configured: true, connected: true, canTrade: true, mode: 'testnet',
      balances: [{ asset: 'USDT', free: '1000.00' }],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports invalid credentials without returning keys or arbitrary provider messages', async () => {
    const client = new BinanceSpotTestnet(credentials, async () =>
      new Response(JSON.stringify({ code: -2015, msg: 'Secret value: TEST_SECRET' }), { status: 401 }))
    const status = await client.status()
    expect(status).toMatchObject({
      mode: 'testnet', configured: true, connected: false, issue: 'ip-or-permission',
    })
    expect(JSON.stringify(status)).not.toContain('TEST_SECRET')
  })

  it('recovers once from a wrong Host clock using Testnet server time and HMAC signing', async () => {
    let accountCalls = 0
    const test = new BinanceSpotTestnet(credentials, async (input, init) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://testnet.binance.vision')
      if (url.pathname === '/api/v3/time') {
        expect(init?.headers).toBeUndefined()
        return new Response(JSON.stringify({ serverTime: 1700000001400 }), { status: 200 })
      }
      expect(url.pathname).toBe('/api/v3/account')
      accountCalls++
      if (accountCalls === 1) return new Response(JSON.stringify({ code: -1021 }), { status: 400 })
      expect(url.searchParams.get('timestamp')).toBe('1700000001400')
      return new Response(JSON.stringify({ canTrade: true, balances: [] }), { status: 200 })
    }, () => 1700000000000)
    expect(await test.status()).toMatchObject({ connected: true, canTrade: true })
    expect(accountCalls).toBe(2)
  })

  it('sends a test-only order, confirms exchange receipt and does not invent fill status', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const target = new URL(url)
      expect(target.origin).toBe('https://testnet.binance.vision')
      expect(target.pathname).toBe('/api/v3/order')
      expect(target.searchParams.get('side')).toBe('BUY')
      expect(target.searchParams.get('quoteOrderQty')).toBe('25')
      expect(init.method).toBe('POST')
      return { ok: true, json: async () => ({
        symbol: 'BTCUSDT', side: 'BUY', orderId: 1234, status: 'NEW',
        executedQty: '0', cummulativeQuoteQty: '0',
      }) }
    })
    const receipt = await new BinanceSpotTestnet(credentials, fetcher as never).order({
      symbol: 'BTCUSDT', side: 'BUY', quoteUsdt: 25,
    })
    expect(receipt).toEqual({
      mode: 'testnet', symbol: 'BTCUSDT', side: 'BUY',
      orderId: 1234, status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0',
    })
  })

  it('bounds a test order and rejects production/signed futures assumptions', async () => {
    const fetcher = vi.fn()
    const client = new BinanceSpotTestnet(credentials, fetcher)
    await expect(client.order({ symbol: 'BTCUSDT', side: 'BUY', quoteUsdt: 1000 }))
      .rejects.toThrow('between 10 and 100')
    await expect(client.order({ symbol: 'BTCUSDT', side: 'SELL', quantity: 500 }))
      .rejects.toThrow('at most 100')
    await expect(client.order({ symbol: 'BTCUSD', side: 'BUY', quoteUsdt: 25 }))
      .rejects.toThrow('USDT pair')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
