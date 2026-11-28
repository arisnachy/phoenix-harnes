/**
 * Native encounter-note composer, adapted from the legacy Healthia intake,
 * antecedentes, signos vitales and enfermedad-actual workflows.
 *
 * Privacy: clinical values are held only in React memory; no storage, network,
 * chat event, telemetry, model call, or implied clinical signature occurs here.
 * Only an authenticated Host-owned clinical repository may persist records.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CLINICAL_EDITOR_STEPS, VITAL_IDS, DIAGNOSIS_IDS, estimatedMap, extractClinicalVitals, longitudinalFields, validateVital, type ClinicalEditorStep, type LongitudinalPatient, type ClinicalEditorViewState, type ClinicalEditorRequest } from './HealthiaEditorSupport.ts'
import type { ClinicalEditorModel, ClinicalEditorProposal } from './HealthiaClinicalApi.ts'
import css from './HealthiaClinicalNote.module.css'

export type ClinicalNoteKind = 'first' | 'followup' | 'soap' | 'pediatric' | 'obstetric'
export type ClinicalNoteValues = Record<string, string>
export type ClinicalNoteField = {
  readonly id: string
  readonly label: string
  readonly kind?: 'textarea' | 'number' | 'date'
  readonly maxLength?: number
  readonly unit?: string
  readonly for?: readonly ClinicalNoteKind[]
}
export type ClinicalNoteSection = {
  readonly id: string
  readonly label: string
  readonly fields: readonly ClinicalNoteField[]
}

export const NOTE_KINDS: readonly { value: ClinicalNoteKind; label: string }[] = [
  { value: 'first', label: 'Primera consulta' },
  { value: 'followup', label: 'Evolución' },
  { value: 'soap', label: 'SOAP' },
  { value: 'pediatric', label: 'Pediatría' },
  { value: 'obstetric', label: 'Ginecología / obstetricia' },
]

const VITAL_FIELDS: readonly ClinicalNoteField[] = [
  { id: 'sys', label: 'Presión sistólica', kind: 'number', unit: 'mmHg' },
  { id: 'dia', label: 'Presión diastólica', kind: 'number', unit: 'mmHg' },
  { id: 'hr', label: 'Frecuencia cardíaca', kind: 'number', unit: 'lpm' },
  { id: 'rr', label: 'Frecuencia respiratoria', kind: 'number', unit: 'rpm' },
  { id: 'temp', label: 'Temperatura', kind: 'number', unit: '°C' },
  { id: 'sat', label: 'Saturación de oxígeno', kind: 'number', unit: '%' },
  { id: 'weight', label: 'Peso', kind: 'number', unit: 'kg' },
  { id: 'height', label: 'Talla', kind: 'number', unit: 'cm' },
]

/** Stable, typed field IDs. Blank means unknown, NEVER absent or negative. */
export const CLINICAL_NOTE_SECTIONS: readonly ClinicalNoteSection[] = [
  { id: 'interview', label: 'Entrevista', fields: [
    { id: 'date', label: 'Fecha de consulta', kind: 'date' },
    { id: 'chief', label: 'Motivo de consulta', maxLength: 400 },
    { id: 'hea', label: 'Historia de la enfermedad actual', kind: 'textarea', maxLength: 4500 },
    { id: 'ros', label: 'Revisión por sistemas', kind: 'textarea', maxLength: 1800 },
  ] },
  { id: 'background', label: 'Antecedentes', fields: [
    { id: 'personal', label: 'Antecedentes personales patológicos', kind: 'textarea' },
    { id: 'surgical', label: 'Quirúrgicos y hospitalizaciones', kind: 'textarea' },
    { id: 'family', label: 'Heredofamiliares', kind: 'textarea' },
    { id: 'habits', label: 'Hábitos y contexto social', kind: 'textarea' },
    { id: 'allergies', label: 'Alergias declaradas', kind: 'textarea' },
    { id: 'medications', label: 'Tratamiento habitual', kind: 'textarea' },
    { id: 'perinatal', label: 'Antecedentes perinatales y desarrollo', kind: 'textarea', for: ['pediatric'] },
    { id: 'gyneco', label: 'Antecedentes gineco-obstétricos', kind: 'textarea', for: ['obstetric'] },
    { id: 'fum', label: 'FUM (si se conoce)', kind: 'date', for: ['obstetric'] },
  ] },
  { id: 'exam', label: 'Exploración', fields: [
    ...VITAL_FIELDS,
    { id: 'physical', label: 'Examen físico por sistemas', kind: 'textarea', maxLength: 3500 },
    { id: 'findings', label: 'Resultados clínicos relevantes', kind: 'textarea' },
  ] },
  { id: 'plan', label: 'Evaluación y plan', fields: [
    { id: 'assessment', label: 'Impresión clínica y razonamiento', kind: 'textarea', maxLength: 3500 },
    { id: 'differential', label: 'Diagnósticos diferenciales o incertidumbres', kind: 'textarea' },
    { id: 'diagnosisStatus', label: 'Estado diagnóstico (sospecha, provisional o confirmado)' },
    { id: 'secondaryDiagnosis', label: 'Diagnósticos adicionales y su evidencia', kind: 'textarea' },
    { id: 'codeSystem', label: 'Terminología o variante de codificación utilizada' },
    { id: 'icd10', label: 'CIE-10 sugerido (requiere verificación)' },
    { id: 'icd11', label: 'CIE-11 propuesto' },
    { id: 'icd11Evidence', label: 'Evidencia de consulta OMS (CIE-11)' },
    { id: 'plan', label: 'Tratamiento e indicaciones', kind: 'textarea', maxLength: 3500 },
    { id: 'tests', label: 'Analíticas consideradas (las órdenes se emiten por separado)', kind: 'textarea' },
    { id: 'imaging', label: 'Imágenes diagnósticas consideradas (no emitidas)', kind: 'textarea' },
    { id: 'referrals', label: 'Derivaciones e interconsultas consideradas', kind: 'textarea' },
    { id: 'healthEducation', label: 'Educación y recomendaciones de estilo de vida', kind: 'textarea' },
    { id: 'returnPrecautions', label: 'Signos de alarma e indicaciones de retorno', kind: 'textarea' },
    { id: 'followup', label: 'Seguimiento y signos de alarma', kind: 'textarea' },
  ] },
]

