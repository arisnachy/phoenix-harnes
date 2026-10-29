import { describe, expect, it } from 'vitest'
import { selectBinanceSpotUniverse } from '../src/binance-market-discovery.ts'

describe('Binance public Spot universe', () => {
  const exchange = { symbols: [
    { symbol: 'BTCUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: true },
    { symbol: 'ETHUSDT', status: 'TRADING', quoteAsset: 'USDT' },
    { symbol: 'SOLUSDT', status: 'BREAK', quoteAsset: 'USDT' },
    { symbol: 'XRPUSDT', status: 'TRADING', quoteAsset: 'USDT', isSpotTradingAllowed: false },
    { symbol: 'BTCUPUSDT', status: 'TRADING', quoteAsset: 'USDT' },
    { symbol: 'BTCBUSD', status: 'TRADING', quoteAsset: 'BUSD' },
  ] }
  const ticker = [
    { symbol: 'BTCUSDT', lastPrice: '90000', quoteVolume: '150000000' },
    { symbol: 'ETHUSDT', lastPrice: '3000', quoteVolume: '55000000' },
    { symbol: 'SOLUSDT', lastPrice: '120', quoteVolume: '80000000' },
    { symbol: 'XRPUSDT', lastPrice: '1', quoteVolume: '18000000' },
    { symbol: 'BTCUPUSDT', lastPrice: '3', quoteVolume: '1500000000' },
  ]
  it('ranks verified liquid Spot pairs without leveraged or suspended markets', () => {
    expect(selectBinanceSpotUniverse(exchange, ticker, 120)).toEqual(['BTCUSDT', 'ETHUSDT'])
  })
  it('excludes known Monitoring Tag and announced spot-delisted assets even with high volume', () => {
    const risky = { symbols: [
      ...exchange.symbols,
      { symbol: 'BICOUSDT', status: 'TRADING', quoteAsset: 'USDT' },
      { symbol: 'CVCUSDT', status: 'TRADING', quoteAsset: 'USDT' },
      { symbol: 'EPICUSDT', status: 'TRADING', quoteAsset: 'USDT' },
      { symbol: 'QUICKUSDT', status: 'TRADING', quoteAsset: 'USDT' },
      { symbol: 'FUTUREUSDT', status: 'TRADING', quoteAsset: 'USDT', tags: ['MONITORING'] },
    ] }
    const quotes = [...ticker, ...['BICOUSDT', 'CVCUSDT', 'EPICUSDT', 'QUICKUSDT', 'FUTUREUSDT']
      .map(symbol => ({ symbol, lastPrice: '10', quoteVolume: '1000000000' }))]
    expect(selectBinanceSpotUniverse(risky, quotes, 1000)).toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('respects exchange permissionSets and never treats a delisted pair as active', () => {
    const permissioned = { symbols: [
      { symbol: 'ABCUSDT', status: 'TRADING', quoteAsset: 'USDT', permissionSets: [['MARGIN']] },
      { symbol: 'DEFUSDT', status: 'TRADING', quoteAsset: 'USDT', permissionSets: [['SPOT', 'MARGIN']] },
      { symbol: 'GHIUSDT', status: 'HALT', quoteAsset: 'USDT', permissionSets: [['SPOT']] },
    ] }
    expect(selectBinanceSpotUniverse(permissioned, [
      { symbol: 'ABCUSDT', quoteVolume: '10000000', lastPrice: '10' },
      { symbol: 'DEFUSDT', quoteVolume: '10000000', lastPrice: '10' },
      { symbol: 'GHIUSDT', quoteVolume: '10000000', lastPrice: '10' },
    ])).toEqual(['DEFUSDT'])
  })

  it('rejects provider truncation and invalid inputs rather than inventing pairs', () => {
    expect(() => selectBinanceSpotUniverse({}, ticker)).toThrow('Invalid')
    expect(() => selectBinanceSpotUniverse(exchange, [], 12)).toThrow('No eligible')
    expect(() => selectBinanceSpotUniverse(exchange, ticker, 1001)).toThrow('Invalid')
    expect(() => selectBinanceSpotUniverse(exchange, ticker, 1)).toEqual(['BTCUSDT'])
  })
})
