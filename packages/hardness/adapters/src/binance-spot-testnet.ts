import { createHmac } from 'node:crypto'

const BASE = 'https://testnet.binance.vision'
const MAX_ORDER_USDT = 100
const MAX_SELL_UNITS = 100
const TIMEOUT_MS = 10_000

/** Dedicated Spot Testnet credentials, NOT Binance production credentials. */
export interface BinanceTestnetCredentials {
  readonly apiKey: string
  readonly secret: string
}

/** Signed Binance test-environment order receipt. */
export interface BinanceTestnetOrderReceipt {
  readonly mode: 'testnet'
  readonly symbol: string
  readonly side: 'BUY' | 'SELL'
  readonly orderId: number
  readonly status: string
  readonly executedQty: string
  readonly cummulativeQuoteQty: string
}

/**
 * Read only dedicated Spot Testnet credentials from the Phoenix Host environment.
 * @param env - Environment supplied by the owning Host.
 * @returns Host-only testnet API credentials, or undefined when unavailable.
 */
export function binanceTestnetCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): BinanceTestnetCredentials | undefined {
  const apiKey = env.PHOENIX_BINANCE_TESTNET_API_KEY?.trim()
  const secret = env.PHOENIX_BINANCE_TESTNET_API_SECRET?.trim()
  return apiKey && secret ? { apiKey, secret } : undefined
}

function pair(raw: string): string {
  const symbol = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]{3,16}USDT$/u.test(symbol)) throw new Error('Spot Testnet requires a USDT pair')
  return symbol
}

/**
 * Read a real TESTNET wallet and submit actual test-environment Spot orders.
 * Its BASE is fixed; redirect:'error' prevents leaking the API key to another host.
 */
export class BinanceSpotTestnet {
  constructor(
    private readonly credentials: () => BinanceTestnetCredentials | undefined = binanceTestnetCredentials,
    private readonly request: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private async signed(path: '/api/v3/account' | '/api/v3/order',
    method: 'GET' | 'POST',
    fields: Readonly<Record<string, string>> = {},
  ): Promise<Record<string, unknown>> {
    const credentials = this.credentials()
    if (credentials === undefined) throw new Error('Testnet API credentials missing in Phoenix Host')
    const query = new URLSearchParams({ ...fields, recvWindow: '5000', timestamp: String(this.clock()) }).toString()
    const signature = createHmac('sha256', credentials.secret).update(query).digest('hex')
    const response = await this.request(BASE + path + '?' + query + '&signature=' + signature, {
      method,
      headers: { 'X-MBX-APIKEY': credentials.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Binance Spot Testnet request failed (HTTP ${response.status})`)
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Binance Spot Testnet response')
    }
    return value as Record<string, unknown>
  }

  /**
   * Check test-funds wallet readiness without sending credentials to the model.
   * @returns Sanitized account status with non-sensitive TESTNET balances.
   */
  async status(): Promise<{
    readonly mode: 'testnet'
    readonly configured: boolean
    readonly connected: boolean
    readonly canTrade?: boolean
    readonly balances?: readonly { asset: string; free: string; locked: string }[]
    readonly nextAction: string
  }> {
    if (this.credentials() === undefined) {
      return { mode: 'testnet', configured: false, connected: false,
        nextAction: 'Configure PHOENIX_BINANCE_TESTNET_API_KEY and PHOENIX_BINANCE_TESTNET_API_SECRET in the Host, never in chat' }
    }
    try {
      const value = await this.signed('/api/v3/account', 'GET')
      if (!Array.isArray(value.balances)) throw new Error('Invalid account balances')
      const balances = value.balances.flatMap((balance) => {
        if (!balance || typeof balance !== 'object' || Array.isArray(balance)) return []
        const row = balance as Record<string, unknown>
        return typeof row.asset === 'string' && typeof row.free === 'string' && typeof row.locked === 'string'
          ? [{ asset: row.asset, free: row.free, locked: row.locked }] : []
      })
      return { mode: 'testnet', configured: true, connected: true,
        canTrade: value.canTrade === true, balances: balances.slice(0, 100),
        nextAction: 'Testing account connected; each test order still requires explicit user request' }
    } catch {
      return { mode: 'testnet', configured: true, connected: false,
        nextAction: 'Testnet authentication or network check failed; inspect Host credentials' }
    }
  }

  /**
   * Submit one real TESTNET order, never a production Binance order.
   * Call only after the user explicitly requests this TESTNET transaction.
   * @param input - Pair, side, and capped quote/quantity.
   * @returns Exchange order status (NEW does not prove a fill).
   */
  async order(input: {
    readonly symbol: string
    readonly side: 'BUY' | 'SELL'
    readonly quoteUsdt?: number
    readonly quantity?: number
  }): Promise<BinanceTestnetOrderReceipt> {
    const symbol = pair(input.symbol)
    const side: unknown = input.side
    if (side !== 'BUY' && side !== 'SELL') throw new Error('Invalid Testnet side')
    const buy = input.side === 'BUY'
    if (buy && (input.quantity !== undefined || !Number.isFinite(input.quoteUsdt)
      || (input.quoteUsdt ?? 0) < 10 || (input.quoteUsdt ?? 0) > MAX_ORDER_USDT)) {
      throw new Error('Testnet BUY quoteUsdt must be between 10 and 100')
    }
    if (!buy && (input.quoteUsdt !== undefined || !Number.isFinite(input.quantity)
      || (input.quantity ?? 0) <= 0 || (input.quantity ?? 0) > MAX_SELL_UNITS)) {
      throw new Error('Testnet SELL quantity must be positive and at most 100')
    }
    const value = await this.signed('/api/v3/order', 'POST', {
      symbol, side: input.side, type: 'MARKET',
      ...(buy ? { quoteOrderQty: String(input.quoteUsdt) } : { quantity: String(input.quantity) }),
    })
    if (value.symbol !== symbol || value.side !== input.side
      || typeof value.orderId !== 'number' || !Number.isSafeInteger(value.orderId)
      || typeof value.status !== 'string' || typeof value.executedQty !== 'string'
      || typeof value.cummulativeQuoteQty !== 'string') {
      throw new Error('Incomplete Testnet order receipt; check status before retrying')
    }
    return {
      mode: 'testnet', symbol, side: input.side, orderId: value.orderId,
      status: value.status, executedQty: value.executedQty, cummulativeQuoteQty: value.cummulativeQuoteQty,
    }
  }
}
