/** Bounded passive telemetry journal. No discovery packets or router actions are sent. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import process from 'node:process'

type Snapshot = {
  at: number
  scope: string | null
  neighbors: number
  rx: number | null
  tx: number | null
  added: number | null
  missing: number | null
}
type ReadSample = () => Promise<unknown>
type Store = { read: () => Promise<unknown>; write: (rows: Snapshot[]) => Promise<void> }
const MAX_ROWS = 1440
const MAX_AGE = 86400000
const bounded = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
function row(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const at = bounded(value.at)
  const neighbors = bounded(value.neighbors)
  if (at === null || neighbors === null || neighbors > 512) return null
  return { at, neighbors, scope: typeof value.scope === 'string' && /^[a-f0-9]{24}$/u.test(value.scope) ? value.scope : null, rx: bounded(value.rx), tx: bounded(value.tx), added: bounded(value.added), missing: bounded(value.missing) }
}
function localStore(): Store | null {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null
  const path = join(process.env.LOCALAPPDATA, 'PHOENIX', 'network', 'samples-v1.json')
  return {
    async read() {
      try {
        const bytes = await readFile(path)
        return bytes.byteLength <= 262144 ? JSON.parse(bytes.toString('utf8')) as unknown : []
      } catch { return [] /* no usable history */ }
    },
    async write(rows) {
      await mkdir(dirname(path), { recursive: true })
      const temp = path + '.' + randomUUID() + '.tmp'
      await writeFile(temp, JSON.stringify(rows), { flag: 'wx' })
      await rename(temp, path)
    },
  }
}
/** Passive monitoring while the Host is running; teardown stops sampling. */
export class NetworkWatch {
  private samples: Snapshot[] = []
  private pending: Promise<void> | null = null
  private stopped = false
  private hydrated = false
  private unavailable = false
  private persistence = false
  constructor(private readonly sample: ReadSample, private readonly store: Store | null = localStore(),
    private readonly now: () => number = Date.now) {}
  private trim(rows: Snapshot[]) {
    const time = this.now()
    return rows.filter(x => x.at <= time && x.at >= time - MAX_AGE).sort((a, b) => a.at - b.at).slice(-MAX_ROWS)
  }
  /** Sample once, coalescing simultaneous reads. */
  tick(): Promise<void> {
    if (this.pending) return this.pending
    if (this.stopped) return Promise.resolve()
    const work = this.collect()
    this.pending = work
    void work.finally(() => { if (this.pending === work) this.pending = null })
    return work
  }
  private async collect(): Promise<void> {
    try {
      if (!this.hydrated) {
        const old = await this.store?.read()
        this.samples = this.trim(Array.isArray(old) ? old.slice(-MAX_ROWS).map(row).filter(x => x !== null) : [])
        this.hydrated = true
      }
      if (this.stopped) return
      const result = await this.sample()
      if (this.stopped) return
      const p = result && typeof result === 'object' ? result as Record<string, unknown> : {}
      const count = bounded(p.neighborCount)
      this.unavailable = p.status !== 'completed' || count === null
      if (this.unavailable || count === null) return
      const fresh = row({
        at: this.now(), neighbors: count, scope: p.networkScope,
        rx: p.receivedBytesPerSecond, tx: p.sentBytesPerSecond,
        added: Array.isArray(p.newlyObserved) ? p.newlyObserved.length : null,
        missing: Array.isArray(p.noLongerObserved) ? p.noLongerObserved.length : null,
      })
      if (!fresh) return
      this.samples = this.trim([...this.samples, fresh])
      if (this.store) {
        try {
          await this.store.write(this.samples)
          this.persistence = true
        } catch { this.persistence = false /* retain memory-only evidence */ }
      }
    } catch { this.unavailable = true /* report degraded sampling */ }
  }
  /** Begin a passive one-minute Host-owned observer; the disposer stops future work. */
  start(): () => void {
    void this.tick()
    const timer = setInterval(() => { void this.tick() }, 60000)
    timer.unref()
    return () => { this.stopped = true; clearInterval(timer) }
  }
  /** Read at most 60 aggregate samples and clearly disclose stale or mixed-network history. */
  report() {
    const samples = this.trim(this.samples)
    const latest = samples.at(-1) ?? null
    const fresh = !!latest && !this.unavailable && this.now() - latest.at <= 180000
    const earlier = fresh && latest && latest.scope ? samples.slice(0,-1).filter(x=>x.scope===latest.scope && latest.at-x.at<=3600000) : []
    const alerts: { kind: string; evidence: string; observed: number; baseline?: number }[] = []
    if (fresh && latest && latest.scope && latest.added !== null && latest.added >= 5)
      alerts.push({ kind:'neighbor-cache-growth', evidence:'New cache entries, not verified new devices', observed:latest.added })
    for (const metric of ['rx','tx'] as const) {
      const values=earlier.map(x=>x[metric]).filter((v):v is number=>v!==null).sort((a,b)=>a-b)
      const median=values[Math.floor(values.length/2)]
      const current=latest?.[metric]
      if(fresh && values.length>=10 && median!==undefined && current!=null && current>=1048576 && current>=5*Math.max(median,1))
        alerts.push({kind:'host-traffic-spike-'+metric,evidence:'Host bytes/s vs same-scope recent median; not evidence of intrusion',observed:current,baseline:median})
    }
    return {
      alerts,
      status: this.unavailable || !latest || this.now() - latest.at > 180000 ? 'degraded' : 'completed',
      persisted: this.persistence, retainedSamples: samples.length, latest,
      history: samples.slice(-60),
      limitations: ['Passive neighbor cache, not a census. Missing entries do not prove disconnect.',
        'Traffic is the host interface only. History can include multiple network scopes. Alerts are observational, not intrusion findings. No packet contents or device names stored.'],
    }
  }
}