export function fieldsForKind(section: ClinicalNoteSection, kind: ClinicalNoteKind): readonly ClinicalNoteField[] {
  return section.fields.filter(field => field.for === undefined || field.for.includes(kind))
}

function safeValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function describeVital(field: ClinicalNoteField, value: string): string {
  if (!value || !Number.isFinite(Number(value))) return ''
  return `${field.label}: ${value}${field.unit ? ' ' + field.unit : ''}`
}

export function clinicalBmi(values: Readonly<ClinicalNoteValues>): number | undefined {
  const kg = Number(values.weight)
  const cm = Number(values.height)
  if (!safeValue(values.weight) || !safeValue(values.height)
    || !Number.isFinite(kg) || !Number.isFinite(cm)
    || kg <= 0 || cm <= 0 || kg > 1000 || cm > 300) return undefined
  const calculated = kg / Math.pow(cm / 100, 2)
  return Math.round(calculated * 10) / 10
}

/** Pure draft composition: never invent facts, negatives, normal findings or signatures. */
export function formatClinicalNote(kind: ClinicalNoteKind, values: Readonly<ClinicalNoteValues>): string {
  const title = NOTE_KINDS.find(item => item.value === kind)?.label ?? 'Consulta'
  const lines: string[] = [title + ' · BORRADOR SIN FIRMAR']
  for (const section of CLINICAL_NOTE_SECTIONS) {
    const parts = fieldsForKind(section, kind).flatMap(field => {
      const value = safeValue(values[field.id])
      if (!value) return []
      if (field.kind === 'number') {
        const description = describeVital(field, value)
        return description ? [description] : []
      }
      return [`${field.label}: ${value.replace(/\r\n|\r|\n/gu, '\n  ')}`]
    })
    if (section.id === 'exam') {
      const bmi = clinicalBmi(values)
      if (bmi !== undefined) parts.push(`IMC calculado: ${bmi} kg/m²`)
    }
    if (parts.length > 0) lines.push('', section.label.toUpperCase(), ...parts)
  }
  lines.push('', 'Pendiente de revisión, vinculación al paciente y firma profesional.')
  return lines.join('\n')
}

