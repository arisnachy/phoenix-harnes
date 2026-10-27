import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GameWebRouteHost } from './godot-web-bundle.ts'
import type { BinancePaperAutomation } from './binance-paper-automation.ts'
import { dashboardJson, type BinanceAgentOsHostService } from './binance-trading-tools.ts'
import type { BinanceSpotTestnet } from './binance-spot-testnet.ts'
import { credentialRef, type CredentialProvider } from '@phoenix-ai/dsh-credentials'

const ROUTE = '/phoenix-trading/paper'
const ENDPOINT = ROUTE + '/dashboard'
const CONTROL = ROUTE + '/control'
const CANDLES = ROUTE + '/candles'
const TESTNET_STATUS = ROUTE + '/testnet-status'
const TESTNET_CONNECT = ROUTE + '/testnet-connect'
const MCP_STATUS = ROUTE + '/mcp-status'
const CHART_INTERVALS = new Set(['15m', '1h', '4h', '1d'])
const MAX_BODY_BYTES = 2048

function localUserAction(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof origin !== 'string' || typeof host !== 'string'
    || (fetchSite !== undefined && fetchSite !== 'same-origin')) return false
  try {
    const source = new URL(origin)
    return (source.protocol === 'http:' || source.protocol === 'https:')
      && source.host.toLowerCase() === host.toLowerCase()
      && source.username === '' && source.password === ''
      && source.pathname === '/' && source.search === '' && source.hash === ''
  } catch { return false }
}

function privateCredentialAction(req: IncomingMessage): boolean {
  if (!localUserAction(req)) return false
  try {
    const source = new URL(req.headers.origin!)
    return source.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)
  } catch { return false }
}

async function readRequestObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\\/json(?:\\s*;|\\s*$)/iu.test(req.headers['content-type'] ?? '')) {
    throw new Error('JSON content type required')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    const binary = new Uint8Array(chunk as Uint8Array)
    size += binary.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('Request too large')
    chunks.push(binary)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid request')
  return value as Record<string, unknown>
}

async function readControl(req: IncomingMessage): Promise<{
  action: 'start' | 'stop' | 'check-now'
  symbols?: string[]
  interval?: '15m' | '1h' | '4h' | '1d'
  pollMinutes?: number
}> {
  const payload = await readRequestObject(req)
  if (Object.keys(payload).some(key => !['action', 'symbols', 'interval', 'pollMinutes'].includes(key))) {
    throw new Error('Unsupported control field')
  }
  if (payload.action !== 'start' && payload.action !== 'stop' && payload.action !== 'check-now') {
    throw new Error('Unsupported paper action')
  }
  if (payload.action === 'start') {
    if (!Array.isArray(payload.symbols) || !payload.symbols.every(symbol => typeof symbol === 'string')
      || (payload.interval !== undefined && (typeof payload.interval !== 'string' || !['15m', '1h', '4h', '1d'].includes(payload.interval)))
      || (payload.pollMinutes !== undefined && (!Number.isInteger(payload.pollMinutes)
        || !Number.isFinite(payload.pollMinutes) || Number(payload.pollMinutes) < 1
        || Number(payload.pollMinutes) > 60))) {
      throw new Error('Invalid PAPER start request')
    }
    return {
      action: 'start', symbols: payload.symbols,
      ...(payload.interval === undefined ? {} : { interval: payload.interval as '15m' | '1h' | '4h' | '1d' }),
      ...(payload.pollMinutes === undefined ? {} : { pollMinutes: payload.pollMinutes as number }),
    }
  }
  if (Object.keys(payload).length !== 1) throw new Error('Stop and check-now accept only an action')
  return { action: payload.action }
}

/**
 * Publish genuine virtual-ledger evidence and browser-clicked PAPER controls.
 * Real Binance account actions are not reachable through these endpoints.
 * @param host - Phoenix local route registration service.
 * @param engine - Virtual-only broker with bounded persistent automation.
 * @param options - Optional secret-isolated Spot Testnet status and vault configuration.
 * @returns Disposer for the read and control endpoints.
 */
