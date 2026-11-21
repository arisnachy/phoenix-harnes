import { useEffect, useRef, useState } from 'react'
import css from './AdaptiveAppProposal.module.css'

export interface AdaptiveWorkspaceProposalSpec {
  readonly component: 'adaptive_control'
  readonly version: 1
  readonly props: {
    readonly appId: string
    readonly operation: 'open' | 'find' | 'add-section' | 'rename-section' | 'remove-section' | 'palette' | 'rename-field' | 'remove-field' | 'set-binding' | 'set-field-kind' | 'set-required' | 'add-widget' | 'remove-widget' | 'rename-widget' | 'move-widget' | 'set-widget-span'
    readonly sectionId?: string
    readonly fieldId?: string
    readonly label?: string
    readonly query?: string
    readonly palette?: 'pearl' | 'ocean' | 'sage' | 'iris' | 'amber'
    readonly kind?: 'text' | 'number' | 'date' | 'select' | 'textarea'
    readonly required?: boolean
    readonly destination?: 'local' | 'api' | 'chat' | 'ai'
    readonly output?: 'inline' | 'table' | 'document' | 'chat'
    readonly expectedRevision?: number
    readonly widgetId?: string
    readonly widgetKind?: 'metric'|'card'|'avatar'|'table'|'chart'|'calendar'|'timeline'|'alert'
    readonly span?: 'half'|'full'
    readonly direction?: 'up'|'down'
  }
}
const ID = /^[a-z][a-z0-9-]{0,47}$/u
const APP = /^app-[a-z0-9-]{1,45}$/u
const goodText = (v: unknown): v is string => typeof v === 'string'
  && v.trim() === v && v.length >= 1 && v.length <= 60
  && !/[\u0000-\u001f\u007f]/u.test(v)
const allowed = (v: object, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k))

/** Cross-plugin schema validation duplicated deliberately to preserve purity. */
export function parseAdaptiveWorkspaceProposal(input: unknown): AdaptiveWorkspaceProposalSpec | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const v = input as Record<string,unknown>
  if (!allowed(v,['component','version','props']) || v.component !== 'adaptive_control' || v.version !== 1
    || !v.props || typeof v.props !== 'object' || Array.isArray(v.props)) return null
  const p = v.props as Record<string,unknown>
  const base = ['appId','operation']
  if (typeof p.appId !== 'string' || !['general','healthia'].includes(p.appId) && !APP.test(p.appId)) return null
  if (!['open','find','add-section','rename-section','remove-section','palette','rename-field','remove-field','set-binding','set-field-kind','set-required','add-widget','remove-widget','rename-widget','move-widget','set-widget-span'].includes(p.operation as string)) return null
  const operation = p.operation
  const keys: Record<string,string[]> = {
    open: [...base,'sectionId'],
    find: [...base,'query'],
    'add-section':[...base,'label'],
    'rename-section':[...base,'sectionId','label'],
    'remove-section':[...base,'sectionId'],
    palette:[...base,'palette'],
    'rename-field':[...base,'sectionId','fieldId','label','expectedRevision'],
    'remove-field':[...base,'sectionId','fieldId','expectedRevision'],
    'set-binding':[...base,'sectionId','fieldId','destination','output','expectedRevision'],
    'set-field-kind':[...base,'sectionId','fieldId','kind','expectedRevision'],
    'set-required':[...base,'sectionId','fieldId','required','expectedRevision'],
    'add-widget':[...base,'sectionId','expectedRevision','widgetKind','label','span'],
    'remove-widget':[...base,'sectionId','expectedRevision','widgetId'],
    'rename-widget':[...base,'sectionId','expectedRevision','widgetId','label'],
    'move-widget':[...base,'sectionId','expectedRevision','widgetId','direction'],
    'set-widget-span':[...base,'sectionId','expectedRevision','widgetId','span'],
  }
  if (!allowed(p,keys[operation as string] ?? [])) return null
  if (!['open','find'].includes(operation as string) && !APP.test(p.appId)) return null
  if (operation === 'open' && p.sectionId !== undefined
    && (typeof p.sectionId !== 'string' || !ID.test(p.sectionId))) return null
  if (operation === 'find' && !goodText(p.query)) return null
  if (operation === 'add-section' && !goodText(p.label)) return null
  if (operation === 'rename-section' && !goodText(p.label)) return null
  if (['rename-section','remove-section'].includes(operation as string)
    && (typeof p.sectionId !== 'string' || !ID.test(p.sectionId))) return null
  if (operation === 'palette' && !['pearl','ocean','sage','iris','amber'].includes(p.palette as string)) return null
  if (['rename-field','remove-field','set-binding','set-field-kind','set-required'].includes(operation as string)
    && (typeof p.sectionId !== 'string' || !ID.test(p.sectionId)
      || typeof p.fieldId !== 'string' || !ID.test(p.fieldId)
      || !Number.isSafeInteger(p.expectedRevision) || (p.expectedRevision as number) < 0)) return null
  if (operation === 'rename-field' && !goodText(p.label)) return null
  if (operation === 'set-binding' &&
    (!['local','api','chat','ai'].includes(p.destination as string)
      || !['inline','table','document','chat'].includes(p.output as string))) return null
  if (operation === 'set-field-kind' && !['text','number','date','select','textarea'].includes(p.kind as string)) return null
  if (operation === 'set-required' && typeof p.required !== 'boolean') return null
  if (['add-widget','remove-widget','rename-widget','move-widget','set-widget-span'].includes(operation as string)) {
    if(typeof p.sectionId!=='string'||!ID.test(p.sectionId)||!Number.isSafeInteger(p.expectedRevision)
      ||(p.expectedRevision as number)<0)return null
    if(operation==='add-widget'&&(!['metric','card','avatar','table','chart','calendar','timeline','alert'].includes(p.widgetKind as string)
      ||!goodText(p.label)||(p.span!==undefined&&!['half','full'].includes(p.span as string))))return null
    if(operation!=='add-widget'&&(typeof p.widgetId!=='string'||!/^widget-[1-9][0-9]{0,4}$/u.test(p.widgetId)))return null
    if(operation==='rename-widget'&&!goodText(p.label))return null
    if(operation==='move-widget'&&!['up','down'].includes(p.direction as string))return null
    if(operation==='set-widget-span'&&!['half','full'].includes(p.span as string))return null
  }
  return {component:'adaptive_control',version:1,props:p as unknown as AdaptiveWorkspaceProposalSpec['props']}
}
const nameOf: Record<AdaptiveWorkspaceProposalSpec['props']['operation'],string> = {
  open:'Abrir espacio / sección',find:'Buscar componentes',
  'add-section':'Agregar menú / sección',
  'rename-section':'Renombrar sección','remove-section':'Ocultar sección (sin borrar formularios)',
  palette:'Cambiar paleta de colores',
  'rename-field':'Renombrar campo','remove-field':'Eliminar campo',
  'set-binding':'Configurar destino y salida de campo',
  'set-field-kind':'Cambiar tipo de input','set-required':'Cambiar validación requerida',
  'add-widget':'Añadir componente visual','remove-widget':'Quitar componente visual',
  'rename-widget':'Renombrar componente visual','move-widget':'Reordenar componente visual',
  'set-widget-span':'Cambiar ancho del componente',
}

