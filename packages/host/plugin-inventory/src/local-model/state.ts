import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DEFAULT_LOCAL_MODEL_ID } from './catalog.js'
import type { LocalModelMode, LocalModelPersistentState } from './types.js'

/** Filesystem I/O required by the durable Phoenix Local state store. */
export interface LocalModelStateIo {
  statePath: string
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<unknown>
  rename(from: string, to: string): Promise<unknown>
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
}

/** Durable load/save contract for Phoenix Local runtime preferences. */
export interface LocalModelStateStore {
  load(): Promise<LocalModelPersistentState>
  save(state: LocalModelPersistentState): Promise<void>
}

const DEFAULT_STATE: Readonly<LocalModelPersistentState> = Object.freeze({
  mode: 'on-demand',
  selectedModelId: DEFAULT_LOCAL_MODEL_ID,
  installedModelIds: [],
})

function isMode(value: unknown): value is LocalModelMode {
  return value === 'off' || value === 'on-demand' || value === 'always-on'
}

function normalizeState(value: unknown): LocalModelPersistentState {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_STATE, installedModelIds: [] }
  const record = value as Record<string, unknown>
  const mode = isMode(record['mode']) ? record['mode'] : DEFAULT_STATE.mode
  const selectedModelId = typeof record['selectedModelId'] === 'string' && record['selectedModelId'].length > 0
    ? record['selectedModelId']
    : DEFAULT_STATE.selectedModelId
  const installedModelIds = Array.isArray(record['installedModelIds'])
    ? [...new Set(record['installedModelIds'].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))]
    : []
  return { mode, selectedModelId, installedModelIds }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

/**
 * Create an atomic JSON-backed Phoenix Local state store.
 * @param io - Filesystem operations and state path owned by the caller.
 * @returns A state store that normalizes reads and writes state atomically.
 */
export function createLocalModelStateStore(io: LocalModelStateIo): LocalModelStateStore {
  return {
    async load(): Promise<LocalModelPersistentState> {
      try {
        const raw = await io.readFile(io.statePath, 'utf8')
        return normalizeState(JSON.parse(raw) as unknown)
      } catch (error) {
        if (isMissingFile(error)) return { ...DEFAULT_STATE, installedModelIds: [] }
        throw error
      }
    },

    async save(state: LocalModelPersistentState): Promise<void> {
      const normalized = normalizeState(state)
      const directory = path.dirname(io.statePath)
      const temporaryPath = `${io.statePath}.tmp-${randomUUID()}`
      await io.mkdir(directory, { recursive: true })
      await io.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
      await io.rename(temporaryPath, io.statePath)
    },
  }
}
