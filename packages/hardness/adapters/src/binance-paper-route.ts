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
const MCP_RECONNECT = ROUTE + '/mcp-reconnect'
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
  if (!/^application\/json(?:\s*;|\s*$)/iu.test(req.headers['content-type'] ?? '')) {
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

type TestnetVault = Pick<CredentialProvider, 'set' | 'resolve' | 'unset' | 'describe'>

/**
 * Save a HMAC Testnet pair in the existing durable Phoenix credential provider.
 * Verify read-back so a false UI success is impossible, and restore the previous
 * pair if one of the two writes fails. No values are returned or logged.
 */
async function storeTestnetPair(vault: TestnetVault, apiKey: string, secret: string): Promise<void> {
  const keyRef = credentialRef('PHOENIX_BINANCE_TESTNET_API_KEY')
  const secretRef = credentialRef('PHOENIX_BINANCE_TESTNET_API_SECRET')
  const before = await Promise.all([vault.resolve(keyRef), vault.resolve(secretRef)])
  const writable = await Promise.all([vault.describe(keyRef), vault.describe(secretRef)])
  if (writable.some(info => !info.writable)) throw new Error('vault-read-only')
  try {
    await vault.set(keyRef, apiKey)
    await vault.set(secretRef, secret)
    const [storedKey, storedSecret] = await Promise.all([
      vault.resolve(keyRef), vault.resolve(secretRef),
    ])
    if (storedKey?.value !== apiKey || storedSecret?.value !== secret) {
      throw new Error('vault-readback-mismatch')
    }
  } catch {
    // Preserve a previously usable pair if a partial write failed.
    try {
      if (before[0] === undefined) await vault.unset(keyRef)
      else if (before[0].source !== 'env') await vault.set(keyRef, before[0].value)
      if (before[1] === undefined) await vault.unset(secretRef)
      else if (before[1].source !== 'env') await vault.set(secretRef, before[1].value)
    } catch { /* UI still receives failure; never claim storage succeeded. */ }
    throw new Error('vault-write-failed')
  }
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
  options: { testnet?: BinanceSpotTestnet; credentials?: TestnetVault; agentOs?: Partial<BinanceAgentOsHostService> } = {},
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
    const reconnect = url.pathname === MCP_RECONNECT
    if (!read && !write && !market && !testing && !connect && !mcpStatus && !reconnect) { res.writeHead(404).end(); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if ((read || market || testing || mcpStatus) && req.method !== 'GET' && req.method !== 'HEAD'
      || (write || connect || reconnect) && req.method !== 'POST') { res.writeHead(405).end(); return }
    if ((write || connect || reconnect) && !localUserAction(req)) {
      res.writeHead(403).end(JSON.stringify({ error: 'Same-origin user action required' }))
      return
    }
    try {
      if (reconnect) {
        const receipt = await options.agentOs?.reconnectBinanceAgentOs?.()
        res.statusCode = receipt?.accepted === true ? 200 : 409
        res.end(JSON.stringify({
          reconnectAccepted: receipt?.accepted === true,
          nextAction: receipt?.accepted === true
            ? 'Connector reconnect requested; run MCP health check again and complete OAuth if prompted'
            : 'Install or authorize Binance Agentic MCP from Phoenix Settings > Connectors',
        }))
        return
      }
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
          ...(status.issue === undefined ? {} : { issue: status.issue }),
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
            || body.secret.length < 12 || body.secret.length > 256 || /\s/u.test(body.secret)) {
            throw new Error('Invalid test credentials')
          }
          key = body.apiKey
          secret = body.secret
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: 'Invalid Binance Spot Testnet credential format' }))
          return
        }
        // Separate durable storage from network readiness. Binance Testnet
        // can be offline, rate limited or reject an account temporarily; the
        // owner should not need to enter the HMAC keys again after a restart.
        try {
          await storeTestnetPair(options.credentials, key, secret)
        } catch (error) {
          const locked = error instanceof Error && error.message === 'vault-read-only'
          res.writeHead(locked ? 409 : 503).end(JSON.stringify({
            error: locked ? 'vault-read-only' : 'vault-write-failed',
            nextAction: locked
              ? 'La bóveda tiene una variable de entorno de solo lectura que impide guardar esta clave. Revisa el origen de credenciales del Host.'
              : 'No se pudo verificar el guardado de ambas claves en la bóveda. Las credenciales anteriores se conservaron cuando fue posible.',
          }))
          return
        }
        // Read the stored pair back via the Host-owned credential resolver,
        // not the transient browser payload. Never report CONNECTED unless
        // Binance responds with a successful authenticated account result.
        let probe: Awaited<ReturnType<BinanceSpotTestnet['status']>>
        try {
          probe = await options.testnet.status()
        } catch {
          // A transient provider read or network exception AFTER confirmed
          // durable storage must not turn a successful save into a UI failure.
          probe = { mode: 'testnet', configured: true, connected: false,
            nextAction: 'Claves guardadas en la bóveda; la verificación de Binance sigue pendiente.' }
        }
        res.statusCode = 200
        res.end(JSON.stringify({
          mode: 'testnet', configured: true, saved: true,
          connected: probe.connected, canTrade: probe.canTrade === true,
          ...(probe.issue === undefined ? {} : { issue: probe.issue }),
          nextAction: probe.nextAction,
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
