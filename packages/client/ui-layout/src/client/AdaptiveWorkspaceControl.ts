/**
 * PHOENIX Adaptive Workspace — deterministic preflight for chat-proposed UI
 * controls. This is NOT permission to execute arbitrary code or use an API.
 * Chat events are treated as untrusted and revalidated at the layout boundary.
 */
import { createAdaptiveAppBlueprint, validateAdaptiveDraft, type AdaptiveAppBlueprint,
  type AdaptiveFormDraft, type AdaptiveDestination, type AdaptiveOutput } from './AdaptiveAppCatalog.ts'
import { readAdaptiveApps } from './AdaptiveAppRegistry.ts'
import { readAdaptiveForm, saveAdaptiveForm } from './AdaptiveFormMetadataStore.ts'

export const ADAPTIVE_PALETTES = {
  pearl: { accent: '#bc471c', tint: '#fff1e8', ink: '#532312' },
  ocean: { accent: '#16658a', tint: '#e6f4fb', ink: '#123d59' },
  sage: { accent: '#316c4c', tint: '#eaf5ec', ink: '#1b472f' },
  iris: { accent: '#6941a3', tint: '#f1ecfb', ink: '#412665' },
  amber: { accent: '#89510d', tint: '#fff4dc', ink: '#55340e' },
} as const
export type AdaptivePalette = keyof typeof ADAPTIVE_PALETTES
export type AdaptiveControlOperation =
  'open' | 'find' | 'add-section' | 'palette' | 'rename-field' | 'remove-field' | 'set-binding'
export interface AdaptiveControlCommand {
  readonly appId: string
  readonly operation: AdaptiveControlOperation
  readonly sectionId?: string
  readonly fieldId?: string
  readonly label?: string
  readonly query?: string
  readonly palette?: AdaptivePalette
  readonly destination?: AdaptiveDestination
  readonly output?: AdaptiveOutput
  readonly expectedRevision?: number
}
type StorageLike = Pick<Storage,'getItem'|'setItem'>
const PREFS_KEY = 'phoenix.adaptive.theme.v1'
const ID = /^[a-z][a-z0-9-]{0,47}$/u
const APP = /^app-[a-z0-9-]{1,45}$/u
const LABEL = /^[^\u0000-\u001f\u007f]{1,60}$/u
const DEST = ['local','api','chat','ai']
const OUTPUT = ['inline','table','document','chat']
function validLabel(text: unknown): text is string {
  return typeof text === 'string' && text === text.trim() && LABEL.test(text)
}
function onlyKeys(v: object, keys: readonly string[]): boolean {
  return Object.keys(v).every(key => keys.includes(key))
}
function storeOrUndefined(): StorageLike | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

/** Parse every possible operation separately; ignore extra/unknown fields. */
export function parseAdaptiveControl(value: unknown): AdaptiveControlCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.appId !== 'string' || !['general','healthia'].includes(v.appId) && !APP.test(v.appId)
      || !['open','find','add-section','palette','rename-field','remove-field','set-binding'].includes(v.operation as string)) return null
  const op = v.operation as AdaptiveControlOperation
  const base = ['appId','operation']
  let keys = base
  if (op === 'open') keys = [...base,'sectionId']
  if (op === 'find') keys = [...base,'query']
  if (op === 'palette') keys = [...base,'palette']
  if (op === 'add-section') keys = [...base,'label']
  if (op === 'rename-field') keys = [...base,'sectionId','fieldId','label','expectedRevision']
  if (op === 'remove-field') keys = [...base,'sectionId','fieldId','expectedRevision']
  if (op === 'set-binding') keys = [...base,'sectionId','fieldId','destination','output','expectedRevision']
  if (!onlyKeys(v,keys)) return null
  if (op !== 'open' && op !== 'find' && !APP.test(v.appId)) return null
  if (op === 'open' && v.sectionId !== undefined && (typeof v.sectionId !== 'string' || !ID.test(v.sectionId))) return null
  if (op === 'find' && !validLabel(v.query)) return null
  if (op === 'palette' && (typeof v.palette !== 'string' || !Object.hasOwn(ADAPTIVE_PALETTES, v.palette))) return null
  if (op === 'add-section' && !validLabel(v.label)) return null
  if (['rename-field','remove-field','set-binding'].includes(op)) {
    if (typeof v.sectionId !== 'string' || !ID.test(v.sectionId)
      || typeof v.fieldId !== 'string' || !ID.test(v.fieldId)
      || !Number.isSafeInteger(v.expectedRevision) || (v.expectedRevision as number) < 0) return null
  }
  if (op === 'rename-field' && !validLabel(v.label)) return null
  if (op === 'set-binding' && (!DEST.includes(v.destination as string) || !OUTPUT.includes(v.output as string))) return null
  return v as unknown as AdaptiveControlCommand
}

export interface AdaptiveDiscovery {
  readonly kind: 'app' | 'section' | 'field'
  readonly appId: string
  readonly sectionId?: string
  readonly fieldId?: string
  readonly label: string
}

/** Never indexes patient values, private records, credentials or general chat. */
export function findAdaptiveMetadata(query: string, apps: readonly AdaptiveAppBlueprint[] = readAdaptiveApps(),
  formReader: typeof readAdaptiveForm = readAdaptiveForm): readonly AdaptiveDiscovery[] {
  if (!validLabel(query)) return []
  const term = query.toLocaleLowerCase('es')
  const results: AdaptiveDiscovery[] = []
  for (const app of apps) {
    if (app.title.toLocaleLowerCase('es').includes(term)) results.push({ kind:'app', appId:app.id, label:app.title })
    for (const section of app.sections) {
      if (section.label.toLocaleLowerCase('es').includes(term)) {
        results.push({ kind:'section', appId:app.id, sectionId:section.id, label:section.label })
      }
      const fields = formReader(app.id, section.id)?.fields ?? []
      for (const field of fields) if (field.label.toLocaleLowerCase('es').includes(term)) {
        results.push({ kind:'field', appId:app.id, sectionId:section.id, fieldId:field.id, label:field.label })
      }
      if (results.length >= 30) return results
    }
  }
  return results
}

