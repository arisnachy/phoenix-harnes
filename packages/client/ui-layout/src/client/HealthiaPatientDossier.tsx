/**
 * Native, longitudinal patient dossier. Only the protected /health API can
 * serve PHI; none of it is copied to chat, model prompts or browser storage.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { HealthiaClinicalApi } from './HealthiaClinicalApi.ts'
import type { ClinicalPatient, ClinicalPatientContext, ClinicalChartItem, ClinicalSession, ClinicalIntakeTemplate } from './HealthiaClinicalApi.ts'
import css from './HealthiaPatientDossier.module.css'

const api = new HealthiaClinicalApi()
type Tab = 'summary'|'history'|'encounters'|'medications'|'studies'|'followup'
const TABS: readonly {id:Tab;name:string}[] = [
  {id:'summary',name:'Resumen'}, {id:'history',name:'Antecedentes'},
  {id:'encounters',name:'Consultas'}, {id:'medications',name:'Medicación'},
  {id:'studies',name:'Estudios y archivos'}, {id:'followup',name:'Seguimiento'},
]
const HISTORY: readonly {name:string;fields:readonly {id:string;label:string}[]}[] = [
  {name:'Clínicos y familiares',fields:[
    {id:'problems',label:'Lista de problemas confirmados'},
    {id:'pastMedical',label:'Enfermedades y antecedentes patológicos'},
    {id:'pastSurgical',label:'Procedimientos quirúrgicos'},
    {id:'hospitalizations',label:'Hospitalizaciones'},
    {id:'familyHistory',label:'Antecedentes heredofamiliares'},
    {id:'trauma',label:'Traumatismos'},
    {id:'transfusions',label:'Transfusiones'},
    {id:'vaccinations',label:'Vacunación documentada'},
  ]},
  {name:'Tratamiento y hábitos',fields:[
    {id:'currentMedications',label:'Tratamiento habitual y conciliación'},
    {id:'habits',label:'Hábitos y estilo de vida'},
    {id:'tobacco',label:'Tabaco'}, {id:'alcohol',label:'Alcohol'},
    {id:'sleep',label:'Sueño'}, {id:'nutrition',label:'Alimentación'},
    {id:'physicalActivity',label:'Actividad física'},
    {id:'occupation',label:'Ocupación'}, {id:'exposures',label:'Exposiciones'},
    {id:'housing',label:'Vivienda y contexto social'},
  ]},
  {name:'Valoraciones por etapa de vida',fields:[
    {id:'gynecologicObstetric',label:'Antecedentes gineco-obstétricos'},
    {id:'pediatricDevelopment',label:'Crecimiento y desarrollo pediátrico'},
    {id:'geriatricFunction',label:'Funcionalidad geriátrica'},
    {id:'mentalHealthHistory',label:'Antecedentes de salud mental'},
    {id:'reviewOfSystems',label:'Revisión por sistemas'},
  ]},
]
const HISTORY_IDS = HISTORY.flatMap(section=>section.fields.map(field=>field.id))
const safeValue = (value:unknown, fallback='No documentado'):string =>
  typeof value==='string'&&value.trim()?value.trim():fallback
function displayDate(value:unknown):string {
  if(typeof value!=='string'||!value)return 'Fecha no documentada'
  const time=Date.parse(value)
  return Number.isFinite(time)?new Date(time).toLocaleDateString('es-DO',{year:'numeric',month:'short',day:'numeric'}):'Fecha no documentada'
}
function recordName(row:ClinicalChartItem):string {
  for(const key of ['complaint','description','display','name','medication','title','test','study','diagnosis']) {
    if(typeof row[key]==='string'&&String(row[key]).trim())return String(row[key])
  }
  return 'Registro clínico'
}
function Records({label,items}:{label:string;items:readonly ClinicalChartItem[]}) {
  return <section className={css.records}>
    <h4>{label} <span className={css.count}>{items.length}</span></h4>
    {!items.length?<p className={css.empty}>No hay registros documentados en esta sección.</p>:
      <div className={css.recordList}>{items.map(row=><article key={String(row.id)} className={css.record}>
        <div><strong>{recordName(row)}</strong><small>{displayDate(row.createdAt??row.effectiveAt??row.scheduledAt)}</small></div>
        <span className={css.state}>{safeValue(row.status,'Registrado')}</span>
      </article>)}</div>}
  </section>
}
export function HealthiaPatientDossier({
  session, patient, onPatientUpdated, intakeTemplate,
}:{
  session:ClinicalSession
  patient:ClinicalPatient
  intakeTemplate?:ClinicalIntakeTemplate|null
  onPatientUpdated:(patient:ClinicalPatient)=>void
}) {
  const allowed=['clinician','psychologist'].includes(session.actor.role)
  const mayEdit=session.actor.role==='clinician'
  const [tab,setTab]=useState<Tab>('summary')
  const [context,setContext]=useState<ClinicalPatientContext|null>(null)
  const [loading,setLoading]=useState(false)
  const [revision,setRevision]=useState(0)
  const [history,setHistory]=useState<Record<string,string>>({})
  const [allergyStatus,setAllergyStatus]=useState<'none-known'|'documented'|'unreviewed'>('unreviewed')
  const [allergyDetails,setAllergyDetails]=useState('')
  const [sexAtBirth,setSexAtBirth]=useState<''|'female'|'male'|'intersex'|'unknown'>('')
  const [genderIdentity,setGenderIdentity]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')

  useEffect(()=>{
    if(!allowed){setContext(null);return}
    let active=true
    setContext(null);setLoading(true);setError('')
    void api.patientContext(session,patient.id).then(result=>{
      if(!active)return
      setContext(result)
      const saved=result.patient.medicalHistory??{}
      setHistory(Object.fromEntries(HISTORY_IDS.map(id=>[id,typeof saved[id]==='string'?saved[id]:''])))
      setSexAtBirth(result.patient.sexAtBirth??'')
      setGenderIdentity(result.patient.genderIdentity??'')
      const allergy=result.patient.allergyReview
      setAllergyStatus(allergy?.status??'unreviewed')
      setAllergyDetails(allergy?.details??'')
    }).catch(err=>{
      if(active)setError(err instanceof Error?err.message:'No se pudo abrir el expediente autorizado.')
    }).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[session,patient.id,revision,allowed])

  const historySubmit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!context||!mayEdit||busy)return
    setBusy(true);setError('');setNotice('')
    try {
      const changed=await api.updatePatientHistory(session,context.patient,{
        ...Object.fromEntries(HISTORY_IDS.map(id=>[id,history[id]??''])),
      })
      onPatientUpdated(changed)
      setNotice('Antecedentes guardados en la historia cifrada; revisión registrada.')
      setRevision(value=>value+1)
    }catch(err){setError(err instanceof Error?err.message:'No se guardaron los antecedentes.')}
    finally{setBusy(false)}
  }
  const allergySubmit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!context||!mayEdit||busy||allergyStatus==='unreviewed')return
    setBusy(true);setError('');setNotice('')
    try {
      const changed=await api.reviewPatientAllergies(session,context.patient,allergyStatus,allergyDetails)
      onPatientUpdated(changed)
      setNotice('Revisión de alergias confirmada por el profesional.')
      setRevision(value=>value+1)
    }catch(err){setError(err instanceof Error?err.message:'No se guardó la revisión de alergias.')}
    finally{setBusy(false)}
  }
  const identitySubmit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!context||!mayEdit||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const changed=await api.updatePatientIdentityContext(session,context.patient,{
        ...(sexAtBirth?{sexAtBirth}:{}),genderIdentity,
      })
      onPatientUpdated(changed)
      setNotice('Contexto de identidad actualizado en el expediente protegido.')
      setRevision(value=>value+1)
    }catch(e){setError(e instanceof Error?e.message:'No se actualizaron los datos')}
    finally{setBusy(false)}
  }
  const chart=context?.patient??patient
  const allergies=chart.allergyReview
  const clinicianContext=context??null
  return <section className={css.shell} aria-label={'Expediente de '+patient.name}>
    <div className={css.header}>
      <span className={css.avatar} aria-hidden="true">{patient.name.trim().slice(0,1).toUpperCase()}</span>
      <div className={css.heading}>
        <span className={css.eyebrow}>EXPEDIENTE CLÍNICO · REGISTRO PROTEGIDO</span>
        <h3>{patient.name}</h3>
        <p>Nacimiento: {displayDate(patient.dateOfBirth)} · ID interno: {patient.id.slice(0,8)}…</p>
        <p>{safeValue(patient.phone,'Teléfono no registrado')} · {safeValue(patient.email,'Correo no registrado')}</p>
      </div>
      <div className={css.headerEnd}><span className={css.version}>Versión {chart.version}</span>
        {allowed&&<button type="button" disabled={loading||busy} onClick={()=>setRevision(n=>n+1)}>Actualizar expediente</button>}
      </div>
    </div>
    {!allowed&&<p className={css.notice}>La recepción y la administración pueden registrar y localizar pacientes. Los antecedentes y resultados clínicos requieren una relación asistencial autorizada.</p>}
    {allowed&&<>
      <nav className={css.tabs} aria-label="Secciones del expediente">{TABS.map(item=>
        <button type="button" key={item.id} aria-current={tab===item.id?'page':undefined}
          className={tab===item.id?css.active:css.tab} onClick={()=>setTab(item.id)}>{item.name}</button>)}
      </nav>
      {loading&&<p aria-live="polite" className={css.notice}>Leyendo la historia clínica autorizada…</p>}
      {error&&<p role="alert" className={css.error}>{error}</p>}
      {notice&&<p role="status" className={css.notice}>{notice}</p>}
      {clinicianContext&&tab==='summary'&&<>
        <div className={css.kpis}>
          {[['Consultas',clinicianContext.encounters.length],['Órdenes pendientes',clinicianContext.pending.orders],
            ['Seguimientos pendientes',clinicianContext.pending.followups],
            ['Archivos',clinicianContext.attachments.length]].map(([name,count])=>
            <div className={css.metric} key={name}><strong>{count}</strong><span>{name}</span></div>)}
        </div>
        <div className={css.columns}>
          <section className={css.tile}><h4>Alergias y seguridad</h4>
            <p className={allergies?.status==='documented'?css.alert:css.paragraph}>
              {allergies?.status==='documented'?safeValue(allergies.details):
                allergies?.status==='none-known'?'Sin alergias conocidas, revisado por profesional.':
                'No existe revisión de alergias documentada.'}</p>
            {allergies?.reviewedAt&&<small>Revisado: {displayDate(allergies.reviewedAt)} · {safeValue(allergies.reviewedBy)}</small>}
          </section>
          <section className={css.tile}><h4>Tratamiento habitual</h4><p className={css.paragraph}>{safeValue(chart.medicalHistory?.currentMedications)}</p></section>
          <section className={css.tile}><h4>Problemas documentados</h4><p className={css.paragraph}>{safeValue(chart.medicalHistory?.problems)}</p></section>
          <section className={css.tile}><h4>Última consulta</h4>
            <p className={css.paragraph}>{clinicianContext.encounters[0] ? recordName(clinicianContext.encounters[0]) : 'No hay consultas documentadas.'}</p>
          </section>
          <section className={css.tile}><h4>Identidad y contacto</h4>
            <dl className={css.details}>
              <div><dt>Documento</dt><dd>{chart.documentNumber
                ?(chart.documentType==='cedula'?'Cédula':chart.documentType==='passport'?'Pasaporte':'Documento')+' · '+chart.documentNumber
                :'No documentado'}</dd></div>
              <div><dt>Teléfono</dt><dd>{safeValue(chart.phone)}</dd></div>
              <div><dt>Correo</dt><dd>{safeValue(chart.email)}</dd></div>
            </dl>
          </section>
          <section className={css.tile}><h4>Admisión y cobertura</h4>
            {Object.keys(chart.customFields??{}).length
              ?<dl className={css.details}>{Object.entries(chart.customFields??{}).filter(([,value])=>!!value).map(([key,value])=>
                <div key={key}><dt>{intakeTemplate?.fields.find(field=>field.id===key)?.label??key.replace(/^custom_/u,'').replaceAll('_',' ')}</dt>
                  <dd>{value}</dd></div>)}</dl>
              :<p className={css.paragraph}>Sin datos adicionales de admisión.</p>}
            <small>Consentimiento de contacto: {chart.emailConsent===true?'Registrado': 'No consta autorización confirmada'}</small>
          </section>
        </div>
        <Records label="Actividad reciente" items={clinicianContext.timeline.slice(0,12)}/>
      </>}
      {clinicianContext&&tab==='history'&&<>
        <section className={css.tile}>
          <h4>Contexto de identidad clínica</h4>
          <p className={css.helper}>Registra datos aportados o confirmados. Sexo al nacer e identidad
            de género son datos distintos y no determinan solos una indicación terapéutica.</p>
          <form className={css.editForm} onSubmit={event=>{void identitySubmit(event)}}>
            <div className={css.formGrid}>
              <label>Sexo registrado al nacer
                <select value={sexAtBirth} disabled={!mayEdit||busy}
                  onChange={e=>setSexAtBirth(e.target.value as typeof sexAtBirth)}>
                  <option value="">No documentado</option>
                  <option value="female">Femenino</option><option value="male">Masculino</option>
                  <option value="intersex">Intersexual</option><option value="unknown">Desconocido</option>
                </select>
              </label>
              <label>Identidad de género referida (opcional)
                <input maxLength={160} disabled={!mayEdit||busy} value={genderIdentity}
                  onChange={e=>setGenderIdentity(e.target.value)}/>
              </label>
            </div>
            {mayEdit&&<button className={css.primary} type="submit" disabled={busy}>Guardar contexto de identidad</button>}
          </form>
        </section>
        <section className={css.tile}>
          <h4>Revisión de alergias</h4><p className={css.helper}>Selecciona «sin alergias conocidas» únicamente tras confirmarlo en la entrevista. Una casilla vacía nunca significa negativo.</p>
          <form onSubmit={event=>{void allergySubmit(event)}} className={css.editForm}>
            <label>Estado de verificación
              <select value={allergyStatus} disabled={!mayEdit||busy} onChange={e=>setAllergyStatus(e.target.value as typeof allergyStatus)}>
                <option value="unreviewed">Pendiente de revisión</option>
                <option value="none-known">Sin alergias conocidas (confirmado)</option>
                <option value="documented">Alergias documentadas</option>
              </select>
            </label>
            {allergyStatus==='documented'&&<label>Alérgeno, reacción, gravedad y fecha, cuando se conozcan
              <textarea value={allergyDetails} disabled={!mayEdit||busy} maxLength={2500} required onChange={e=>setAllergyDetails(e.target.value)}/></label>}
            {mayEdit&&<button className={css.primary} disabled={busy||allergyStatus==='unreviewed'||allergyStatus==='documented'&&!allergyDetails.trim()} type="submit">Confirmar revisión de alergias</button>}
          </form>
        </section>
        <form className={css.editForm} onSubmit={event=>{void historySubmit(event)}}>
          <div className={css.tile}><h4>Historia clínica longitudinal</h4>
            <p className={css.helper}>Registra hechos documentados. Los campos no completados son «no preguntados/no registrados», nunca resultados normales. Los cambios se guardan con versión y autor.</p>
            {chart.medicalHistoryReview?.reviewedAt&&<small>Última revisión: {displayDate(chart.medicalHistoryReview.reviewedAt)} · {safeValue(chart.medicalHistoryReview.reviewedBy)}</small>}
          </div>
          {HISTORY.map(group=><fieldset key={group.name} className={css.fieldset}>
            <legend>{group.name}</legend>
            <div className={css.formGrid}>{group.fields.map(field=><label key={field.id}>{field.label}
              <textarea rows={2} maxLength={4000} disabled={!mayEdit||busy}
                value={history[field.id]??''} placeholder="No documentado"
                onChange={e=>setHistory(previous=>({...previous,[field.id]:e.target.value}))}/>
            </label>)}</div>
          </fieldset>)}
          {mayEdit&&<button className={css.primary} type="submit" disabled={busy}>{busy?'Guardando…':'Guardar antecedentes revisados'}</button>}
        </form>
      </>}
      {clinicianContext&&tab==='encounters'&&<Records label="Consultas y episodios" items={clinicianContext.encounters}/>}
      {clinicianContext&&tab==='medications'&&<>
        <section className={css.tile}><h4>Conciliación de medicación</h4>
          <p className={css.paragraph}>{safeValue(chart.medicalHistory?.currentMedications)}</p>
          <small>La conciliación depende de la revisión profesional. No es una receta activa por sí misma.</small>
        </section>
        <Records label="Recetas registradas" items={clinicianContext.prescriptions}/>
      </>}
      {clinicianContext&&tab==='studies'&&<>
        <Records label="Órdenes de estudios" items={clinicianContext.orders}/>
        <Records label="Resultados y signos vitales" items={clinicianContext.observations}/>
        <Records label="Documentos y archivos adjuntos" items={clinicianContext.attachments}/>
      </>}
      {clinicianContext&&tab==='followup'&&<>
        <Records label="Seguimientos" items={clinicianContext.followups}/>
        <Records label="Citas" items={clinicianContext.appointments}/>
        <Records label="Línea de tiempo" items={clinicianContext.timeline}/>
      </>}
      {!loading&&!clinicianContext&&!error&&<p className={css.notice}>No se ha podido verificar aún el expediente del paciente seleccionado.</p>}
    </>}
  </section>
}
