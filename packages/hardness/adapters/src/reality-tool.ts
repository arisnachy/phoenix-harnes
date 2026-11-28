import { performance } from 'node:perf_hooks'
import type { Context } from '@phoenix-ai/cordis'
import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import type { RealityContextEngine } from './reality-context.ts'

const REALITY_FIELDS = ['time', 'location', 'weather', 'daylight', 'calendar', 'device', 'network', 'runtime', 'capabilities', 'authentication', 'phoenix', 'ai', 'region', 'userState'] as const

const DOWNLOAD_BYTES = 2_000_000
const DOWNLOAD_URL = 'https://speed.cloudflare.com/__down?bytes=2000000'

/** Explicit, bounded HTTPS throughput sample. No upload or periodic traffic. */
export async function measureInternetDownload(signal?: AbortSignal, request: typeof fetch = fetch): Promise<Record<string, JsonValue>> {
  const started = performance.now()
  let bytes = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const timeout = AbortSignal.timeout(12_000)
    const response = await request(DOWNLOAD_URL, { redirect: 'error', cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok || !response.body) throw Error('download-unavailable')
    reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > DOWNLOAD_BYTES) throw Error('download-size-mismatch')
    }
    if (bytes !== DOWNLOAD_BYTES) throw Error('download-incomplete')
    const elapsedMs = Math.max(1, performance.now() - started)
    return { status: 'measured', downloadMbps: Math.round(bytes * 8 / elapsedMs / 1000 * 100) / 100,
      uploadMbps: null, bytes, elapsedMs: Math.round(elapsedMs), source: DOWNLOAD_URL, observedAt: new Date().toISOString(),
      rule: 'Single HTTPS download sample including connection overhead; not maximum ISP capacity or upload speed.' }
  } catch {
    return { status: 'unavailable', downloadMbps: null, uploadMbps: null, bytes, source: DOWNLOAD_URL, observedAt: new Date().toISOString() }
  } finally {
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
}

/**
 * Create the read-only tool that waits for current Reality Context evidence.
 * Fresh mode respects signal TTLs; full mode deliberately reprobes every host
 * and runtime signal before returning.
 * @param engine - Reality Context engine used to refresh and snapshot evidence.
 * @param ctx - Cordis context supplying live runtime services.
 * @returns read-only model tool for synchronized Reality Context snapshots.
 */
export function createRealitySnapshotTool(
  engine: RealityContextEngine,
  ctx: Context,
): ToolDefinition {
  return defineTool({
    name: 'phoenix_reality_now',
    description: 'Read Phoenix\'s current verified Reality Context. Use this before an environment-sensitive decision when the prompt snapshot is stale, unknown, or the action is high-impact. mode=fresh waits for due probes while respecting TTLs; mode=full forces all configured host/runtime probes to run again. mode=location resolves geographic names locally from public GeoNames data for an authorized position. mode=bandwidth explicitly runs a bounded 2 MB HTTPS download sample only when the user requests internet speed. This tool is read-only and never grants permissions. For small context windows request one field, optionally an exact key within it; no field preserves the complete legacy snapshot.',
    parameters: {
      field: {
        type: 'string',
        enum: [...REALITY_FIELDS],
        description: 'Optional exact snapshot section; omit for the complete snapshot.',
      },
      key: {
        type: 'string',
        description: 'Optional exact property within field; useful for large inventories. Omit for the whole field.',
      },
      mode: {
        type: 'string',
        enum: ['fresh', 'full', 'location', 'bandwidth'],
        description: 'fresh = refresh only expired/missing signals; full = force every configured Reality Context probe now; location = resolve a permitted position to city, province, country and nearby district (downloads public datasets if missing); bandwidth = explicit 2 MB download measurement (not upload).',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (args.mode === 'bandwidth') return await measureInternetDownload(exec.signal)
      const assembly = exec.agent === undefined ? undefined : { agent: exec.agent }
      if (args.mode === 'location') await engine.refreshLocationNames(ctx, assembly)
      else await engine.refreshNow(ctx, args.mode === 'full', assembly)
      const snapshot = engine.snapshot(
        ctx,
        new Date(),
        assembly,
      )
      const serialized = JSON.parse(JSON.stringify(snapshot)) as Record<string, JsonValue>
      const field = args.field
      if (typeof field !== 'string') return serialized
      if (!REALITY_FIELDS.some(name => name === field)) return { status: 'unknown-field', fields: [...REALITY_FIELDS] }
      const value = serialized[field]
      if (typeof args.key !== 'string') return { schema: 1, generatedAt: serialized.generatedAt ?? null, field, value: value ?? null }
      const key = args.key
      const record = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
      const found = record !== undefined && Object.hasOwn(record, key)
      return { schema: 1, generatedAt: serialized.generatedAt ?? null, field, key,
        status: found ? 'available' : 'unknown-key', value: found ? record?.[key] ?? null : null }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.mode === 'bandwidth' ? 'Measure internet download speed' : args.mode === 'location' ? 'Resolve geographic place' : args.mode === 'full' ? 'Refresh full reality state' : 'Refresh reality state',
        kind: 'read',
      }
    },
  })
}
