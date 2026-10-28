import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import { wakeEvent } from './wake-engine.ts'

type Event = {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly at: number
  readonly seq: number
  readonly symbol?: string
}

/** A remote, isolated PAPER executor. This client has no real-order methods. */
export class BinanceCloudPaperClient {
  /** Validated HTTPS origin of the owner's isolated Cloud PAPER Worker. */
  readonly endpoint: string
  private readonly authToken: () => Promise<string | undefined>

  constructor(endpoint: string, authToken: () => Promise<string | undefined>) {
    const url = new URL(endpoint)
    // Do not let vault credentials follow a redirect or reach loopback, IPs,
    // local networks, arbitrary hosts or URL-embedded credentials.
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev')
      || url.port !== '' || url.username !== '' || url.password !== ''
      || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Cloud trading endpoint must be a dedicated HTTPS workers.dev domain')
    }
    this.endpoint = url.origin
    this.authToken = authToken
  }

  private async request(path: '/snapshot' | '/admin/control' | `/events?after=${number}`, action?: 'start' | 'stop'): Promise<unknown> {
    const token = await this.authToken()
    if (token === undefined || token.length < 32) {
      throw new Error('Cloud trading ADMIN_TOKEN is not connected to the Host credential vault')
    }
    const response = await fetch(this.endpoint + path, {
      method: action === undefined ? 'GET' : 'POST',
      redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: {
        authorization: `Bearer ${token}`,
        ...(action === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(action === undefined ? {} : { body: JSON.stringify({ action }) }),
    })
    if (!response.ok) throw new Error(`Cloud PAPER service unavailable or unauthorized (${response.status})`)
    return response.json() as Promise<unknown>
  }

  /**
   * Read host-independent market scanning, PAPER fills, and risk status.
   * @returns Bounded remote snapshot without exposure of credentials.
   */
  async snapshot(): Promise<unknown> { return this.request('/snapshot') }

  /**
   * Start or stop only the virtual cloud engine; never authorize real funds.
   * @param action - Owner-requested PAPER mode.
   * @returns Provider-verified control response.
   */
  async control(action: 'start' | 'stop'): Promise<unknown> { return this.request('/admin/control', action) }

  /**
   * Fetch bounded persisted cloud attention events.
   * @param after - Last processed D1 event sequence.
   * @returns Event objects already verified by the remote bearer-protected API.
   */
  async events(after = 0): Promise<{ readonly events: readonly Event[]; readonly nextCursor: number }> {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid Cloud PAPER cursor')
    const result = await this.request(`/events?after=${after}`)
    if (!result || typeof result !== 'object' || !('events' in result)
      || !Array.isArray(result.events) || result.events.length > 100) {
      throw new Error('Unexpected Cloud PAPER event response')
    }
    const cursor = 'nextCursor' in result ? result.nextCursor : undefined
    if (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < after) {
      throw new Error('Invalid cloud event cursor')
    }
    const events: Event[] = []
    for (const value of result.events) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'string' || row.id.length > 180
        || typeof row.kind !== 'string' || row.kind.length > 80
        || typeof row.summary !== 'string' || row.summary.length > 500
        || typeof row.at !== 'number' || !Number.isFinite(row.at)
        || typeof row.seq !== 'number' || !Number.isSafeInteger(row.seq)
        || row.seq <= after || row.seq > cursor
        || row.symbol !== undefined && typeof row.symbol !== 'string') continue
      events.push({
        id: row.id, kind: row.kind, summary: row.summary, at: row.at, seq: row.seq,
        ...(typeof row.symbol === 'string' ? { symbol: row.symbol } : {}),
      })
    }
    return { events, nextCursor: cursor }
  }
}

/**
 * Poll persistent Cloud PAPER events while Host is online, then replay them
 * through Phoenix's existing durable Kira Wake Bus. No LLM calls per tick.
 * Once the machine is off, cloud trading continues but Kira cannot wake
 * locally until the Host returns or an independent cloud agent is deployed.
 * @param ctx - Host with an installed wake event bus.
 * @param client - Bearer-protected Cloud PAPER service.
 * @param ledgerPath - Private event dedupe file persisted across restarts.
 * @returns Disposer that stops event polling.
 */
export function installBinanceCloudWakeBridge(
  ctx: Pick<Context, 'emit' | 'logger'>,
  client: BinanceCloudPaperClient,
  ledgerPath: string,
): () => void {
  let disposed = false
  let pending = false
  let timer: ReturnType<typeof setInterval> | undefined
  const seen = new Set<string>()
  let cursor = 0
  const hydrate = async (): Promise<void> => {
    try {
      const stored: unknown = JSON.parse(await readFile(ledgerPath, 'utf8'))
      if (stored !== null && typeof stored === 'object'
        && 'schema' in stored && stored.schema === 1
        && 'ids' in stored && Array.isArray(stored.ids)) {
        for (const id of stored.ids.filter((x: unknown): x is string => typeof x === 'string').slice(-500)) seen.add(id)
        if ('cursor' in stored && typeof stored.cursor === 'number'
          && Number.isSafeInteger(stored.cursor) && stored.cursor >= 0) {
          cursor = stored.cursor
        }
      }
    } catch { /* First startup or corrupt local dedupe ledger: Wake IDs remain stable. */ }
  }
  const persist = async (): Promise<void> => {
    await mkdir(dirname(ledgerPath), { recursive: true, mode: 0o700 })
    const temp = ledgerPath + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify({ schema: 1, cursor, ids: [...seen].slice(-500) }), { mode: 0o600 })
    await rename(temp, ledgerPath)
  }
  const isDisposed = (): boolean => disposed
  const poll = async (): Promise<void> => {
    if (disposed || pending) return
    pending = true
    try {
      // Each sync fetches at most 5 pages; large offline backlogs continue on
      // the next tick without starving the Host or the provider free tier.
      for (let page = 0; page < 5; page++) {
        const remote = await client.events(cursor)
        for (const event of remote.events) {
          if (isDisposed()) return
          if (!seen.has(event.id)
            && ['paper-entry', 'paper-exit', 'risk-review', 'risk-halt'].includes(event.kind)) {
            const at = new Date(event.at)
            if (Number.isFinite(at.getTime())) {
              ctx.emit('phoenix/wake-event', wakeEvent({
                id: 'binance-cloud:' + event.id,
                source: 'phoenix-trading', eventType: 'paper.attention',
                occurredAt: at.toISOString(), summary: event.summary,
                attributes: {
                  kind: event.kind, mode: 'paper', origin: 'cloud',
                  ...(event.symbol === undefined ? {} : { symbol: event.symbol }),
                },
              }))
            }
          }
          seen.add(event.id)
          if (seen.size > 500) {
            const oldest = seen.values().next()
            if (!oldest.done) seen.delete(oldest.value)
          }
          cursor = Math.max(cursor, event.seq)
          await persist()
        }
        if (remote.events.length < 100) break
      }
    } catch (error) {
      // Never log an HTTP bearer token, credentials or raw provider response.
      ctx.logger.warn('Binance Cloud PAPER event synchronization unavailable: '
        + (error instanceof Error ? error.name : 'unknown'))
    } finally { pending = false }
  }
  void hydrate().then(() => {
    if (disposed) return
    void poll()
    timer = setInterval(() => { void poll() }, 60_000)
    timer.unref()
  })
  return () => { disposed = true; if (timer !== undefined) clearInterval(timer) }
}
