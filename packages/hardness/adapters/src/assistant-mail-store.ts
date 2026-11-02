/** Serialized private atomic JSON persistence for local mailbox state. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** File persistence with one owner per plugin instance. */
export class MailFile<T> {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly path: string, private readonly empty: () => T, private readonly parse: (value: unknown) => T) {}
  /** Read the latest committed state.
   * @returns Validated state.
   */
  async read(): Promise<T> { await this.tail; return this.load() }
  private async load(): Promise<T> {
    let source: string
    try { source = await readFile(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.empty()
      throw error
    }
    return this.parse(JSON.parse(source))
  }
  /** Serialize and atomically commit a mutation.
   * @param update Transformation of current durable state.
   * @returns Newly committed state.
   */
  change(update: (state: T) => T): Promise<T> {
    const next = this.tail.then(async () => {
      const state = this.parse(update(await this.load()))
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
      return state
    })
    this.tail = next.catch(() => { /* Mutation caller observes failure; later mutations can retry. */ })
    return next
  }
}

/** Narrow objects at wire and durable-file boundaries.
 * @param value Untrusted value.
 * @returns Object properties, or throws for non-record input.
 */
export function mailRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid mail data')
  return value as Record<string, unknown>
}
/** Read a bounded string at the mail wire boundary.
 * @param value Untrusted property.
 * @param limit Maximum character length.
 * @returns Validated nonempty string.
 */
export function mailString(value: unknown, limit = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) throw new Error('invalid mail string')
  return value
}
/** Canonicalize a single email address without trusting display names or recipient lists.
 * @param value Address or one provider display-name address.
 * @returns Canonical address.
 */
export function mailAddress(value: string): string {
  const address = (value.match(/^[^<>]*<([^<>]+)>$/u)?.[1] ?? value).trim().toLowerCase()
  if (address.length > 320 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/u.test(address)) throw new Error('invalid email address')
  return address
}
