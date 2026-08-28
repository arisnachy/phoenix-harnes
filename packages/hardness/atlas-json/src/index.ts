/** Durable atomic JSON persistence for the HARDNESS Tool Atlas. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HardnessAtlasSnapshot } from '@deepseek-ai/dsh-hardness'
import { parseAtlasSnapshot } from './format.ts'

/** Generic atomic JSON document store with caller-owned parsing. */
export class JsonDocumentStore<T> {
  constructor(
    private readonly path: string,
    private readonly parse: (value: unknown) => T,
    private readonly empty?: T,
  ) {}

  /**
   * Load and parse the stored JSON document.
   * @returns parsed document, or the configured empty value when absent.
   */
  async load(): Promise<T> {
    let content: string
    try {
      content = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && this.empty !== undefined) return this.empty
      throw error
    }
    return this.parse(JSON.parse(content) as unknown)
  }

  /**
   * Validate and atomically save one JSON document.
   * @param value - document value accepted by the configured parser.
   * @returns completion after the atomic rename succeeds.
   */
  async save(value: T): Promise<void> {
    const normalized = this.parse(value)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = join(dirname(this.path), `.${this.path.split(/[\\/]/).pop() ?? 'document'}.${process.pid}.tmp`)
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}

/** Atomic versioned JSON store specialized for HARDNESS atlas snapshots. */
export class JsonAtlasStore {
  constructor(private readonly path: string) {}

  /**
   * Load the durable atlas, returning an empty version-one snapshot when absent.
   * @returns validated HARDNESS atlas snapshot.
   */
  async load(): Promise<HardnessAtlasSnapshot> {
    let content: string
    try {
      content = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { formatVersion: 1, capabilities: [], evidence: [] }
      throw error
    }
    try {
      return parseAtlasSnapshot(JSON.parse(content) as unknown)
    } catch (error) {
      throw new Error(`corrupt HARDNESS atlas at ${this.path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Validate and atomically persist the HARDNESS atlas snapshot.
   * @param snapshot - versioned atlas snapshot to persist.
   * @returns completion after the atomic rename succeeds.
   */
  async save(snapshot: HardnessAtlasSnapshot): Promise<void> {
    const normalized = parseAtlasSnapshot(snapshot)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = join(dirname(this.path), `.${this.path.split(/[\\/]/).pop() ?? 'atlas'}.${process.pid}.tmp`)
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}
