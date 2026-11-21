/** PHOENIX App Studio visual contracts: metadata only; no executable UI or patient data. */
export const VISUAL_KINDS = {
  metric: { label: 'Indicador', description: 'KPI y estado', icon: 'activity' },
  card: { label: 'Tarjeta', description: 'Resumen y acciones', icon: 'file' },
  avatar: { label: 'Avatar', description: 'Identidad de perfil', icon: 'user' },
  table: { label: 'Tabla', description: 'Registros y filtros', icon: 'table' },
  chart: { label: 'Gráfica', description: 'Visualización analítica', icon: 'chart' },
  calendar: { label: 'Calendario', description: 'Agenda y fechas', icon: 'calendar' },
  timeline: { label: 'Secuencia', description: 'Flujo y etapas', icon: 'clock' },
  alert: { label: 'Aviso', description: 'Estados y mensajes', icon: 'info' },
} as const
export type VisualKind = keyof typeof VISUAL_KINDS
export type VisualSpan = 'half' | 'full'
export interface VisualWidget {
  readonly id: string
  readonly kind: VisualKind
  readonly title: string
  readonly span: VisualSpan
}
export interface VisualBoard {
  readonly version: 1
  readonly appId: string
  readonly sectionId: string
  readonly revision: number
  readonly widgets: readonly VisualWidget[]
}
export type VisualOperation = 'add-widget'|'remove-widget'|'rename-widget'|'move-widget'|'set-widget-span'
export function isVisualOperation(value:unknown):value is VisualOperation {
  return value==='add-widget'||value==='remove-widget'||value==='rename-widget'
    ||value==='move-widget'||value==='set-widget-span'
}
export interface VisualCommand {
  readonly appId: string
  readonly sectionId: string
  readonly operation: VisualOperation
  readonly widgetId?: string
  readonly widgetKind?: VisualKind
  readonly label?: string
  readonly span?: VisualSpan
  readonly direction?: 'up' | 'down'
  readonly expectedRevision: number
}
type Store = Pick<Storage, 'getItem' | 'setItem'>
const APP = /^app-[a-z0-9-]{1,45}$/u
const SECTION = /^[a-z][a-z0-9-]{0,47}$/u
const WIDGET = /^widget-[1-9][0-9]{0,4}$/u
const TITLE = /^[^\u0000-\u001f\u007f]{1,60}$/u
const MAX = 18
const prefix = 'phoenix.adaptive.visual.v1.'
const isKind = (value:unknown): value is VisualKind => typeof value === 'string' && Object.hasOwn(VISUAL_KINDS,value)
const validTitle = (value:unknown): value is string => typeof value === 'string' && value === value.trim() && TITLE.test(value)
const validSpan = (value:unknown): value is VisualSpan => value === 'half' || value === 'full'
const keys = (value:object, allowed:readonly string[]):boolean => Object.keys(value).every(key=>allowed.includes(key))
const storeNow = ():Store|undefined => {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage }
  catch { return undefined }
}
function storageKey(appId:string,sectionId:string):string {
  if(!APP.test(appId)||!SECTION.test(sectionId)) throw new Error('VISUAL_INVALID_SCOPE')
  return prefix+appId+'.'+sectionId
}
export function emptyVisualBoard(appId:string,sectionId:string):VisualBoard {
  storageKey(appId,sectionId)
  return {version:1,appId,sectionId,revision:0,widgets:[]}
}
export function validateVisualBoard(raw:unknown,appId:string,sectionId:string):raw is VisualBoard {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) return false
  const board=raw as Record<string,unknown>
  if(!keys(board,['version','appId','sectionId','revision','widgets'])
    ||board.version!==1||board.appId!==appId||board.sectionId!==sectionId
    ||!Number.isSafeInteger(board.revision)||(board.revision as number)<0
    ||!Array.isArray(board.widgets)||board.widgets.length>MAX) return false
  const seen=new Set<string>()
  return board.widgets.every(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)) return false
    const w=value as Record<string,unknown>
    if(!keys(w,['id','kind','title','span'])||typeof w.id!=='string'||!WIDGET.test(w.id)
      ||seen.has(w.id)||!isKind(w.kind)||!validTitle(w.title)||!validSpan(w.span)) return false
    seen.add(w.id)
    return true
  })
}
function decode(raw:string|null,appId:string,sectionId:string):VisualBoard|null {
  if(!raw||raw.length>9000) return null
  try { const value:unknown=JSON.parse(raw);return validateVisualBoard(value,appId,sectionId)?value:null }
  catch { return null }
}
export function readVisualBoard(appId:string,sectionId:string,store:Store|undefined=storeNow()):VisualBoard {
  const key=storageKey(appId,sectionId)
  if(!store) return emptyVisualBoard(appId,sectionId)
  try { return decode(store.getItem(key),appId,sectionId)
    ??decode(store.getItem(key+'.backup'),appId,sectionId)
    ??emptyVisualBoard(appId,sectionId) }
  catch { return emptyVisualBoard(appId,sectionId) }
}
function persist(next:VisualBoard,store:Store|undefined):VisualBoard {
  if(!store||!validateVisualBoard(next,next.appId,next.sectionId)) throw new Error('VISUAL_INVALID_BOARD')
  const key=storageKey(next.appId,next.sectionId)
  const before=readVisualBoard(next.appId,next.sectionId,store)
  if(next.revision!==before.revision+1) throw new Error('VISUAL_STALE_REVISION')
  const old=JSON.stringify(before),updated=JSON.stringify(next)
  if(updated.length>9000) throw new Error('VISUAL_SIZE_LIMIT')
  store.setItem(key+'.rollback',old)
  store.setItem(key+'.backup',old)
  store.setItem(key,updated)
  try {store.setItem(key+'.backup',updated)}catch { /* previous valid snapshot retained */ }
  return next
}
export function restoreVisualBoard(appId:string,sectionId:string,store:Store|undefined=storeNow()):VisualBoard {
  if(!store) return emptyVisualBoard(appId,sectionId)
  const key=storageKey(appId,sectionId)
  const previous=decode(store.getItem(key+'.rollback'),appId,sectionId)
  if(!previous) return readVisualBoard(appId,sectionId,store)
  store.setItem(key,JSON.stringify(previous))
  store.setItem(key+'.backup',JSON.stringify(previous))
  return previous
}
/** Untrusted chat commands must pass this narrow exact-schema parser. */
export function parseVisualCommand(value:unknown):VisualCommand|null {
  if(!value||typeof value!=='object'||Array.isArray(value)) return null
  const v=value as Record<string,unknown>
  if(typeof v.appId!=='string'||!APP.test(v.appId)||typeof v.sectionId!=='string'
    ||!SECTION.test(v.sectionId)||!Number.isSafeInteger(v.expectedRevision)
    ||(v.expectedRevision as number)<0) return null
  const op=v.operation
  const base=['appId','sectionId','operation','expectedRevision']
  const additional:Record<VisualOperation,string[]>={
    'add-widget':['widgetKind','label','span'],
    'remove-widget':['widgetId'],
    'rename-widget':['widgetId','label'],
    'move-widget':['widgetId','direction'],
    'set-widget-span':['widgetId','span'],
  }
  if(!isVisualOperation(op)||!Object.hasOwn(additional,op)||!keys(v,[...base,...additional[op]])) return null
  if(op==='add-widget'&&(!isKind(v.widgetKind)||!validTitle(v.label)
    ||(v.span!==undefined&&!validSpan(v.span)))) return null
  if(op==='rename-widget'&&!validTitle(v.label)) return null
  if(op!=='add-widget'&&(typeof v.widgetId!=='string'||!WIDGET.test(v.widgetId))) return null
  if(op==='move-widget'&&v.direction!=='up'&&v.direction!=='down') return null
  if(op==='set-widget-span'&&!validSpan(v.span)) return null
  return v as unknown as VisualCommand
}
export function preflightVisualCommand(command:unknown,board:VisualBoard):{valid:boolean;reason:string} {
  const v=parseVisualCommand(command)
  if(!v||v.appId!==board.appId||v.sectionId!==board.sectionId) return {valid:false,reason:'VISUAL_INVALID_COMMAND'}
  if(v.expectedRevision!==board.revision) return {valid:false,reason:'VISUAL_STALE_REVISION'}
  if(v.operation==='add-widget') return board.widgets.length<MAX
    ?{valid:true,reason:'VISUAL_ADD'}:{valid:false,reason:'VISUAL_LIMIT'}
  const index=board.widgets.findIndex(widget=>widget.id===v.widgetId)
  if(index<0)return {valid:false,reason:'VISUAL_UNKNOWN_WIDGET'}
  if(v.operation==='move-widget'&&((v.direction==='up'&&index===0)
    ||(v.direction==='down'&&index===board.widgets.length-1)))
    return {valid:false,reason:'VISUAL_BOUNDARY'}
  return {valid:true,reason:'VISUAL_STRUCTURE_CHANGE'}
}
export function applyVisualCommand(command:VisualCommand,store:Store|undefined=storeNow()):VisualBoard {
  const current=readVisualBoard(command.appId,command.sectionId,store)
  const preflight=preflightVisualCommand(command,current)
  if(!preflight.valid)throw new Error(preflight.reason)
  const widgets=[...current.widgets]
  const index=widgets.findIndex(widget=>widget.id===command.widgetId)
  if(command.operation==='add-widget') {
    const ids=new Set(widgets.map(widget=>widget.id))
    let next=1
    while(ids.has('widget-'+next))next++
    widgets.push({id:'widget-'+next,kind:command.widgetKind!,title:command.label!,span:command.span??'half'})
  } else if(command.operation==='remove-widget')widgets.splice(index,1)
  else if(command.operation==='rename-widget') widgets[index]={...widgets[index]!,title:command.label!}
  else if(command.operation==='set-widget-span')widgets[index]={...widgets[index]!,span:command.span!}
  else if(command.operation==='move-widget'){
    const destination=index+(command.direction==='up'?-1:1)
    const [moving]=widgets.splice(index,1)
    widgets.splice(destination,0,moving!)
  }
  return persist({...current,revision:current.revision+1,widgets},store)
}
