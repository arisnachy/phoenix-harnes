/** Native navigation self-model. Only first-party destinations; no scripts, URLs or privileges. */
export const NATIVE_MENU_KEY = 'phoenix.self.navigation.v1'
export const NATIVE_TARGETS = ['home','tasks','connectors','team','library','healthia'] as const
export type NativeTarget = typeof NATIVE_TARGETS[number]
export type NativeEntry = { readonly id:string; readonly target:NativeTarget; readonly label?:string }
export type NativeRevision = { readonly revision:number; readonly entries:readonly NativeEntry[] }
type Ledger = { readonly current:NativeRevision; readonly previous?:NativeRevision }
type Store = Pick<Storage,'getItem'|'setItem'>
export const NATIVE_ACTIONS = ['inspect','open','rename','move','add','remove','restore'] as const
type NativeAction = typeof NATIVE_ACTIONS[number]
export type NativeCommand = { readonly appId:'general'; readonly operation:'native-menu'; readonly menuAction:NativeAction; readonly sectionId?:string; readonly label?:string; readonly target?:NativeTarget; readonly direction?:'up'|'down'; readonly expectedRevision?:number }
const id = (v:unknown):v is string => typeof v==='string'&&/^[a-z][a-z0-9-]{0,47}$/u.test(v)
const label = (v:unknown):v is string => typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=60&&!/[<>\u0000-\u001f\u007f]/u.test(v)
const target = (v:unknown):v is NativeTarget => NATIVE_TARGETS.includes(v as NativeTarget)
const revision = (v:unknown):v is number => Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<Number.MAX_SAFE_INTEGER
const baseIds = NATIVE_TARGETS.slice(0,5)
const defaults = ():NativeRevision => ({revision:0,entries:baseIds.map(value=>({id:value,target:value}))})
const record = (v:unknown):v is Record<string,unknown> => !!v&&typeof v==='object'&&!Array.isArray(v)
function validRevision(v:unknown):v is NativeRevision {
  if(!record(v)||!revision(v.revision)||!Array.isArray(v.entries)||v.entries.length<5||v.entries.length>20)return false
  const seen=new Set<string>()
  for(const e of v.entries){
    if(!record(e)||!id(e.id)||seen.has(e.id)||!target(e.target)||(e.label!==undefined&&!label(e.label))||Object.keys(e).some(k=>!['id','target','label'].includes(k)))return false
    if(baseIds.includes(e.id as NativeTarget)?e.id!==e.target:!e.id.startsWith('shortcut-'))return false
    seen.add(e.id)
  }
  return baseIds.every(key=>seen.has(key))
}
function read(store:Store):Ledger {
  const raw=store.getItem(NATIVE_MENU_KEY)
  if(raw===null)return {current:defaults()}
  if(raw.length>20000)throw Error('NATIVE_MENU_STORAGE_INVALID')
  const v:unknown=JSON.parse(raw)
  if(!record(v)||!validRevision(v.current)||(v.previous!==undefined&&!validRevision(v.previous)))throw Error('NATIVE_MENU_STORAGE_INVALID')
  return {current:v.current,...(v.previous?{previous:v.previous as NativeRevision}:{})}
}
export function readNativeMenu(store:Store):NativeRevision {
  try{return read(store).current}catch{return defaults()}
}
export function parseNativeMenuCommand(value:unknown):NativeCommand|null {
  if(!record(value)||value.appId!=='general'||value.operation!=='native-menu'||!NATIVE_ACTIONS.includes(value.menuAction as NativeAction))return null
  const action=value.menuAction as NativeAction
  const base=['appId','operation','menuAction']
  const extra:Record<NativeAction,string[]>={inspect:[],open:['sectionId'],rename:['sectionId','label','expectedRevision'],move:['sectionId','direction','expectedRevision'],add:['sectionId','label','target','expectedRevision'],remove:['sectionId','expectedRevision'],restore:['expectedRevision']}
  if(Object.keys(value).some(k=>![...base,...extra[action]].includes(k)))return null
  if(!['inspect','restore'].includes(action)&&!id(value.sectionId))return null
  if(!['inspect','open'].includes(action)&&!revision(value.expectedRevision))return null
  if(['rename','add'].includes(action)&&!label(value.label))return null
  if(action==='add'&&(!target(value.target)||!String(value.sectionId).startsWith('shortcut-')))return null
  if(action==='move'&&!['up','down'].includes(String(value.direction)))return null
  return value as unknown as NativeCommand
}
export function nativeMenuOperation(store:Store,raw:unknown,apply=false):{state:NativeRevision;opened?:NativeTarget;reason:string}{
  const cmd=parseNativeMenuCommand(raw)
  if(!cmd)throw Error('INVALID_NATIVE_MENU_COMMAND')
  const ledger=read(store), current=ledger.current, entries=[...current.entries]
  const i=entries.findIndex(e=>e.id===cmd.sectionId)
  if(cmd.menuAction==='inspect')return {state:current,reason:'NATIVE_MENU_INVENTORY'}
  if(cmd.menuAction==='open'){
    if(i<0)throw Error('UNKNOWN_NATIVE_MENU')
    return {state:current,opened:entries[i]!.target,reason:'NATIVE_NAVIGATION'}
  }
  if(cmd.expectedRevision!==current.revision)throw Error('STALE_NATIVE_MENU_REVISION')
  if(cmd.menuAction==='restore'){
    if(!ledger.previous)throw Error('NATIVE_MENU_NO_ROLLBACK')
    entries.splice(0,entries.length,...ledger.previous.entries)
  }else if(cmd.menuAction==='add'){
    if(i>=0||entries.length>=20)throw Error('DUPLICATE_OR_LIMIT')
    entries.push({id:cmd.sectionId!,target:cmd.target!,label:cmd.label!})
  }else{
    if(i<0)throw Error('UNKNOWN_NATIVE_MENU')
    if(cmd.menuAction==='rename')entries[i]={...entries[i]!,label:cmd.label!}
    if(cmd.menuAction==='remove'){
      if(!entries[i]!.id.startsWith('shortcut-'))throw Error('PROTECTED_NATIVE_MENU')
      entries.splice(i,1)
    }
    if(cmd.menuAction==='move'){
      const j=i+(cmd.direction==='up'?-1:1)
      if(j<0||j>=entries.length)throw Error('NATIVE_MENU_EDGE')
      const item=entries.splice(i,1)[0]!
      entries.splice(j,0,item)
    }
  }
  const next={revision:current.revision+1,entries}
  if(!validRevision(next))throw Error('INVALID_NATIVE_MENU_RESULT')
  if(apply){
    store.setItem(NATIVE_MENU_KEY,JSON.stringify({current:next,previous:current}))
    const observed=read(store).current
    if(JSON.stringify(observed)!==JSON.stringify(next))throw Error('NATIVE_MENU_VERIFY_FAILED')
  }
  return {state:apply?next:current,reason:apply?'NATIVE_MENU_SAVED':'NATIVE_MENU_PREFLIGHT'}
}