/** Serialize a complete note across the Host's four encrypted encounter columns.
 * Never truncate clinical prose or silently discard nonempty fields.
 */
export function formatClinicalNoteParts(kind:ClinicalNoteKind,values:Readonly<ClinicalNoteValues>):{
  history:string;exam:string;assessment:string;plan:string
}{
  const title=NOTE_KINDS.find(item=>item.value===kind)?.label??'Consulta'
  const write=(field:ClinicalNoteField):string=>{
    const value=safeValue(values[field.id])
    if(!value)return ''
    if(field.kind==='number')return describeVital(field,value)
    return field.label+': '+value.replace(/\r\n|\r|\n/gu,'\n  ')
  }
  const section=(id:string,ids?:readonly string[]):string=>{
    const selected=CLINICAL_NOTE_SECTIONS.find(item=>item.id===id)
    if(!selected)return ''
    const lines=fieldsForKind(selected,kind).filter(f=>ids===undefined||ids.includes(f.id))
      .map(write).filter(Boolean)
    if(id==='exam'){
      const bmi=clinicalBmi(values)
      if(bmi!==undefined)lines.push('IMC calculado: '+bmi+' kg/m²')
    }
    return lines.length?selected.label.toUpperCase()+'\n'+lines.join('\n'):''
  }
  const history=[title+' · BORRADOR SIN FIRMAR',section('interview'),section('background')].filter(Boolean).join('\n\n')
  const exam=section('exam')
  const assessment=section('plan',['assessment','differential','icd10','icd11','icd11Evidence','diagnosisStatus','secondaryDiagnosis','codeSystem'])
  const plan=section('plan',['plan','tests','followup','healthEducation','referrals','imaging','returnPrecautions'])
  return {history,exam,assessment,plan}
}

/** Clinical values remain local to this React tree unless the authenticated
 * Host-owned persistence callback is explicitly supplied and clicked. */
