/** Durable acknowledgement of material home-feed revisions. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Acknowledgement applies only to the exact material revision selected by the user. */
export interface AttentionReceipt {
  readonly itemId: string
  readonly revision: string
  readonly state: 'handled' | 'working' | 'resolved' | 'dismissed'
}

/** Parse a receipt at the file/RPC boundary.
 * @param value Untrusted receipt.
 * @returns Validated receipt, or undefined for invalid input.
 */
export function parseAttentionReceipt(value: unknown): AttentionReceipt | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.itemId !== 'string' || row.itemId.length === 0 || row.itemId.length > 1024
    || typeof row.revision !== 'string' || row.revision.length === 0 || row.revision.length > 1024
    || !['handled', 'working', 'resolved', 'dismissed'].includes(String(row.state))) return undefined
  return { itemId: row.itemId, revision: row.revision, state: row.state as AttentionReceipt['state'] }
}

/** Serialized file-backed receipts; invalid files fail rather than losing acknowledgements. */
export class AttentionStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string) {}

  /** Read committed receipts.
   * @returns Receipts from the durable store.
   */
  async read(): Promise<readonly AttentionReceipt[]> {
    await this.tail
    return this.load()
  }

  private async load(): Promise<AttentionReceipt[]> {
    let source: string
    try { source = await readFile(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const data: unknown = JSON.parse(source)
    if (!Array.isArray(data)) throw new Error('invalid attention receipt ledger')
    return data.map((value) => {
      const receipt = parseAttentionReceipt(value)
      if (receipt === undefined) throw new Error('invalid attention receipt')
      return receipt
    })
  }

  /** Persist one receipt after earlier writes settle.
   * @param receipt Acknowledgement of an exact revision.
   */
  record(receipt: AttentionReceipt): Promise<void> {
    const next = this.tail.then(async () => {
      const rows = await this.load()
      const filtered = rows.filter(row => row.itemId !== receipt.itemId || row.revision !== receipt.revision)
      filtered.push(receipt)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(filtered)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    this.tail = next.catch(() => { /* Caller receives the failed write; subsequent operations may retry. */ })
    return next
  }

  /** Remove acknowledged revisions without suppressing future material changes.
   * @param items Current home-feed items.
   * @returns Unacknowledged items in their original order.
   */
  async filter<T extends { readonly id: string; readonly revision: string }>(items: readonly T[]): Promise<T[]> {
    const receipts = await this.read()
    return items.filter(item => !receipts.some(row => row.itemId === item.id && row.revision === item.revision))
  }
}
