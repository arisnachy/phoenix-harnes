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
