import { useEffect,useState } from 'react'
import { PhoenixUiIcon } from '@phoenix-ai/dsh-client-ui-primitives'
import { FIELD_SKILLS, readFieldAiConfig, saveFieldAiConfig, matchesFieldRequest,
  buildFieldAiMission, validateFieldResult, type FieldSkill, type FieldAiConfig,
  type FieldResult, type PendingFieldRequest } from './AdaptiveIntelligentFields.ts'
import styles from './AdaptiveAiFieldControl.module.css'

/** Generic, nonclinical field collaborator. User must send a draft in the Kira chat. */
export function AdaptiveAiFieldControl({appId,sectionId,fieldId,formRevision,value,maxLength,onAccept}:{
  appId:string;sectionId:string;fieldId:string;formRevision:number
  value:string;maxLength:number;onAccept:(text:string)=>void
}) {
  const [config,setConfig]=useState<FieldAiConfig>(()=>readFieldAiConfig(appId,sectionId,fieldId))
  const [skill,setSkill]=useState<FieldSkill>(config.skill)
  const [instruction,setInstruction]=useState(config.instruction)
  const [expanded,setExpanded]=useState(false)
  const [pending,setPending]=useState<PendingFieldRequest|null>(null)
  const [proposal,setProposal]=useState<FieldResult|null>(null)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  useEffect(()=>{
    const current=readFieldAiConfig(appId,sectionId,fieldId)
    setConfig(current);setSkill(current.skill);setInstruction(current.instruction)
    setPending(null);setProposal(null);setNotice('');setError('')
  },[appId,sectionId,fieldId])
  useEffect(()=>{
    const handle=(event:Event)=>{
      const detail=(event as CustomEvent<unknown>).detail
      if(!validateFieldResult(detail)||!pending)return
      if(detail.props.requestId!==pending.requestId)return
      if(!matchesFieldRequest(detail,pending,formRevision,value)){
        setError('La solicitud caducó: el campo o su estructura cambiaron. No se aplicó el resultado.')
        setProposal(null)
        return
      }
      if(detail.props.text.length>maxLength){
        setError('La propuesta supera la longitud permitida para este campo. Solicita una versión más breve.')
        return
      }
      setProposal(detail);setError('');setNotice('Propuesta recibida. Compárala antes de aplicar.')
    }
    window.addEventListener('phoenix:adaptive-ai-field-proposal',handle)
    return ()=>window.removeEventListener('phoenix:adaptive-ai-field-proposal',handle)
  },[pending,formRevision,value,maxLength])
  const persist=(enabled:boolean)=>{
    try{
      const next=saveFieldAiConfig({...config,enabled,skill,instruction:instruction.trim(),revision:config.revision+1})
      setConfig(next);setError('');setNotice(enabled?'Instrucciones guardadas para este campo.':'IA desactivada para este campo.')
      setProposal(null);setPending(null)
    }catch{setError('No se pudieron guardar las instrucciones. Revisa longitud y caracteres permitidos.')}
  }
  const prepare=()=>{
    try{
      if(value.trim().length<1)throw Error('EMPTY')
      if(typeof window==='undefined')throw Error('NO_UI')
      const requestId=typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'
        ?crypto.randomUUID():'field-'+Date.now()+'-'+Math.random().toString(36).slice(2)
      const task:PendingFieldRequest={appId,sectionId,fieldId,requestId,expectedRevision:formRevision,original:value}
      const prompt=buildFieldAiMission(config,task)
      setPending(task);setProposal(null);setError('')
      setNotice('Petición preparada para Kira. Revisa el borrador del chat y envíalo.')
      window.dispatchEvent(new CustomEvent('phoenix:adaptive-ai-field-draft',{detail:{
        appId,sectionId,fieldId,requestId,prompt,
      }}))
    }catch{setError('Primero introduce información válida y configura la IA para este campo.')}
  }
  return <div className={styles.shell}>
    <div className={styles.toolbar}>
      <button type="button" className={styles.toggle} aria-expanded={expanded}
        onClick={()=>setExpanded(v=>!v)}><PhoenixUiIcon name="sparkles" size={14}/>
        {config.enabled?'IA configurada':'Configurar IA'} <PhoenixUiIcon name={expanded?'chevron-up':'chevron-down'} size={13}/></button>
      {config.enabled&&<button type="button" className={styles.run} disabled={!value.trim()||!!proposal}
        onClick={prepare}>Proponer con Kira</button>}
    </div>
    {expanded&&<div className={styles.config}>
      <label>Capacidad del campo
        <select aria-label={'Capacidad IA '+fieldId} value={skill}
          onChange={event=>setSkill(event.currentTarget.value as FieldSkill)}>
          {(Object.entries(FIELD_SKILLS) as Array<[FieldSkill,{label:string;instruction:string}]>)
            .map(([kind,definition])=><option key={kind} value={kind}>{definition.label}</option>)}
        </select>
      </label>
      <label>Instrucciones adicionales (opcional)
        <textarea aria-label={'Instrucciones IA '+fieldId} maxLength={320} rows={2}
          placeholder="Ej.: conservar números y unidades tal como fueron escritos"
          value={instruction} onChange={event=>setInstruction(event.currentTarget.value)}/>
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={()=>persist(true)}>Guardar instrucciones</button>
        {config.enabled&&<button type="button" onClick={()=>persist(false)}>Desactivar IA</button>}
      </div>
      <small>Solo apps genéricas. El valor no se envía al chat hasta que pulses Proponer y luego envíes el borrador. Nunca escribas aquí datos clínicos o secretos.</small>
    </div>}
    {proposal&&pending&&<div className={styles.review} aria-label="Revisión del resultado de Kira">
      <strong>Antes (sin modificar)</strong>
      <pre>{pending.original}</pre>
      <strong>Propuesta de Kira</strong>
      <pre>{proposal.props.text}</pre>
      {!!proposal.props.missingInformation?.length&&<p>
        <strong>Información faltante:</strong> {proposal.props.missingInformation.join(' · ')}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.accept} onClick={()=>{
          if(!matchesFieldRequest(proposal,pending,formRevision,value)){
            setError('El campo cambió. La propuesta no se aplicó.');setProposal(null);return
          }
          onAccept(proposal.props.text)
          setPending(null);setProposal(null);setNotice('Propuesta aplicada al borrador local; revisa su contenido.')
        }}>Aceptar en el campo</button>
        <button type="button" onClick={()=>{setPending(null);setProposal(null);setNotice('Propuesta descartada; el original permanece intacto.')}}>Descartar</button>
      </div>
    </div>}
    {notice&&<p className={styles.note} role="status">{notice}</p>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
  </div>
}