export function HealthiaClinicalNote({
  onReturn, initialValues = {}, initialKind = 'first', onSave, patient, encounterVersion, requestedStep, loadModels, refineField, onDirtyChange, onEditorState, verifyIcd11,
}: {
  verifyIcd11?: (code:string)=>Promise<{code:string;release:string;source:string;verifiedAt:string}>
  onReturn?: () => void
  onDirtyChange?: ((dirty:boolean)=>void) | undefined
  onEditorState?: ((state:ClinicalEditorViewState|null)=>void) | undefined
  patient?: LongitudinalPatient | undefined
  encounterVersion?: number | undefined
  requestedStep?: ClinicalEditorRequest | undefined
  loadModels?: (()=>Promise<readonly ClinicalEditorModel[]>) | undefined
  refineField?: ((field:string,text:string,model:ClinicalEditorModel,confirmed:boolean)=>Promise<ClinicalEditorProposal>) | undefined
  initialValues?: ClinicalNoteValues
  initialKind?: ClinicalNoteKind
  onSave?: (kind: ClinicalNoteKind, values: Readonly<ClinicalNoteValues>) => Promise<void>
}) {
  const [kind, setKind] = useState<ClinicalNoteKind>(initialKind)
  const [values, setValues] = useState<ClinicalNoteValues>(() => ({ ...initialValues }))
  const [saving, setSaving] = useState(false)
  const [icdBusy,setIcdBusy]=useState(false)
  const [icdStatus,setIcdStatus]=useState('')
  const icdEpoch=useRef(0)
  useEffect(()=>{icdEpoch.current++;setIcdBusy(false);setIcdStatus('');return()=>{icdEpoch.current++}},[encounterVersion])
  const baseline=useRef(formatClinicalNote(initialKind,initialValues))
  const [section, setSection] = useState<ClinicalEditorStep>('interview')
  const [activeFieldId,setActiveFieldId]=useState('')
  const editorRoot=useRef<HTMLElement>(null)
  const [preview, setPreview] = useState(false)
  const [message, setMessage] = useState('')
  const note = useMemo(() => formatClinicalNote(kind, values), [kind, values])
  const dirty=note!==baseline.current
  useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
  const hasContent = Object.values(values).some(value => value.trim().length > 0)
  const current = CLINICAL_NOTE_SECTIONS.find(item => item.id === (section==='vitals'?'exam':section==='diagnosis'?'plan':section)) ?? CLINICAL_NOTE_SECTIONS[0]!
  const shown=fieldsForKind(current,kind).filter(f=>section==='vitals'?VITAL_IDS.some(id=>id===f.id):section==='exam'?!VITAL_IDS.some(id=>id===f.id):section==='diagnosis'?DIAGNOSIS_IDS.some(id=>id===f.id):section==='plan'?!DIAGNOSIS_IDS.some(id=>id===f.id):true)
  const step=CLINICAL_EDITOR_STEPS.find(x=>x.id===section)!
  const visibleIds=shown.map(f=>f.id).join(',')
  const filledFields=shown.filter(f=>!!values[f.id]?.trim()).length
  const canEdit=onSave!==undefined
  const hasEncounter=encounterVersion!==undefined
  const modelEnabled=loadModels!==undefined&&refineField!==undefined
  const contextNonce=useRef('')
  if(!contextNonce.current)contextNonce.current=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2)
  const binding=contextNonce.current+':'+String(encounterVersion??'none')
  const handledAction=useRef<number|undefined>(undefined)

  useEffect(()=>()=>{onEditorState?.(null)},[onEditorState])

  const [quick,setQuick]=useState('')
  const [vitalDraft,setVitalDraft]=useState<ReturnType<typeof extractClinicalVitals>|null>(null)
  const [models,setModels]=useState<readonly ClinicalEditorModel[]>([])
  const [modelId,setModelId]=useState('')
  const [aiField,setAiField]=useState('')
  const currentSource=(field:string):string=>field==='context-review'?formatClinicalNote(kind,values):values[field]??''
  const [consent,setConsent]=useState(false)
  const [aiBusy,setAiBusy]=useState(false)
  // Structural awareness only: "documented" means text entered, never clinically complete.
  const documentedSections=CLINICAL_EDITOR_STEPS.filter(item=>{
    const source=CLINICAL_NOTE_SECTIONS.find(s=>s.id===(item.id==='vitals'?'exam':item.id==='diagnosis'?'plan':item.id))
    if(!source)return false
    const relevant=fieldsForKind(source,kind).filter(f=>item.id==='vitals'?VITAL_IDS.some(id=>id===f.id):
      item.id==='exam'?!VITAL_IDS.some(id=>id===f.id):item.id==='diagnosis'?DIAGNOSIS_IDS.some(id=>id===f.id):
      item.id==='plan'?!DIAGNOSIS_IDS.some(id=>id===f.id):true)
    return relevant.some(f=>!!values[f.id]?.trim())
  }).map(item=>item.id).join(',')
  const nextSection=CLINICAL_EDITOR_STEPS.find(item=>!documentedSections.split(',').includes(item.id))?.id
  useEffect(()=>{
    onEditorState?.({step:section,binding,visibleFieldIds:visibleIds?visibleIds.split(','):[],
      filledFields,dirty,hasEncounter,canEdit,modelEnabled,busy:saving||aiBusy||icdBusy,
      ...(activeFieldId&&visibleIds.split(',').includes(activeFieldId)?{activeFieldId}:{}),
      documentedSections:CLINICAL_EDITOR_STEPS.filter(item=>documentedSections.split(',').includes(item.id)).map(item=>item.id),
      ...(nextSection?{nextSection}:{})})
  },[onEditorState,section,binding,visibleIds,filledFields,dirty,hasEncounter,canEdit,modelEnabled,saving,aiBusy,icdBusy,activeFieldId,documentedSections,nextSection])
  useEffect(()=>{
    if(!requestedStep)return
    // Reveal only the existing inline editor; never create a second form or move the composer.
    const node=editorRoot.current
    if(node&&typeof node.scrollIntoView==='function')node.scrollIntoView({block:'nearest',behavior:'auto'})
  },[requestedStep?.sequence])
  const [proposal,setProposal]=useState<{field:string;original:string;version:number|undefined;result:ClinicalEditorProposal}|null>(null)
  const generation=useRef(0)
  const live=useRef({values,encounterVersion,note})
  live.current={values,encounterVersion,note}
  const model=models.find(m=>m.id===modelId)
  const invalidVitals=VITAL_IDS.filter(id=>!!values[id]&&!validateVital(id,values[id]!))
  const reversed=!!values.sys&&!!values.dia&&Number(values.sys)<Number(values.dia)
  const hasInvalidVitals=invalidVitals.length>0||reversed
  const eligible=(id:string)=>['chief','hea','ros','personal','surgical','family','habits','medications','perinatal','gyneco','physical','findings'].includes(id)
  useEffect(()=>{if(requestedStep&&!requestedStep.action){setSection(requestedStep.step);setPreview(false)}},[requestedStep])
  useEffect(()=>{generation.current++;setProposal(null);setAiBusy(false)},[encounterVersion])
  useEffect(()=>()=>{generation.current++},[])
  const openAi=async(id:string)=>{
    if(!loadModels||!refineField||aiBusy)return
    setAiField(id);setProposal(null);setConsent(false);setMessage('')
    const token=++generation.current
    try{const list=await loadModels();if(token!==generation.current)return
      setModels(list);setModelId(list.find(m=>m.location==='local')?.id??'')
      if(!list.length)setMessage('No hay modelos clínicos disponibles.')
    }catch{if(token===generation.current)setMessage('No se pudo consultar el catálogo de modelos.')}
  }
  const generate=async()=>{
    if(!refineField||!model||!consent||aiBusy||!currentSource(aiField).trim()||(aiField==='context-review'&&!hasContent))return
    const field=aiField,original=currentSource(field),version=encounterVersion,token=++generation.current
    setAiBusy(true);setProposal(null);setMessage('')
    try{const result=await refineField(field,original,model,true)
      if(token!==generation.current)return
      if((field==='context-review'?live.current.note:live.current.values[field])!==original||live.current.encounterVersion!==version){setMessage('El campo o la consulta cambió. La propuesta fue descartada.');return}
      setProposal({field,original,version,result})
    }catch(e){if(token===generation.current)setMessage(e instanceof Error?e.message:'No se pudo generar la propuesta.')}
    finally{if(token===generation.current)setAiBusy(false)}
  }
  const importBackground=()=>{
    if(!patient)return
    const allowed=fieldsForKind(CLINICAL_NOTE_SECTIONS.find(s=>s.id==='background')!,kind)
    const recovered=longitudinalFields(patient)
    setValues(previous=>{const next={...previous};for(const field of allowed){const value=recovered[field.id];if(value&&!next[field.id]?.trim()&&value.length<=(field.maxLength??1800))next[field.id]=value}return next})
    setMessage('Antecedentes previos incorporados solo en campos vacíos. Reconfirme vigencia y alergias.')
  }
  // A chat control can open assistance or prepare a local draft only; the
  // ephemeral binding prevents applying an old card to another encounter.
  useEffect(()=>{
    if(!requestedStep?.action||requestedStep.binding!==binding||!canEdit||saving
      ||handledAction.current===requestedStep.sequence)return
    handledAction.current=requestedStep.sequence
    setSection(requestedStep.step);setPreview(false)
    if(requestedStep.action==='clinical-refine-chief'||requestedStep.action==='clinical-refine-hea'){
      const field=requestedStep.action==='clinical-refine-chief'?'chief':'hea'
      if(!values[field]?.trim()){setMessage('Introduce primero el texto clínico en este campo.');return}
      void openAi(field)
    }else if(requestedStep.action==='clinical-import-background')importBackground()
    else if(requestedStep.action==='clinical-preview')setPreview(true)
    else if(requestedStep.action==='clinical-context-review'){if(hasContent)void openAi('context-review');else setMessage('Documenta la consulta antes de solicitar valoración.')}
  },[requestedStep,binding,canEdit,saving])
  const edit = (id: string, value: string): void => {
    if(proposal?.field==='context-review')setProposal(null)
    if(id==='icd11'){icdEpoch.current++;setIcdBusy(false);setIcdStatus('')}
    setValues(previous => ({ ...previous, [id]: value, ...(id==='icd11'?{icd11Evidence:''}:{}) }))
    setMessage('')
  }
  const reset = (): void => {
    icdEpoch.current++;setIcdBusy(false);setIcdStatus('')
    generation.current++;setAiBusy(false);setProposal(null);setAiField('');setVitalDraft(null);setQuick('')
    setValues({...initialValues});setKind(initialKind)
    baseline.current=formatClinicalNote(initialKind,initialValues)
    onDirtyChange?.(false)
    setPreview(false)
    setSection('interview')
    setMessage('Cambios de esta vista descartados. Los registros previamente guardados no se han modificado.')
  }
  const save = async (): Promise<void> => {
    if (!onSave || !hasContent || saving || hasInvalidVitals || icdBusy) return
    setSaving(true)
    setMessage('')
    try {
      // The owning clinical session must recheck patient, role, version and CSRF.
      await onSave(kind, { ...values })
      baseline.current=note
      onDirtyChange?.(false)
      setMessage('Borrador registrado en el servicio clínico protegido. Sin firmar.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la nota.')
    } finally {
      setSaving(false)
    }
  }
  const copy = async (): Promise<void> => {
    if (!hasContent) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(note)
      setMessage('Borrador copiado por solicitud del profesional. No se ha guardado en el expediente.')
    } catch {
      setMessage('No fue posible copiar el borrador. Puedes seleccionar la vista previa.')
    }
  }
  const showPreview = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setPreview(true)
  }
  return (
    <section ref={editorRoot} className={css.root} aria-label="Historia clínica estructurada">
      <div className={css.top}>
        <div>
          <h3>Historia clínica</h3>
          <p>{onSave?'Borrador · sin firma':'Vista sin guardado'}</p>
        </div>
        {onReturn && <button type="button" className={css.secondary} onClick={onReturn}>Volver</button>}
      </div>
      <form onSubmit={showPreview} autoComplete="off">
        <fieldset disabled={saving} className={css.editorFields}>
        <label className={css.noteKind}>Tipo de consulta
          <select value={kind} onChange={event => { setKind(event.currentTarget.value as ClinicalNoteKind); setPreview(false) }} aria-label="Tipo de consulta">
            {NOTE_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className={css.steps} role="group" aria-label="Secciones de historia clínica">
          {CLINICAL_EDITOR_STEPS.map((item,index) => (
            <button key={item.id} type="button" className={item.id === section ? css.stepActive : css.step}
              aria-pressed={item.id === section} data-documented={documentedSections.split(',').includes(item.id)} onClick={() => { setSection(item.id); setPreview(false) }}>
              <span className={css.stepIndex} aria-hidden="true">{index+1}</span><span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className={css.sectionTitle}><h4>{step.label}</h4><small>{filledFields} de {shown.length} campos completados</small>{nextSection&&nextSection!==section&&<button type="button" className={css.secondary} onClick={()=>{setSection(nextSection);setPreview(false)}}>Siguiente sección pendiente</button>}</div>
        {section==='background'&&patient&&<div className={css.assist}><strong>Expediente longitudinal</strong><p>Última revisión: {patient.medicalHistoryReview?.reviewedAt??'No documentada'}. No se reemplazan datos escritos ni se importan mediciones anteriores.</p><button type="button" className={css.secondary} onClick={importBackground}>Recuperar antecedentes previos</button></div>}
        {section==='vitals'&&<div className={css.assist}>
          <label className={css.wideField}>Entrada rápida de mediciones
            <textarea rows={2} maxLength={2000} value={quick} placeholder="PA 120/80, pulso 76, temperatura 36.7 °C, peso 72 kg, talla 170 cm" onChange={e=>{setQuick(e.currentTarget.value);setVitalDraft(null)}}/>
          </label>
          <button type="button" className={css.secondary} onClick={()=>setVitalDraft(extractClinicalVitals(quick))}>Extraer mediciones</button>
          {vitalDraft&&<div className={css.proposal}>
            {Object.entries(vitalDraft.values).map(([id,value])=><p key={id}>{current.fields.find(f=>f.id===id)?.label??id}: {value}{values[id]&&values[id]!==value?' (reemplaza '+values[id]+')':''}</p>)}
            {vitalDraft.warnings.map(w=><p key={w}>{w}</p>)}
            <button type="button" className={css.primary} disabled={!Object.keys(vitalDraft.values).length} onClick={()=>{setValues(old=>({...old,...vitalDraft.values} as ClinicalNoteValues));setVitalDraft(null);setQuick('')}}>Confirmar mediciones actuales</button>
          </div>}
        </div>}
        <div className={section==='vitals'?css.vitals:css.fields}>
          {shown.map(field => (
            <div key={field.id} className={field.kind === 'textarea'||field.id==='chief' ? css.wideField : css.field}>
              <label className={css.fieldLabel}><span>{field.label}{field.unit ? ` · ${field.unit}` : ''}</span>
              {field.kind === 'textarea' ? (
                <textarea rows={field.id==='hea'?5:3} placeholder={field.id==='hea'?'Inicio, evolución, características, síntomas asociados y contexto clínico…':'No documentado'} maxLength={field.maxLength ?? 1800} value={values[field.id] ?? ''}
                  onFocus={()=>setActiveFieldId(field.id)} onChange={event => edit(field.id, event.currentTarget.value)} />
              ) : (
                <input type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
                  maxLength={field.kind === 'number' || field.kind === 'date' ? undefined : (field.maxLength ?? 400)}
                  readOnly={field.id==='icd11Evidence'} step={field.kind === 'number' ? 'any' : undefined}
                  placeholder={field.id==='chief'?'Motivo principal en palabras del paciente':'No documentado'} value={values[field.id] ?? ''} onFocus={()=>setActiveFieldId(field.id)} onChange={event => edit(field.id, event.currentTarget.value)} />
              )}</label>
              {refineField&&eligible(field.id)&&<button className={css.aiAction} type="button" disabled={!values[field.id]?.trim()||aiBusy} onClick={()=>{void openAi(field.id)}}>✦ Mejorar con IA</button>}
            </div>
          ))}
        </div>
        {section==='diagnosis'&&verifyIcd11&&<div className={css.assist}>
          <strong>Verificación oficial CIE-11 · OMS</strong>
          <p>Se transmite únicamente el código simple, sin datos del paciente. Confirmar el código no confirma el diagnóstico clínico.</p>
          <button type="button" className={css.secondary} disabled={icdBusy||!values.icd11?.trim()} onClick={()=>{
            const code=values.icd11!.trim().toUpperCase(),epoch=++icdEpoch.current
            setIcdBusy(true);setIcdStatus('')
            void verifyIcd11(code).then(result=>{
              if(epoch!==icdEpoch.current)return
              setValues(old=>old.icd11?.trim().toUpperCase()===code?{...old,icd11:result.code,icd11Evidence:'OMS MMS '+result.release+' · '+result.verifiedAt+' · '+result.source}:old)
              setIcdStatus('Código encontrado en la clasificación oficial.')
            }).catch(()=>{if(epoch===icdEpoch.current)setIcdStatus('No verificado. Comprueba la conexión, las credenciales OMS y el código.')})
              .finally(()=>{if(epoch===icdEpoch.current)setIcdBusy(false)})
          }}>{icdBusy?'Consultando OMS…':'Verificar código CIE-11'}</button>
          {icdStatus&&<p role="status">{icdStatus}</p>}
        </div>}
        {section==='diagnosis'&&refineField&&<div className={css.assist}><strong>Valoración contextual de Kira</strong><p>Revisa el borrador actual, antecedentes y registros recientes autorizados. Propone diferenciales, preguntas y estudios para evaluación profesional, no diagnósticos definitivos ni recetas.</p><button type="button" className={css.secondary} disabled={!hasContent||aiBusy} onClick={()=>{void openAi('context-review')}}>Analizar contexto de la consulta</button></div>}
        {section==='vitals'&&<div className={css.metrics}><div><small>IMC calculado</small><strong>{clinicalBmi(values)??'—'} kg/m²</strong></div><div><small>PAM estimada</small><strong>{estimatedMap(values)??'—'} mmHg</strong></div></div>}
        {hasInvalidVitals&&<p role="alert" className={css.status}>Verifica las mediciones y unidades antes de guardar. Los límites son de entrada, no rangos clínicos normales.</p>}
        {aiField&&refineField&&<div className={css.assist} aria-label="Asistencia IA clínica">
          <strong>{aiField==='context-review'?'Valoración del contexto clínico':'Mejorar '+(CLINICAL_NOTE_SECTIONS.flatMap(s=>s.fields).find(f=>f.id===aiField)?.label??'campo')}</strong>
          <label className={css.fieldLabel}>Modelo clínico<select value={modelId} onChange={e=>{setModelId(e.currentTarget.value);setConsent(false);setProposal(null)}} disabled={aiBusy}><option value="">Seleccionar modelo</option>{models.map(m=><option key={m.id} value={m.id}>{m.label} · {m.location==='local'?'Local':'Externo'}</option>)}</select></label>
          {model&&<label className={css.check}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.currentTarget.checked)} disabled={aiBusy}/>{model.location==='external'?'Autorizo enviar '+(aiField==='context-review'?'el borrador y los antecedentes y registros recientes autorizados':'este campo clínico')+' al proveedor externo conforme a las reglas de mi institución.':'Autorizo procesar '+(aiField==='context-review'?'el borrador y los antecedentes y registros recientes autorizados':'este campo')+' en el modelo local.'}</label>}
          <div className={css.actions}><button className={css.primary} type="button" disabled={!model||!consent||aiBusy} onClick={()=>{void generate()}}>{aiBusy?'Generando…':'Generar propuesta'}</button><button className={css.secondary} type="button" onClick={()=>{generation.current++;setAiBusy(false);setAiField('');setProposal(null)}}>Cerrar asistencia</button></div>
          {proposal?.field==='context-review'&&proposal.original===note&&<div className={css.proposal}><strong>Valoración de apoyo · sin verificar · {proposal.result.model}</strong><p>{proposal.result.text}</p><p>Verifica los hallazgos, las hipótesis y las indicaciones con el expediente y las fuentes clínicas. No se ha modificado ni firmado la historia.</p></div>}
          {proposal&&proposal.field!=='context-review'&&<div className={css.proposal}><strong>Original</strong><p>{proposal.original}</p><strong>Propuesta sin verificar · {proposal.result.model}</strong><p>{proposal.result.text}</p>{proposal.result.numericWarnings.length>0&&<p role="alert">Cifras nuevas: {proposal.result.numericWarnings.join(', ')}. Verifique contra la fuente.</p>}<button type="button" className={css.primary} disabled={values[proposal.field]!==proposal.original||encounterVersion!==proposal.version||proposal.result.text.length>(CLINICAL_NOTE_SECTIONS.flatMap(s=>s.fields).find(f=>f.id===proposal.field)?.maxLength??1800)} onClick={()=>{edit(proposal.field,proposal.result.text);setProposal(null);setAiField('');setMessage('Propuesta aceptada en el borrador, pendiente de guardar.')}}>Aceptar texto revisado</button></div>}
        </div>}
        <div className={css.actions}>
          <button type="button" className={css.secondary} disabled={section==='interview'} onClick={()=>{setSection(CLINICAL_EDITOR_STEPS[CLINICAL_EDITOR_STEPS.findIndex(s=>s.id===section)-1]!.id);setPreview(false)}}>Anterior</button>
          <button type="button" className={css.secondary} disabled={section==='plan'} onClick={()=>{setSection(CLINICAL_EDITOR_STEPS[CLINICAL_EDITOR_STEPS.findIndex(s=>s.id===section)+1]!.id);setPreview(false)}}>Siguiente</button>
          <button type="submit" className={css.primary} disabled={!hasContent}>Vista previa de nota</button>
          {onSave && <button type="button" className={css.primary} disabled={!hasContent || saving || hasInvalidVitals || aiBusy || icdBusy}
            onClick={() => { void save() }}>{saving ? 'Guardando…' : 'Guardar borrador clínico'}</button>}
          <button type="button" className={css.secondary} onClick={reset} disabled={!hasContent || saving}>Descartar cambios</button>
        </div>
        </fieldset>
      </form>
      {preview && hasContent && (
        <section className={css.preview} aria-label="Vista previa clínica">
          <div className={css.previewHeader}>
            <strong>Nota generada · sin firmar</strong>
            <button type="button" className={css.secondary} onClick={() => { void copy() }}>Copiar borrador</button>
          </div>
          <pre>{note}</pre>
        </section>
      )}
      {message && <p role="status" className={css.status}>{message}</p>}
      <p className={css.disclaimer}>Los datos no registrados permanecen desconocidos. Las inferencias y códigos deben ser revisados por el profesional antes de incorporarlos al expediente protegido.</p>
    </section>
  )
}
