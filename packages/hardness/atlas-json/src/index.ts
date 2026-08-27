/** Durable atomic JSON persistence for the HARDNESS Tool Atlas. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HardnessAtlasSnapshot } from '@deepseek-ai/dsh-hardness'
import { parseAtlasSnapshot } from './format.ts'

export class JsonDocumentStore<T> {
  constructor(
    private readonly path: string,
    private readonly parse: (value: unknown) => T,
    private readonly empty?: T,
  ) {}

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

  async save(value: T): Promise<void> {
    const normalized = this.parse(value)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = join(dirname(this.path), `.${this.path.split(/[\\/]/).pop() ?? 'document'}.${process.pid}.tmp`)
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}

export class JsonAtlasStore {
  constructor(private readonly path: string) {}

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

  async save(snapshot: HardnessAtlasSnapshot): Promise<void> {
    const normalized = parseAtlasSnapshot(snapshot)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = join(dirname(this.path), `.${this.path.split(/[\\/]/).pop() ?? 'atlas'}.${process.pid}.tmp`)
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}
