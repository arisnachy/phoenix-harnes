/**
 * PHOENIX Adaptive OS — persistent, configuration-only app blueprints.
 *
 * Browser storage is NOT an EHR, executable plugin installer, trust anchor,
 * secure vault, or permission registry. Never store clinical values or keys.
 */
import { createAdaptiveAppBlueprint, type AdaptiveAppBlueprint } from './AdaptiveAppCatalog.ts'

const CURRENT = 'phoenix.adaptive.apps.v1'
const BACKUP = 'phoenix.adaptive.apps.last-good.v1'
const MAX_APPS = 24
const MAX_BYTES = 48_000

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserStore(): Store | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage }
  catch { return undefined }
}

function parse(raw: string | null): readonly AdaptiveAppBlueprint[] | null {
  if (raw === null || raw.length > MAX_BYTES) return null
  try {
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null
    const data = envelope as Record<string, unknown>
    if (Object.keys(data).some(key => key !== 'version' && key !== 'apps')
      || data.version !== 1 || !Array.isArray(data.apps) || data.apps.length > MAX_APPS) return null
    const result: AdaptiveAppBlueprint[] = []
    for (const value of data.apps) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const item = value as Record<string, unknown>
      if (Object.keys(item).some(key => !['version','id','title','status','sections'].includes(key))
        || item.version !== 1 || item.status !== 'preview-only'
        || typeof item.title !== 'string' || !Array.isArray(item.sections)) return null
      const sections = item.sections.map((section: unknown) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return null
        const x = section as Record<string, unknown>
        if (Object.keys(x).some(key => !['id', 'label'].includes(key))
          || typeof x.id !== 'string' || typeof x.label !== 'string') return null
        return { id: x.id, label: x.label }
      })
      if (sections.some(section => section === null)) return null
      const recreated = createAdaptiveAppBlueprint(item.title, sections.map(section => section!.label))
      if (recreated.id !== item.id || recreated.sections.some((s, i) => s.id !== sections[i]!.id)
        || result.some(app => app.id === recreated.id)) return null
      result.push(recreated)
    }
    return result
  } catch { return null }
}

/** Safe fallback: an incomplete or tampered current snapshot cannot hide a valid backup. */
export function readAdaptiveApps(store: Store | undefined = browserStore()): readonly AdaptiveAppBlueprint[] {
  if (!store) return []
  try { return parse(store.getItem(CURRENT)) ?? parse(store.getItem(BACKUP)) ?? [] }
  catch { return [] }
}

/** Explicit user-click installation of configuration ONLY, with last-good recovery. */
export function installAdaptiveApp(app: AdaptiveAppBlueprint, store: Store | undefined = browserStore()): readonly AdaptiveAppBlueprint[] {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  const rebuilt = createAdaptiveAppBlueprint(app.title, app.sections.map(section => section.label))
  if (rebuilt.id !== app.id || rebuilt.sections.some((s, i) => s.id !== app.sections[i]?.id)
    || app.version !== 1 || app.status !== 'preview-only') throw new Error('ADAPTIVE_INVALID_BLUEPRINT')
  const previous = readAdaptiveApps(store)
  if (previous.some(item => item.id === app.id)) throw new Error('ADAPTIVE_APP_EXISTS')
  if (previous.length >= MAX_APPS) throw new Error('ADAPTIVE_APP_LIMIT')
  const next = [...previous, rebuilt]
  const serialized = JSON.stringify({ version: 1, apps: next })
  if (serialized.length > MAX_BYTES) throw new Error('ADAPTIVE_APP_LIMIT')
  // Backup is committed before the new snapshot. A write failure leaves old
  // CURRENT intact or BACKUP recoverable; no state is promoted on error.
  store.setItem(BACKUP, JSON.stringify({ version: 1, apps: previous }))
  store.setItem(CURRENT, serialized)
  return next
}

/** Remove only a nonclinical application declaration. Not a data deletion API. */
export function removeAdaptiveApp(appId: string, store: Store | undefined = browserStore()): readonly AdaptiveAppBlueprint[] {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  const previous = readAdaptiveApps(store)
  if (!previous.some(app => app.id === appId)) throw new Error('ADAPTIVE_UNKNOWN_APP')
  const next = previous.filter(app => app.id !== appId)
  store.setItem(BACKUP, JSON.stringify({ version: 1, apps: previous }))
  store.setItem(CURRENT, JSON.stringify({ version: 1, apps: next }))
  return next
}
