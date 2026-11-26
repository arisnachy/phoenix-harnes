/**
 * Private, bounded Nexus transport receipts in the existing harness home.
 * No messages, credentials, session IDs, or provider-reported balances are stored.
 * @module @phoenix-ai/dsh-llm-pi-ai/nexus-receipts
 */
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import type { NexusUsage } from './nexus.ts'

const RETENTION_MS = 8 * 24 * 3_600_000
const MAX_RECEIPTS = 10_000
const MAX_BYTES = 8_000_000

/** Transport success is not semantic answer quality. */
export interface NexusTransportReceipt extends NexusUsage {
  readonly latencyMs: number
  readonly succeeded: boolean
  readonly usageReported: boolean
  /** Independent exact-response acceptance, when the task has an explicit answer key. */
  readonly exactResponseAccepted?: boolean
  /** Deterministically graded bounded arithmetic, separate from exact instruction following. */
  readonly numericResponseAccepted?: boolean
}

function isReceipt(value: unknown): value is NexusTransportReceipt {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Partial<NexusTransportReceipt>
  return typeof r.provider === 'string' && r.provider.length <= 256
    && typeof r.model === 'string' && r.model.length <= 512
    && typeof r.succeeded === 'boolean'
    && typeof r.usageReported === 'boolean'
    && (r.exactResponseAccepted === undefined || typeof r.exactResponseAccepted === 'boolean')
    && (r.numericResponseAccepted === undefined || typeof r.numericResponseAccepted === 'boolean')
    && [r.timestamp, r.inputTokens, r.outputTokens, r.latencyMs].every(
      v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
    )
}

/** Persist only locally measured, versioned numeric observations. */
export class NexusReceiptStore {
  /** @param filename - private receipt file under the harness home. */
  constructor(private readonly filename: string) {}

  /**
   * Load surviving observations, refusing incompatible or corrupted files.
   * @param now - current timestamp in milliseconds.
   * @returns validated bounded observations.
   */
  async read(now: number): Promise<NexusTransportReceipt[]> {
    try {
      if ((await stat(this.filename)).size > MAX_BYTES) throw new Error('Nexus receipt file exceeds limit')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const raw: unknown = JSON.parse(await readFile(this.filename, 'utf8'))
    if (typeof raw !== 'object' || raw === null || !('version' in raw) || raw.version !== 1
      || !('receipts' in raw) || !Array.isArray(raw.receipts)) throw new Error('Invalid Nexus receipt file')
    return raw.receipts.filter(isReceipt)
      .filter(r => r.timestamp >= now - RETENTION_MS && r.timestamp <= now)
      .slice(-MAX_RECEIPTS)
  }

  /**
   * Atomically merge a new receipt with observations from other Host processes.
   * @param receipt - completed request transport observation.
   */
  async record(receipt: NexusTransportReceipt): Promise<void> {
    if (!isReceipt(receipt)) throw new Error('Invalid Nexus receipt')
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await withFileLock(this.filename, async () => {
      const previous = await this.read(Date.now())
      const receipts = [...previous, receipt].slice(-MAX_RECEIPTS)
      await writeFileAtomic(this.filename, JSON.stringify({ version: 1, receipts }), {
        mode: 0o600, dirMode: 0o700,
      })
    }, { waitMs: 1_000 })
  }
}