function themes(raw: string | null): Record<string, AdaptivePalette> {
  if (!raw || raw.length > 4000) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const values: Record<string,AdaptivePalette> = {}
    for (const [key,value] of Object.entries(parsed)) {
      if (APP.test(key) && typeof value === 'string' && Object.hasOwn(ADAPTIVE_PALETTES,value)) {
        values[key] = value as AdaptivePalette
      }
    }
    return values
  } catch { return {} }
}
export function readAdaptivePalette(id: string, store: StorageLike | undefined = storeOrUndefined()): AdaptivePalette {
  if (!store || !APP.test(id)) return 'pearl'
  try { return themes(store.getItem(PREFS_KEY))[id] ?? 'pearl' } catch { return 'pearl' }
}
export function saveAdaptivePalette(id: string, palette: AdaptivePalette, store: StorageLike | undefined = storeOrUndefined()): AdaptivePalette {
  if (!store || !APP.test(id) || !Object.hasOwn(ADAPTIVE_PALETTES,palette)) throw new Error('ADAPTIVE_THEME_DENIED')
  const saved = themes(store.getItem(PREFS_KEY))
  saved[id] = palette
  if (Object.keys(saved).length > 24) throw new Error('ADAPTIVE_THEME_LIMIT')
  store.setItem(PREFS_KEY, JSON.stringify(saved))
  return palette
}

/**
 * Preflight: resolves exact installed targets, validates form revision and
 * previews an exact change WITHOUT mutating anything. Only local app UI.
 */
export function preflightAdaptiveControl(command: AdaptiveControlCommand, apps: readonly AdaptiveAppBlueprint[] = readAdaptiveApps(),
  formReader: typeof readAdaptiveForm = readAdaptiveForm): { readonly valid: boolean; readonly reason: string } {
  if (!parseAdaptiveControl(command)) return { valid:false,reason:'INVALID_SCHEMA' }
  if (command.appId === 'general' || command.appId === 'healthia') {
    return command.operation === 'open' ? { valid:true, reason:'READ_ONLY_ROUTE' }
      : { valid:false, reason:'PROTECTED_WORKSPACE' }
  }
  const app = apps.find(item => item.id === command.appId)
  if (!app) return { valid:false,reason:'UNKNOWN_APP' }
  if (command.operation === 'open') return command.sectionId === undefined ||
    app.sections.some(s => s.id === command.sectionId) ? { valid:true, reason:'READ_ONLY_ROUTE' }
      : { valid:false, reason:'UNKNOWN_SECTION' }
  if (command.operation === 'find') return { valid:true, reason:'METADATA_ONLY' }
  if (command.operation === 'palette') return { valid:true, reason:'APP_SCOPED_THEME' }
  if (command.operation === 'add-section') {
    try {
      createAdaptiveAppBlueprint(app.title, [...app.sections.map(s => s.label), command.label!])
      return {valid:true,reason:'STRUCTURAL_CHANGE'}
    } catch { return {valid:false,reason:'INVALID_SECTION'} }
  }
  if (!app.sections.some(s => s.id === command.sectionId)) return {valid:false,reason:'UNKNOWN_SECTION'}
  const form = formReader(app.id, command.sectionId!)
  const field = form?.fields.find(item => item.id === command.fieldId)
  if (!form || !field) return {valid:false,reason:'UNKNOWN_FIELD'}
  if (command.expectedRevision !== form.revision) return {valid:false,reason:'STALE_REVISION'}
  if (field.protected) return {valid:false,reason:'PROTECTED_FIELD'}
  if (command.operation === 'rename-field' && form.fields.some(item => item.id !== field.id &&
    item.label.toLocaleLowerCase('es') === command.label!.toLocaleLowerCase('es'))) {
      return {valid:false,reason:'DUPLICATE_LABEL'}
  }
  return {valid:true,reason:'FORM_SCHEMA_CHANGE'}
}

export function applyAdaptiveFieldEdit(command: AdaptiveControlCommand, store: StorageLike | undefined = storeOrUndefined()): AdaptiveFormDraft {
  const state = preflightAdaptiveControl(command, readAdaptiveApps(store),
    (app, section) => readAdaptiveForm(app, section, store))
  if (!state.valid || !['rename-field','remove-field','set-binding'].includes(command.operation)) throw new Error('ADAPTIVE_PREFLIGHT_FAILED_'+state.reason)
  const form = readAdaptiveForm(command.appId,command.sectionId!,store)
  if (!form) throw new Error('ADAPTIVE_FORM_MISSING')
  const fields: AdaptiveFormDraft['fields'] = form.fields.map(item => {
    if (item.id !== command.fieldId) return item
    if (command.operation === 'rename-field') return {...item,label:command.label!}
    if (command.operation === 'set-binding') return {...item,binding:{destination:command.destination!,output:command.output!}}
    return item
  }).filter(item => command.operation !== 'remove-field' || item.id !== command.fieldId)
  const next: AdaptiveFormDraft = {...form,revision:form.revision+1,fields}
  if (!validateAdaptiveDraft(next)) throw new Error('ADAPTIVE_PREFLIGHT_INVALID_RESULT')
  return saveAdaptiveForm(next,store)
}