export function AdaptiveWorkspaceProposal({spec}:{spec:AdaptiveWorkspaceProposalSpec}) {
  const [status,setStatus] = useState<'idle'|'checking'|'ready'|'rejected'|'applying'|'done'|'failed'>('idle')
  const [note,setNote] = useState('')
  const request = useRef<string | null>(null)
  useEffect(() => {
    const onResult = (event:Event):void => {
      const value = (event as CustomEvent<{requestId?:string;phase?:string;ok?:boolean;reason?:string}>).detail
      if (request.current === null || value?.requestId !== request.current) return
      setNote(value.reason ?? '')
      if (value.phase === 'preflight') setStatus(value.ok ? 'ready' : 'rejected')
      else if (value.phase === 'apply') setStatus(value.ok ? 'done' : 'failed')
      request.current = null
    }
    window.addEventListener('phoenix:adaptive-control-result',onResult)
    return () => window.removeEventListener('phoenix:adaptive-control-result',onResult)
  },[])
  const send = (phase:'preflight'|'apply'):void => {
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `control-${Date.now()}-${Math.random().toString(36).slice(2)}`
    request.current = requestId
    setStatus(phase === 'preflight' ? 'checking' : 'applying')
    window.dispatchEvent(new CustomEvent('phoenix:adaptive-control-request',{
      detail:{requestId,phase,command:spec.props},
    }))
  }
  return <section className={css.card} aria-label="Control adaptativo de PHOENIX">
    <div className={css.eyebrow}>PHOENIX · CONTROL DE ESPACIOS <span>Comando declarativo</span></div>
    <h3>{nameOf[spec.props.operation]}</h3>
    <p><strong>{spec.props.appId}</strong>{spec.props.sectionId ? ` / ${spec.props.sectionId}` : ''}
      {spec.props.label ? ` · ${spec.props.label}` : ''}
      {spec.props.palette ? ` · ${spec.props.palette}` : ''}
      {spec.props.widgetKind ? ` · ${spec.props.widgetKind}` : ''}
      {spec.props.widgetId ? ` · ${spec.props.widgetId}` : ''}
      {spec.props.query ? ` · Buscar: ${spec.props.query}` : ''}</p>
    <div className={css.actions}>
      <button className={css.secondary} type="button" disabled={status === 'checking'||status === 'applying'||status === 'done'}
        onClick={() => send('preflight')}>Comprobar antes de aplicar</button>
      <button className={css.primary} type="button" disabled={status !== 'ready'}
        onClick={() => send('apply')}>Aplicar cambio verificado</button>
    </div>
    {status === 'ready' && <p role="status">Comprobación inicial satisfactoria. Requiere confirmación para aplicar.</p>}
    {(status === 'rejected'||status === 'failed') && <p role="alert">Cambio no aplicado: {note || 'error de validación'}</p>}
    {status === 'done' && <p role="status">Operación aceptada en la vista local. {note}</p>}
    <small className={css.note}>No concede acceso a expedientes ni ejecuta código, API o herramientas del sistema. El cambio se revalida al aplicarse.</small>
  </section>
}
