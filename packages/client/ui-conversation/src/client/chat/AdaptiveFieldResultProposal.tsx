import { useEffect,useState } from 'react'
import css from './AdaptiveAppProposal.module.css'

export interface AdaptiveFieldResultSpec {
  readonly component:'adaptive_field_result'; readonly version:1
  readonly props:{readonly appId:string;readonly sectionId:string;readonly fieldId:string
    readonly requestId:string;readonly expectedRevision:number;readonly text:string
    readonly missingInformation?:readonly string[]}
}
const only=(v:object,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k))
/** Strict result contract. Never permits clinical app IDs, executable actions or URLs. */
export function parseAdaptiveFieldResult(value:unknown):AdaptiveFieldResultSpec|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const v=value as Record<string,unknown>
  if(!only(v,['component','version','props'])||v.component!=='adaptive_field_result'||v.version!==1
    ||!v.props||typeof v.props!=='object'||Array.isArray(v.props))return null
  const p=v.props as Record<string,unknown>
  if(!only(p,['appId','sectionId','fieldId','requestId','expectedRevision','text','missingInformation'])
    ||typeof p.appId!=='string'||!/^app-[a-z0-9-]{1,45}$/u.test(p.appId)
    ||typeof p.sectionId!=='string'||!/^[a-z][a-z0-9-]{0,47}$/u.test(p.sectionId)
    ||typeof p.fieldId!=='string'||!/^[a-z][a-z0-9-]{0,47}$/u.test(p.fieldId)
    ||typeof p.requestId!=='string'||!/^[a-z0-9-]{12,90}$/iu.test(p.requestId)
    ||!Number.isSafeInteger(p.expectedRevision)||(p.expectedRevision as number)<0
    ||typeof p.text!=='string'||!p.text.trim()||p.text.length>6000
    ||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(p.text)
    ||(p.missingInformation!==undefined&&(!Array.isArray(p.missingInformation)
      ||p.missingInformation.length>8||!p.missingInformation.every(item=>typeof item==='string'
        &&item.length<=180&&!/[<>\u0000-\u001f\u007f]/u.test(item)))))return null
  return value as AdaptiveFieldResultSpec
}
export function AdaptiveFieldResultProposal({spec}:{spec:AdaptiveFieldResultSpec}){
  const [state,setState]=useState<'idle'|'sent'|'rejected'>('idle')
  useEffect(()=>{
    const onAck=(event:Event)=>{
      const d=(event as CustomEvent<{requestId?:string;ok?:boolean}>).detail
      if(d?.requestId===spec.props.requestId)setState(d.ok?'sent':'rejected')
    }
    window.addEventListener('phoenix:adaptive-ai-field-result-ack',onAck)
    return ()=>window.removeEventListener('phoenix:adaptive-ai-field-result-ack',onAck)
  },[spec.props.requestId])
  return <section className={css.card} aria-label="Resultado IA para un campo de App Studio">
    <div className={css.eyebrow}>PHOENIX · RESULTADO DE KIRA <span>Borrador revisable</span></div>
    <h3>Propuesta para un campo</h3>
    <p>Aplicación: <strong>{spec.props.appId}</strong> · campo {spec.props.fieldId}</p>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:230,overflowY:'auto'}}>{spec.props.text}</p>
    {!!spec.props.missingInformation?.length&&<p><strong>Información faltante:</strong> {spec.props.missingInformation.join(' · ')}</p>}
    <div className={css.actions}>
      <button type="button" className={css.primary} disabled={state==='sent'} onClick={()=>{
        setState('idle')
        window.dispatchEvent(new CustomEvent('phoenix:adaptive-ai-field-proposal',{detail:spec}))
      }}>Mostrar diferencia en el formulario</button>
    </div>
    {state==='sent'&&<p role="status">Propuesta presentada en el campo. Debes aceptarla allí para aplicarla.</p>}
    {state==='rejected'&&<p role="alert">No hay una solicitud vigente compatible. Revisa el campo o vuelve a solicitar la generación.</p>}
    <small className={css.note}>Este bloque nunca escribe datos por sí mismo. La aplicación comprueba solicitud, campo y revisión antes de aceptar.</small>
  </section>
}
