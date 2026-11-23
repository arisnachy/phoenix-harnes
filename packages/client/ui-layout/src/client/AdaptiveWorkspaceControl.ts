/**
 * PHOENIX Adaptive Workspace — deterministic preflight for chat-proposed UI
 * controls. This is NOT permission to execute arbitrary code or use an API.
 * Chat events are treated as untrusted and revalidated at the layout boundary.
 */
import { createAdaptiveAppBlueprint, validateAdaptiveDraft, type AdaptiveAppBlueprint,
  type AdaptiveFormDraft, type AdaptiveDestination, type AdaptiveOutput, type AdaptiveInputKind } from './AdaptiveAppCatalog.ts'
import { readAdaptiveApps } from './AdaptiveAppRegistry.ts'
import { readAdaptiveForm, saveAdaptiveForm, previousAdaptiveForm, restoreAdaptiveFormRevision } from './AdaptiveFormMetadataStore.ts'
import { readFieldAiConfig,saveFieldAiConfig,type FieldSkill } from './AdaptiveIntelligentFields.ts'
import { readVisualBoard, parseVisualCommand, preflightVisualCommand, applyVisualCommand, isVisualOperation,
  type VisualOperation, type VisualKind, type VisualSpan, type VisualCommand } from './AdaptiveVisualKit.ts'

export const ADAPTIVE_PALETTES = {
  pearl: { accent: '#bc471c', tint: '#fff1e8', ink: '#532312' },
  ocean: { accent: '#16658a', tint: '#e6f4fb', ink: '#123d59' },
  sage: { accent: '#316c4c', tint: '#eaf5ec', ink: '#1b472f' },
  iris: { accent: '#6941a3', tint: '#f1ecfb', ink: '#412665' },
  amber: { accent: '#89510d', tint: '#fff4dc', ink: '#55340e' },
} as const
export type AdaptivePalette = keyof typeof ADAPTIVE_PALETTES
export type AdaptiveControlOperation =
  'open' | 'find' | 'add-section' | 'rename-section' | 'remove-section' | 'palette' | 'rename-field' | 'remove-field' | 'set-binding' | 'set-field-kind' | 'set-required' | 'set-field-ai' | 'restore-form' | VisualOperation
