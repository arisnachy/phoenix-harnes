import { useState, type ReactNode } from 'react'
import { PhoenixUiIcon } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './InteractiveUi.module.css'

type Patch = {kind:'document';before:string;after:string}|{kind:'slides';slide:number;field:'title'|'body';before:string;after:string}|{kind:'sheet';row:number;column:number;before:string;after:string}
export interface SpacePatchSpec {readonly component:'space_patch';readonly version:1;readonly props:{id:string;revision:number;edit:Patch}}
type Obj=Record<string,unknown>
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v)
const exact=(v:Obj,k:string[])=>Object.keys(v).length===k.length&&Object.keys(v).every(x=>k.includes(x))
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(v)
const index=(v:unknown,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<max
export function parseSpacePatch(v:unknown):SpacePatchSpec|null{
  if(!record(v)||!exact(v,['component','version','props'])||v.component!=='space_patch'||v.version!==1||!record(v.props))return null
  const p=v.props
  if(!exact(p,['id','revision','edit'])||!uuid(p.id)||!index(p.revision,Number.MAX_SAFE_INTEGER)||p.revision===0||!record(p.edit))return null
  const e=p.edit
  if(typeof e.before!=='string'||typeof e.after!=='string'||e.before.length>24000||e.after.length>24000||e.before===e.after)return null
  const base=['kind','before','after']
  if(e.kind==='document'&&(!exact(e,base)||!e.before))return null
  if(e.kind==='slides'&&(!exact(e,[...base,'slide','field'])||!index(e.slide,100)||!['title','body'].includes(String(e.field))))return null
  if(e.kind==='sheet'&&(!exact(e,[...base,'row','column'])||!index(e.row,1000)||!index(e.column,40)||e.after.length>300))return null
  if(!['document','slides','sheet'].includes(String(e.kind)))return null
  return v as unknown as SpacePatchSpec
}
export function patchSpaceContent(content:string,edit:Patch):string{
  if(edit.kind==='document'){
    const at=content.indexOf(edit.before)
    if(at<0||content.indexOf(edit.before,at+1)>=0)throw Error('SPACE_TEXT_NOT_UNIQUE')
    return content.slice(0,at)+edit.after+content.slice(at+edit.before.length)
  }
  const value:unknown=JSON.parse(content)
  if(!record(value))throw Error('SPACE_INVALID_CONTENT')
  if(edit.kind==='slides'){
    if(!Array.isArray(value.slides)||value.slides.length>100||!value.slides.every(s=>record(s)&&typeof s.title==='string'&&typeof s.body==='string'))throw Error('SPACE_INVALID_SLIDES')
    const s=value.slides[edit.slide] as Obj|undefined
    if(!s||s[edit.field]!==edit.before)throw Error('SPACE_CONFLICT')
    s[edit.field]=edit.after
  }else{
    if(!Array.isArray(value.columns)||value.columns.length<1||value.columns.length>40||!value.columns.every(c=>typeof c==='string')||!Array.isArray(value.rows)||value.rows.length>1000||!value.rows.every(r=>Array.isArray(r)&&r.length===(value.columns as unknown[]).length&&r.every(c=>typeof c==='string')))throw Error('SPACE_INVALID_SHEET')
    const row=value.rows[edit.row] as string[]|undefined
    if(!row||row[edit.column]!==edit.before)throw Error('SPACE_CONFLICT')
    row[edit.column]=edit.after
  }
  return JSON.stringify(value)
}
type Item={id:string;kind:string;mime:string;revision:number;content:string;deleted:boolean;bytes:number}
const mimeFor={document:'text/markdown',slides:'application/vnd.phoenix.slides+json',sheet:'application/vnd.phoenix.sheet+json'}
async function api<T>(path:string,data?:Obj):Promise<T>{
  const res=await fetch('/space-api'+path,{method:data?'PUT':'GET',headers:{'content-type':'application/json','x-phoenix-space':'1'},...(data?{body:JSON.stringify(data)}:{})})
  if(!res.ok)throw Error('SPACE_REQUEST_FAILED')
  return await res.json() as T
}
export function SpaceArtifactPatch({spec}:{spec:SpacePatchSpec}):ReactNode{
  const [state,setState]=useState<'idle'|'working'|'done'|'failed'>('idle')
  const [receipt,setReceipt]=useState('')
  const commit=async()=>{
    setState('working')
    try{
      const p=spec.props,path='/items/'+p.id
      const policy=await api<{restricted:boolean}>(path+'/distribution')
      if(policy.restricted!==false)throw Error('SPACE_RESTRICTED')
      const {item}=await api<{item:Item}>(path)
      if(item.id!==p.id||item.deleted||item.bytes!==0||item.revision!==p.revision||item.kind!==p.edit.kind||item.mime!==mimeFor[p.edit.kind])throw Error('SPACE_CONFLICT_OR_UNSUPPORTED')
      const content=patchSpaceContent(item.content,p.edit)
      if(!window.dispatchEvent(new CustomEvent('phoenix:space-before-agent-edit',{detail:{id:p.id},cancelable:true})))throw Error('SPACE_UNSAVED_MANUAL_EDIT')
      const updated=await api<{item:Item}>(path,{revision:p.revision,content})
      if(updated.item.id!==p.id||updated.item.revision<=p.revision||updated.item.content!==content)throw Error('SPACE_UNVERIFIED')
      window.dispatchEvent(new CustomEvent('phoenix:space-agent-edited',{detail:{id:p.id,revision:updated.item.revision}}))
      setReceipt('Actualizado el mismo archivo · versión '+updated.item.revision+'. La versión anterior permanece en el historial.')
      setState('done')
    }catch{
      setState('failed');setReceipt('No se pudo verificar el cambio. Guarda las ediciones manuales, comprueba la revisión y vuelve a consultar el archivo. No se crea una copia.')
    }
  }
  return <section className={css.surface} data-generative-ui="space_patch">
    <header className={css.heading}><PhoenixUiIcon name="file"/><div><h3>Modificar archivo existente</h3><p>Revisión esperada {spec.props.revision}</p></div></header>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{spec.props.edit.before+' → '+spec.props.edit.after}</p>
    <div className={css.actions}><button type="button" disabled={state==='working'||state==='done'} onClick={()=>{void commit()}}>{state==='done'?'Aplicado':'Aplicar al archivo actual'}</button></div>
    {receipt&&<p role={state==='failed'?'alert':'status'}>{receipt}</p>}
  </section>
}
