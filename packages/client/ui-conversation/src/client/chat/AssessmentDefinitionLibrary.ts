import { parseScaleForm, type ScaleFormSpec } from './ScaleForm.tsx'

/**
 * Local, opt-in storage for authorized instrument DEFINITIONS only.
 * Patient responses, clinical notes and report contents are never stored here.
 * Source, permission and versions remain the professional's responsibility.
 */
const KEY='phoenix.assessment.definitions.v1'
const MAX_DEFINITIONS=60
const MAX_LENGTH=900_000

function read():unknown {
  try{
    if(typeof localStorage==='undefined')return []
    const raw=localStorage.getItem(KEY)
    if(!raw||raw.length>MAX_LENGTH)return []
    return JSON.parse(raw) as unknown
  }catch{return []}
}
function key(spec:ScaleFormSpec):string {
  return spec.props.title.normalize('NFC').trim().toLocaleLowerCase('es')
    +'::'+(spec.props.version??'sin-version')
}
/** Load the validated, user-saved instrument templates, never response sets. */
export function savedAssessmentDefinitions():ScaleFormSpec[] {
  const raw=read()
  if(!Array.isArray(raw))return []
  const seen=new Set<string>()
  const out:ScaleFormSpec[]=[]
  for(const entry of raw.slice(0,MAX_DEFINITIONS)){
    const spec=parseScaleForm(entry)
    if(!spec||!spec.props.version||!spec.props.source
      ||!spec.props.administration?.length)continue
    const id=key(spec)
    if(seen.has(id))continue
    seen.add(id)
    out.push(spec)
  }
  return out
}
/** Explicit save; a validated import is not itself authorization to persist. */
export function saveAssessmentDefinition(spec:ScaleFormSpec):boolean {
  const validated=parseScaleForm(spec)
  if(!validated||!validated.props.version||!validated.props.source
    ||!validated.props.administration?.length)return false
  try{
    if(typeof localStorage==='undefined')return false
    const current=savedAssessmentDefinitions().filter(item=>key(item)!==key(validated))
    const updated=[validated,...current].slice(0,MAX_DEFINITIONS)
    const content=JSON.stringify(updated)
    if(content.length>MAX_LENGTH)return false
    localStorage.setItem(KEY,content)
    return true
  }catch{return false}
}
/** Delete one saved definition; never affect clinical reports or other forms. */
export function removeAssessmentDefinition(spec:ScaleFormSpec):boolean {
  try{
    if(typeof localStorage==='undefined')return false
    const next=savedAssessmentDefinitions().filter(item=>key(item)!==key(spec))
    localStorage.setItem(KEY,JSON.stringify(next))
    return true
  }catch{return false}
}
