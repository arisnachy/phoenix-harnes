/** Durable user choices for Loader entries across staged PHOENIX releases.
 * Only stable Loader ids, exact module names and booleans are stored here.
 * No executable/config object or provider credential is ever persisted.
 */
import { readFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'

export interface PluginEnablementChoice {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
}

const MAX_ENTRIES = 2048
const MAX_BYTES = 256_000

function readChoices(input: unknown): PluginEnablementChoice[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Plugin enablement preferences are invalid')
  }
  const record = input as { version?: unknown; entries?: unknown }
  if (record.version !== 1 || !Array.isArray(record.entries) || record.entries.length > MAX_ENTRIES) {
    throw new Error('Plugin enablement preferences use an unsupported format')
  }
  const seen = new Set<string>()
  return record.entries.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Invalid plugin enablement entry')
    }
    const choice = item as Record<string, unknown>
    if (typeof choice.entryId !== 'string' || choice.entryId.length < 1 || choice.entryId.length > 256
      || typeof choice.moduleName !== 'string' || choice.moduleName.length < 1
      || choice.moduleName.length > 300 || typeof choice.enabled !== 'boolean'
      || seen.has(choice.entryId)) {
      throw new Error('Invalid or duplicate plugin enablement entry')
    }
    seen.add(choice.entryId)
    return { entryId: choice.entryId, moduleName: choice.moduleName, enabled: choice.enabled }
  })
}

/** An independent preference store, not a replacement for Cordis Loader state. */
export class PluginEnablementStore {
  constructor(private readonly path: string = dshHomePath('settings', 'plugin-enablement.json')) {}

  /** Read current choices; missing file means no user overrides. */
  async list(): Promise<PluginEnablementChoice[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Plugin enablement preferences exceed size limit')
    return readChoices(JSON.parse(text) as unknown)
  }

  /** Update only the selected entry, serializing concurrent Host writers. */
  async save(choice: PluginEnablementChoice): Promise<void> {
    if (choice.entryId.length < 1 || choice.entryId.length > 256
      || choice.moduleName.length < 1 || choice.moduleName.length > 300) {
      throw new Error('Invalid plugin identity for persistence')
    }
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await withFileLock(this.path, async () => {
      const current = await this.list()
      const remaining = current.filter(entry => entry.entryId !== choice.entryId)
      const next = [...remaining, choice]
      if (next.length > MAX_ENTRIES) throw new Error('Too many plugin preferences')
      await writeFileAtomic(this.path, JSON.stringify({ version: 1, entries: next }, null, 2) + '\n',
        { mode: 0o600, dirMode: 0o700 })
    }, { waitMs: 15_000 })
  }
}
