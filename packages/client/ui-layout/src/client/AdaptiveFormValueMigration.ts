/** Nonclinical, in-memory form draft reconciliation. No values go to storage,
 * chat, network, or a newly configured external destination. */
import type { AdaptiveFormDraft } from './AdaptiveAppCatalog.ts'
export type RecoveryValue={id:string;label:string;value:string}
export type FormValueDraft={values:Record<string,string>;recovery:RecoveryValue[];overflow:boolean}
export function reconcileFormValues(previous:AdaptiveFormDraft,next:AdaptiveFormDraft,draft:FormValueDraft):FormValueDraft{
  if(previous.appId!==next.appId||previous.templateId!==next.templateId)throw Error('ADAPTIVE_DRAFT_SCOPE')
  const values:Record<string,string>={},recovery=[...draft.recovery]
  let overflow=draft.overflow
  for(const field of previous.fields){
    const value=draft.values[field.id]
    if(!value)continue
    const updated=next.fields.find(f=>f.id===field.id)
    if(updated&&!field.protected&&!updated.protected&&updated.kind===field.kind
      &&JSON.stringify(updated.binding)===JSON.stringify(field.binding)){
      values[field.id]=value
    }else if(!field.protected){
      if(recovery.some(v=>v.id===field.id&&v.value===value))continue
      if(recovery.length>=80){overflow=true;continue}
      recovery.push({id:field.id,label:field.label,value})
    }
  }
  return {values,recovery,overflow}
}