export interface AdaptiveControlCommand {
  readonly appId: string
  readonly operation: AdaptiveControlOperation
  readonly sectionId?: string
  readonly fieldId?: string
  readonly label?: string
  readonly query?: string
  readonly palette?: AdaptivePalette
  readonly kind?: AdaptiveInputKind
  readonly required?: boolean
  readonly destination?: AdaptiveDestination
  readonly output?: AdaptiveOutput
  readonly expectedRevision?: number
  readonly enabled?: boolean
  readonly skill?: FieldSkill
  readonly instruction?: string
  readonly widgetId?: string
  readonly widgetKind?: VisualKind
  readonly span?: VisualSpan
  readonly direction?: 'up' | 'down'
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
  if (isVisualOperation(v.operation)) {
    return parseVisualCommand(value) as AdaptiveControlCommand | null
  }
  if (typeof v.appId !== 'string' || !['general','healthia'].includes(v.appId) && !APP.test(v.appId)
      || !['open','find','add-section','rename-section','remove-section','palette','rename-field','remove-field','set-binding','set-field-kind','set-required','set-field-ai','restore-form'].includes(v.operation as string)) return null
  const op = v.operation as AdaptiveControlOperation
  const base = ['appId','operation']
  let keys = base
  if (op === 'open') keys = [...base,'sectionId']
  if (op === 'find') keys = [...base,'query']
  if (op === 'palette') keys = [...base,'palette']
  if (op === 'add-section') keys = [...base,'label']
  if (op === 'rename-section') keys = [...base,'sectionId','label']
  if (op === 'remove-section') keys = [...base,'sectionId']
  if (op === 'rename-field') keys = [...base,'sectionId','fieldId','label','expectedRevision']
  if (op === 'remove-field') keys = [...base,'sectionId','fieldId','expectedRevision']
  if (op === 'set-binding') keys = [...base,'sectionId','fieldId','destination','output','expectedRevision']
  if (op === 'set-field-kind') keys = [...base,'sectionId','fieldId','kind','expectedRevision']
  if (op === 'set-required') keys = [...base,'sectionId','fieldId','required','expectedRevision']
  if (op === 'restore-form') keys = [...base,'sectionId','expectedRevision']
  if (op === 'set-field-ai') keys = [...base,'sectionId','fieldId','enabled','skill','instruction','expectedRevision']
  if (!onlyKeys(v,keys)) return null
  if (op !== 'open' && op !== 'find' && !APP.test(v.appId)) return null
  if (op === 'open' && v.sectionId !== undefined && (typeof v.sectionId !== 'string' || !ID.test(v.sectionId))) return null
  if (op === 'find' && !validLabel(v.query)) return null
  if (op === 'palette' && (typeof v.palette !== 'string' || !Object.hasOwn(ADAPTIVE_PALETTES, v.palette))) return null
  if (op === 'add-section' && !validLabel(v.label)) return null
  if (op === 'rename-section' && !validLabel(v.label)) return null
  if (['rename-section','remove-section'].includes(op)
    && (typeof v.sectionId !== 'string' || !ID.test(v.sectionId))) return null
  if (['rename-field','remove-field','set-binding','set-field-kind','set-required','set-field-ai'].includes(op)) {
    if (typeof v.sectionId !== 'string' || !ID.test(v.sectionId)
      || typeof v.fieldId !== 'string' || !ID.test(v.fieldId)
      || !Number.isSafeInteger(v.expectedRevision) || (v.expectedRevision as number) < 0) return null
  }
  if (op === 'rename-field' && !validLabel(v.label)) return null
  if (op === 'set-binding' && (!DEST.includes(v.destination as string) || !OUTPUT.includes(v.output as string))) return null
  if (op === 'set-field-kind' && !['text','number','date','select','textarea'].includes(v.kind as string)) return null
  if (op === 'set-required' && typeof v.required !== 'boolean') return null
  if(op==='restore-form'&&(typeof v.sectionId!=='string'||!ID.test(v.sectionId)||!Number.isSafeInteger(v.expectedRevision)||(v.expectedRevision as number)<1))return null
  if (op === 'set-field-ai' && (typeof v.enabled !== 'boolean'
    || !['polish','summarize','structure','extract'].includes(v.skill as string)
    || typeof v.instruction !== 'string' || v.instruction.length > 320
    || /[<>\u0000-\u001f\u007f]/u.test(v.instruction))) return null
  return v as unknown as AdaptiveControlCommand
}

