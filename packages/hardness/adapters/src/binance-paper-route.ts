import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GameWebRouteHost } from './godot-web-bundle.ts'
import type { BinancePaperAutomation } from './binance-paper-automation.ts'
import { dashboardJson } from './binance-trading-tools.ts'

const ROUTE = '/phoenix-trading/paper'
const ENDPOINT = ROUTE + '/dashboard'
const CACHE_TTL_MS = 8_000

/**
 * Publish only true virtual ledger data; never expose real Binance accounts or commands.
 * @param host - Phoenix local web route registration service.
 * @param engine - Read-only projection source for virtual trades.
 * @returns Disposer that unmounts the viewer route.
 */
export function mountBinancePaperDashboardRoute(
  host: GameWebRouteHost,
  engine: BinancePaperAutomation,
): () => void {
  let cached: { at: number; json: string } | undefined
  let running: Promise<string> | undefined
  async function latest(): Promise<string> {
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.json
    if (running !== undefined) return running
    const job = (async () => {
      const json = JSON.stringify(dashboardJson(await engine.dashboard()))
      cached = { at: Date.now(), json }
      return json
    })()
    running = job
    try { return await job } finally { if (running === job) running = undefined }
  }
  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== ENDPOINT) { res.writeHead(404).end(); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const body = await latest()
      res.statusCode = 200
      if (req.method === 'HEAD') res.end()
      else res.end(body)
    } catch {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'Virtual trading ledger temporarily unavailable' }))
    }
  }
  return host.register({ kind: 'prefix', path: ROUTE, handler })
}
