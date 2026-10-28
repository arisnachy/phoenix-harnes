/** Public-only Binance Spot universe discovery: no API keys, wallets or orders. */
export interface BinanceMarketCandidate {
  readonly symbol: string
  readonly quoteVolumeUsdt: number
}

/** Strictly filter active, liquid Spot USDT pairs. No fabricated prices. */
export function selectBinanceSpotUniverse(
  exchangeInfo: unknown, ticker24h: unknown, limit = 120,
): readonly string[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200
    || typeof exchangeInfo !== 'object' || exchangeInfo === null
    || !('symbols' in exchangeInfo) || !Array.isArray(exchangeInfo.symbols)
    || !Array.isArray(ticker24h)) throw new Error('Invalid Binance universe response')
  const allowed = new Set<string>()
  for (const raw of exchangeInfo.symbols) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (typeof row.symbol !== 'string' || !/^[A-Z0-9]{3,16}USDT$/u.test(row.symbol)
      || row.status !== 'TRADING' || row.quoteAsset !== 'USDT'
      || row.isSpotTradingAllowed === false || /(?:UP|DOWN|BULL|BEAR)USDT$/u.test(row.symbol)) continue
    allowed.add(row.symbol)
  }
  const candidates: BinanceMarketCandidate[] = []
  for (const raw of ticker24h) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (typeof row.symbol !== 'string' || !allowed.has(row.symbol)) continue
    const volume = Number(row.quoteVolume)
    const price = Number(row.lastPrice)
    if (!Number.isFinite(volume) || volume < 5_000_000
      || !Number.isFinite(price) || price <= 0) continue
    candidates.push({ symbol: row.symbol, quoteVolumeUsdt: volume })
  }
  candidates.sort((a, b) => b.quoteVolumeUsdt - a.quoteVolumeUsdt
    || a.symbol.localeCompare(b.symbol))
  const symbols = [...new Set(candidates.map(item => item.symbol))].slice(0, limit)
  if (symbols.length === 0) throw new Error('No eligible liquid Spot USDT markets')
  return symbols
}

/** Read the public Binance universe; failures are visible and never turn into buy signals. */
export async function discoverBinanceSpotMarkets(): Promise<readonly string[]> {
  const api = 'https://data-api.binance.vision'
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(api + path, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error('Binance public market discovery failed (HTTP ' + response.status + ')')
    return response.json() as Promise<unknown>
  }
  const [exchange, tickers] = await Promise.all([
    get('/api/v3/exchangeInfo'),
    get('/api/v3/ticker/24hr'),
  ])
  return selectBinanceSpotUniverse(exchange, tickers)
}
