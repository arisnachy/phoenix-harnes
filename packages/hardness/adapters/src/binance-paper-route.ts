import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GameWebRouteHost } from './godot-web-bundle.ts'
import type { BinancePaperAutomation } from './binance-paper-automation.ts'
import { dashboardJson } from './binance-trading-tools.ts'

const ROUTE = '/phoenix-trading/paper'
const ENDPOINT = ROUTE + '/dashboard'
const CONTROL = ROUTE + '/control'
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

async function readControl(req: IncomingMessage): Promise<{
  action: 'start' | 'stop' | 'check-now'
  symbols?: string[]
  interval?: '15m' | '1h' | '4h' | '1d'
  pollMinutes?: number
}> {
  if (!/^application\/json(?:\s*;|\s*$)/iu.test(req.headers['content-type'] ?? '')) {
    throw new Error('JSON content type required')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const binary = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += binary.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('Request too large')
    chunks.push(binary)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid request')
  const payload = value as Record<string, unknown>
  if (Object.keys(payload).some(key => !['action', 'symbols', 'interval', 'pollMinutes'].includes(key))) {
    throw new Error('Unsupported control field')
  }
  if (payload.action !== 'start' && payload.action !== 'stop' && payload.action !== 'check-now') {
    throw new Error('Unsupported paper action')
  }
  if (payload.action === 'start') {
    if (!Array.isArray(payload.symbols) || !payload.symbols.every(symbol => typeof symbol === 'string')
      || (payload.interval !== undefined && !['15m', '1h', '4h', '1d'].includes(String(payload.interval)))
      || (payload.pollMinutes !== undefined && (!Number.isInteger(payload.pollMinutes)
        || !Number.isFinite(payload.pollMinutes) || Number(payload.pollMinutes) < 1
        || Number(payload.pollMinutes) > 60))) {
      throw new Error('Invalid PAPER start request')
    }
    return {
      action: 'start', symbols: payload.symbols as string[],
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
 * @returns Disposer for the read and control endpoints.
 */
export function mountBinancePaperDashboardRoute(
  host: GameWebRouteHost,
  engine: BinancePaperAutomation,
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
    if (!read && !write) { res.writeHead(404).end(); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (read && req.method !== 'GET' && req.method !== 'HEAD'
      || write && req.method !== 'POST') { res.writeHead(405).end(); return }
    if (write && !localUserAction(req)) {
      res.writeHead(403).end(JSON.stringify({ error: 'Same-origin user action required' }))
      return
    }
    try {
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