export interface AdaptiveDiscovery {
  readonly kind: 'app' | 'section' | 'field' | 'widget'
  readonly appId: string
  readonly sectionId?: string
  readonly fieldId?: string
  readonly widgetId?: string
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
      for (const widget of readVisualBoard(app.id,section.id).widgets) if (widget.title.toLocaleLowerCase('es').includes(term)) {
        results.push({kind:'widget',appId:app.id,sectionId:section.id,widgetId:widget.id,label:widget.title})
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
    if (command.operation === 'find') return {valid:true,reason:'METADATA_ONLY'}
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
      if (app.sections.length >= 12) return {valid:false,reason:'MENU_LIMIT'}
      const section = createAdaptiveAppBlueprint(app.title,[command.label!]).sections[0]!
      if (app.sections.some(item => item.id === section.id
        || item.label.toLocaleLowerCase('es') === command.label!.toLocaleLowerCase('es'))) {
        return {valid:false,reason:'DUPLICATE_SECTION'}
      }
      return {valid:true,reason:'STRUCTURAL_CHANGE'}
    } catch { return {valid:false,reason:'INVALID_SECTION'} }
  }
  if (command.operation === 'rename-section') {
    if (!app.sections.some(s => s.id === command.sectionId)) return {valid:false,reason:'UNKNOWN_SECTION'}
    if (app.sections.some(s => s.id !== command.sectionId &&
      s.label.toLocaleLowerCase('es') === command.label!.toLocaleLowerCase('es'))) {
      return {valid:false,reason:'DUPLICATE_LABEL'}
    }
    return {valid:true,reason:'SAFE_MENU_RENAME'}
  }
  if (command.operation === 'remove-section') {
    return app.sections.length > 1 && app.sections.some(s => s.id === command.sectionId)
      ? {valid:true,reason:'HIDE_MENU_KEEP_FORM_DATA'} : {valid:false,reason:'LAST_OR_UNKNOWN_SECTION'}
  }
  if (!app.sections.some(s => s.id === command.sectionId)) return {valid:false,reason:'UNKNOWN_SECTION'}
  if(command.operation==='restore-form')return previousAdaptiveForm(app.id,command.sectionId!,command.expectedRevision!)?{valid:true,reason:'SCOPED_FORM_ROLLBACK'}:{valid:false,reason:'ROLLBACK_UNAVAILABLE'}
  if (isVisualOperation(command.operation)) {
    return preflightVisualCommand(command,readVisualBoard(app.id,command.sectionId!))
  }
  if (command.operation === 'set-field-ai') {
    const target=formReader(app.id,command.sectionId!)?.fields.find(x=>x.id===command.fieldId)
    if (!target || target.protected || !['text','textarea'].includes(target.kind))return {valid:false,reason:'UNSUPPORTED_AI_FIELD'}
    const config=readFieldAiConfig(app.id,command.sectionId!,command.fieldId!)
    return config.revision===command.expectedRevision
      ?{valid:true,reason:'FIELD_AI_METADATA_CHANGE'}:{valid:false,reason:'STALE_AI_CONFIG'}
  }
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
  if (!state.valid || !['rename-field','remove-field','set-binding','set-field-kind','set-required'].includes(command.operation)) throw new Error('ADAPTIVE_PREFLIGHT_FAILED_'+state.reason)
  const form = readAdaptiveForm(command.appId,command.sectionId!,store)
  if (!form) throw new Error('ADAPTIVE_FORM_MISSING')
  const fields: AdaptiveFormDraft['fields'] = form.fields.map(item => {
    if (item.id !== command.fieldId) return item
    if (command.operation === 'rename-field') return {...item,label:command.label!}
    if (command.operation === 'set-binding') return {...item,binding:{destination:command.destination!,output:command.output!}}
    if (command.operation === 'set-field-kind') return {...item,kind:command.kind!}
    if (command.operation === 'set-required') return {...item,required:command.required!}
    return item
  }).filter(item => command.operation !== 'remove-field' || item.id !== command.fieldId)
  const next: AdaptiveFormDraft = {...form,revision:form.revision+1,fields}
  if (!validateAdaptiveDraft(next)) throw new Error('ADAPTIVE_PREFLIGHT_INVALID_RESULT')
  return saveAdaptiveForm(next,store)
}

/** Apply only a metadata-only widget edit, after the same two-stage chat gate. */
export function applyAdaptiveVisualEdit(command: AdaptiveControlCommand) {
  if (!isVisualOperation(command.operation)) throw new Error('VISUAL_INVALID_OPERATION')
  return applyVisualCommand(command as VisualCommand)
}

/** Chat-controlled instructions are bounded metadata, never model execution grants. */
export function applyAdaptiveAiFieldEdit(command:AdaptiveControlCommand) {
  if(command.operation!=='set-field-ai')throw Error('FIELD_AI_INVALID_OPERATION')
  const gate=preflightAdaptiveControl(command)
  if(!gate.valid)throw Error('FIELD_AI_PREFLIGHT_'+gate.reason)
  return saveFieldAiConfig({version:1,appId:command.appId,sectionId:command.sectionId!,
    fieldId:command.fieldId!,revision:command.expectedRevision!+1,
    enabled:command.enabled!,skill:command.skill!,instruction:command.instruction!})
}

export function applyAdaptiveFormRestore(command:AdaptiveControlCommand){
  if(command.operation!=='restore-form'||!preflightAdaptiveControl(command).valid)throw Error('ADAPTIVE_FORM_ROLLBACK_DENIED')
  return restoreAdaptiveFormRevision(command.appId,command.sectionId!,command.expectedRevision!)
}