export function mountBinancePaperDashboardRoute(
  host: GameWebRouteHost,
  engine: BinancePaperAutomation,
  options: { testnet?: BinanceSpotTestnet; credentials?: Pick<CredentialProvider, 'set'>; agentOs?: Partial<BinanceAgentOsHostService> } = {},
): () => void {
  // Never cache virtual fills: a background paper-step can settle between
  // two browser polls without going through this HTTP route.
  async function latest(): Promise<string> {
    return JSON.stringify(dashboardJson(await engine.dashboard()))
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const read = url.pathname === ENDPOINT
    const write = url.pathname === CONTROL
    const market = url.pathname === CANDLES
    const testing = url.pathname === TESTNET_STATUS
    const connect = url.pathname === TESTNET_CONNECT
    const mcpStatus = url.pathname === MCP_STATUS
    if (!read && !write && !market && !testing && !connect && !mcpStatus) { res.writeHead(404).end(); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if ((read || market || testing || mcpStatus) && req.method !== 'GET' && req.method !== 'HEAD'
      || (write || connect) && req.method !== 'POST') { res.writeHead(405).end(); return }
    if ((write || connect) && !localUserAction(req)) {
      res.writeHead(403).end(JSON.stringify({ error: 'Same-origin user action required' }))
      return
    }
    try {
      if (mcpStatus) {
        const state = await options.agentOs?.binanceAgentOsState?.()
        const connected = state?.configured === true && state.status === 'ready'
          && (state.toolNames?.length ?? 0) > 0
        res.statusCode = 200
        if (req.method === 'HEAD') res.end()
        else res.end(JSON.stringify({
          configured: state?.configured === true, connected,
          status: state?.status ?? 'disconnected',
          toolCount: state?.toolNames?.length ?? 0,
          tradeScopeVerified: false, accountVerified: false,
          nextAction: connected ? 'Verify live MCP ticker, Agentic balance and granted Trade scope'
            : state?.status === 'auth-required' ? 'Authorize Binance Agentic OAuth in Phoenix Settings > Connectors'
              : 'Install or reconnect the official Binance Agentic MCP in Phoenix Settings',
        }))
        return
      }
      if (testing) {
        if (options.testnet === undefined) {
          res.writeHead(503).end(JSON.stringify({ error: 'Spot Testnet Host unavailable' }))
          return
        }
        const status = await options.testnet.status()
        // Never expose the test balance, key or signature in a browser route.
        res.statusCode = 200
        if (req.method === 'HEAD') res.end()
        else res.end(JSON.stringify({
          mode: 'testnet', configured: status.configured,
          connected: status.connected, canTrade: status.canTrade === true,
          nextAction: status.nextAction,
        }))
        return
      }
      if (connect) {
        if (!privateCredentialAction(req) || options.credentials === undefined || options.testnet === undefined) {
          res.writeHead(403).end(JSON.stringify({ error: 'Secure Host credential setup unavailable' }))
          return
        }
        let key: string
        let secret: string
        try {
          const body = await readRequestObject(req)
          if (Object.keys(body).some(field => field !== 'apiKey' && field !== 'secret')
            || typeof body.apiKey !== 'string' || typeof body.secret !== 'string'
            || !/^[A-Za-z0-9_-]{12,256}$/u.test(body.apiKey)
            || body.secret.length < 12 || body.secret.length > 256 || /\\s/u.test(body.secret)) {
            throw new Error('Invalid test credentials')
          }
          key = body.apiKey
          secret = body.secret
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: 'Invalid Binance Spot Testnet credential format' }))
          return
        }
        // Credentials are tested against the FIXED fake-funds API before saving
        // into the Host vault. Neither key is ever returned in the response.
        const probe = await options.testnet.forCredentials({ apiKey: key, secret }).status()
        if (!probe.connected) {
          res.writeHead(422).end(JSON.stringify({ error: 'Spot Testnet rejected credentials or is unreachable' }))
          return
        }
        await options.credentials.set(credentialRef('PHOENIX_BINANCE_TESTNET_API_KEY'), key)
        await options.credentials.set(credentialRef('PHOENIX_BINANCE_TESTNET_API_SECRET'), secret)
        res.statusCode = 200
        res.end(JSON.stringify({
          mode: 'testnet', configured: true, connected: true, canTrade: probe.canTrade === true,
          nextAction: probe.canTrade ? 'Testnet ready; an individual testing order still needs approval'
            : 'Testnet connected, but this account cannot currently submit orders',
        }))
        return
      }
      if (market) {
        const symbol = url.searchParams.get('symbol') ?? ''
        const interval = url.searchParams.get('interval') ?? ''
        if (!/^[A-Z0-9]{3,16}USDT$/u.test(symbol) || !CHART_INTERVALS.has(interval)
          || [...url.searchParams.keys()].some(key => key !== 'symbol' && key !== 'interval')) {
          res.writeHead(400).end(JSON.stringify({ error: 'Invalid public market request' }))
          return
        }
        // Public Binance Spot OHLCV only. Never use account credentials or
        // virtual-order receipts as the source of exchange market candles.
        const candles = await engine.broker.candles(symbol, interval, 150)
        res.statusCode = 200
        if (req.method === 'HEAD') res.end()
        else res.end(JSON.stringify({ source: 'binance-spot-public', symbol, interval, candles }))
        return
      }
      if (read) {
        const body = await latest()
        res.statusCode = 200
        if (req.method === 'HEAD') res.end()
        else res.end(body)
        return
      }
      let action: Awaited<ReturnType<typeof readControl>>
      try { action = await readControl(req) } catch {
        res.writeHead(400).end(JSON.stringify({ error: 'Invalid PAPER trading request' }))
        return
      }
      if (action.action === 'start') {
        await engine.start({
          symbols: action.symbols ?? [],
          ...(action.interval === undefined ? {} : { interval: action.interval }),
          ...(action.pollMinutes === undefined ? {} : { pollMs: action.pollMinutes * 60_000 }),
        })
      } else if (action.action === 'stop') {
        await engine.stop()
      } else {
        await engine.step()
      }
      res.statusCode = 200
      res.end(await latest())
    } catch {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'Virtual paper broker unavailable; no operation confirmed' }))
    }
  }
  return host.register({ kind: 'prefix', path: ROUTE, handler })
}
