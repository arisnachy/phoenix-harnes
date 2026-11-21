/**
 * PHOENIX Adaptive OS — persistent, configuration-only app blueprints.
 *
 * Browser storage is NOT an EHR, executable plugin installer, trust anchor,
 * secure vault, or permission registry. Never store clinical values or keys.
 */
import { createAdaptiveAppBlueprint, type AdaptiveAppBlueprint } from './AdaptiveAppCatalog.ts'

const CURRENT = 'phoenix.adaptive.apps.v1'
const BACKUP = 'phoenix.adaptive.apps.last-good.v1'
const ROLLBACK = 'phoenix.adaptive.apps.pre-change.v1'
const MAX_APPS = 24
const MAX_BYTES = 48_000

type Store = Pick<Storage, 'getItem' | 'setItem'>
function validMenuLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value
    && value.length > 0 && value.length <= 60
    && !/[\\u0000-\\u001f\\u007f]/u.test(value)
}


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
      if (item.sections.length < 1 || item.sections.length > 12) return null
      const sections = item.sections.map((section: unknown) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error('SECTION')
        const x = section as Record<string, unknown>
        if (Object.keys(x).some(key => !['id','label'].includes(key))
          || typeof x.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(x.id)
          || !validMenuLabel(x.label)) throw new Error('SECTION')
        return {id:x.id,label:x.label}
      })
      const recreated = createAdaptiveAppBlueprint(item.title,['Inicio'])
      if (recreated.id !== item.id || result.some(app => app.id === recreated.id)
        || new Set(sections.map(x => x.id)).size !== sections.length
        || new Set(sections.map(x => x.label.toLocaleLowerCase('es'))).size !== sections.length) return null
      result.push({...recreated,sections})
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

function commitApps(store: Store, previous: readonly AdaptiveAppBlueprint[], next: readonly AdaptiveAppBlueprint[]): void {
  const old = JSON.stringify({version:1,apps:previous})
  const serialized = JSON.stringify({version:1,apps:next})
  if (serialized.length > MAX_BYTES || parse(serialized) === null) throw new Error('ADAPTIVE_INVALID_SNAPSHOT')
  store.setItem(ROLLBACK,old)
  store.setItem(BACKUP,old)
  store.setItem(CURRENT,serialized)
  try { store.setItem(BACKUP,serialized) } catch { /* previous snapshot remains */ }
}
/** Restore exactly the previous validated UI state after a repeated app crash. */
export function restorePreviousAdaptiveApps(store: Store | undefined = browserStore()): readonly AdaptiveAppBlueprint[] {
  if (!store) return []
  const previous = parse(store.getItem(ROLLBACK))
  if (previous === null) return readAdaptiveApps(store)
  const raw = JSON.stringify({version:1,apps:previous})
  store.setItem(CURRENT,raw)
  store.setItem(BACKUP,raw)
  return previous
}

/** Explicit user-click installation of configuration ONLY, with last-good recovery. */
export function installAdaptiveApp(app: AdaptiveAppBlueprint, store: Store | undefined = browserStore()): readonly AdaptiveAppBlueprint[] {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  if (Object.keys(app).some(key => !['version', 'id', 'title', 'status', 'sections'].includes(key))
    || app.sections.some(section => Object.keys(section).some(key => !['id', 'label'].includes(key))))
    throw new Error('ADAPTIVE_INVALID_BLUEPRINT')
  const rebuilt = createAdaptiveAppBlueprint(app.title, app.sections.map(section => section.label))
  if (rebuilt.id !== app.id || rebuilt.sections.some((s, i) => s.id !== app.sections[i]?.id)
    || app.version !== 1 || app.status !== 'preview-only') throw new Error('ADAPTIVE_INVALID_BLUEPRINT')
  const previous = readAdaptiveApps(store)
  if (previous.some(item => item.id === app.id)) throw new Error('ADAPTIVE_APP_EXISTS')
  if (previous.length >= MAX_APPS) throw new Error('ADAPTIVE_APP_LIMIT')
  const next = [...previous, rebuilt]
  commitApps(store,previous,next)
  return next
}

/** Remove only a nonclinical application declaration. Not a data deletion API. */
export function removeAdaptiveApp(appId: string, store: Store | undefined = browserStore()): readonly AdaptiveAppBlueprint[] {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  const previous = readAdaptiveApps(store)
  if (!previous.some(app => app.id === appId)) throw new Error('ADAPTIVE_UNKNOWN_APP')
  const next = previous.filter(app => app.id !== appId)
  commitApps(store,previous,next)
  return next
}

/** Append a menu item without editing application code, preserving its ID. */
export function appendAdaptiveSection(
  appId: string, label: string, store: Store | undefined = browserStore(),
): AdaptiveAppBlueprint {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  const current = readAdaptiveApps(store)
  const app = current.find(item => item.id === appId)
  if (!app) throw new Error('ADAPTIVE_UNKNOWN_APP')
  if (app.sections.length >= 12 || !validMenuLabel(label)) throw new Error('ADAPTIVE_INVALID_SECTION')
  const section = createAdaptiveAppBlueprint(app.title,[label]).sections[0]!
  if (app.sections.some(item => item.id === section.id
    || item.label.toLocaleLowerCase('es') === label.toLocaleLowerCase('es'))) {
    throw new Error('ADAPTIVE_DUPLICATE_SECTION')
  }
  const changed: AdaptiveAppBlueprint = {...app,sections:[...app.sections,section]}
  commitApps(store,current,current.map(item => item.id === app.id ? changed : item))
  return changed
}

export function renameAdaptiveSection(
  appId: string, sectionId: string, label: string, store: Store | undefined = browserStore(),
): AdaptiveAppBlueprint {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  const current = readAdaptiveApps(store)
  const app = current.find(item => item.id === appId)
  if (!app || !app.sections.some(item => item.id === sectionId) || !validMenuLabel(label)
    || app.sections.some(item => item.id !== sectionId &&
      item.label.toLocaleLowerCase('es') === label.toLocaleLowerCase('es'))) {
    throw new Error('ADAPTIVE_INVALID_SECTION')
  }
  const changed: AdaptiveAppBlueprint = {...app,sections:app.sections.map(item =>
    item.id === sectionId ? {...item,label} : item)}
  commitApps(store,current,current.map(item => item.id === app.id ? changed : item))
  return changed
}
export function removeAdaptiveSection(
  appId: string, sectionId: string, store: Store | undefined = browserStore(),
): AdaptiveAppBlueprint {
  if (!store) throw new Error('ADAPTIVE_STORAGE_UNAVAILABLE')
  const current = readAdaptiveApps(store)
  const app = current.find(item => item.id === appId)
  if (!app || app.sections.length <= 1 || !app.sections.some(item => item.id === sectionId)) {
    throw new Error('ADAPTIVE_INVALID_SECTION')
  }
  // Form definitions are retained for recovery; this only hides navigation.
  const changed: AdaptiveAppBlueprint = {...app,sections:app.sections.filter(item => item.id !== sectionId)}
  commitApps(store,current,current.map(item => item.id === app.id ? changed : item))
  return changed
}
