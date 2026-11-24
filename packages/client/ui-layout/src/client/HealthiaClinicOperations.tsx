/**
 * Native clinical operations under PHOENIX's structural workspace.
 * Existing protected /health HTTP session owns authentication and EHR writes.
 * No patient details, notes, passwords or CSRF are emitted into chat/global
 * events, browser storage, model context, console or telemetry.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HealthiaClinicalApi, ProtectedClinicError } from './HealthiaClinicalApi.ts'
import type { ClinicalSession, ClinicalPatient, ClinicalEncounter, ClinicalIntakeTemplate, ClinicalIdentityMatches, ClinicalInterviewGuide } from './HealthiaClinicalApi.ts'
import { HealthiaPatientDossier } from './HealthiaPatientDossier.tsx'
import { HealthiaClinicalNote, formatClinicalNoteParts, NOTE_KINDS } from './HealthiaClinicalNote.tsx'
import type { ClinicalNoteValues, ClinicalNoteKind } from './HealthiaClinicalNote.tsx'
import type { ClinicalEditorRequest, ClinicalEditorViewState } from './HealthiaEditorSupport.ts'
import { printProtectedClinicalDocument } from './HealthiaClinicalPrint.ts'
import css from './HealthiaClinicOperations.module.css'

const api = new HealthiaClinicalApi()
type Mode = 'loading' | 'unavailable' | 'setup' | 'login' | 'ready'
type Area = 'patients' | 'encounters'

/** Reverse only our own structured note labels; existing clinician prose
 * remains intact in HEA rather than disappearing or being overwritten. */
export function restoreClinicalNote(encounter:ClinicalEncounter):{
  kind:ClinicalNoteKind;values:ClinicalNoteValues
} {
  const saved=encounter.history.includes(' · BORRADOR SIN FIRMAR')
    ?[encounter.history,encounter.exam,encounter.assessment,encounter.plan].filter(Boolean).join('\n\n')
    :(encounter.history || '')
  const values:ClinicalNoteValues={ chief:encounter.complaint }
  const kind=NOTE_KINDS.find(item=>saved.startsWith(item.label+' · BORRADOR SIN FIRMAR'))?.value ?? 'first'
  if(!saved.includes(' · BORRADOR SIN FIRMAR')) {
    if(saved)values.hea=saved
    if(encounter.exam)values.physical=encounter.exam
    if(encounter.assessment)values.assessment=encounter.assessment
    if(encounter.plan)values.plan=encounter.plan
    return { kind,values }
  }
  // Read the stable label grammar. Multiline values are retained verbatim.
  const names:Record<string,string>={
    'Fecha de consulta':'date','Motivo de consulta':'chief',
    'Historia de la enfermedad actual':'hea','Revisión por sistemas':'ros',
    'Antecedentes personales patológicos':'personal',
    'Quirúrgicos y hospitalizaciones':'surgical','Heredofamiliares':'family',
    'Hábitos y contexto social':'habits','Alergias declaradas':'allergies',
    'Tratamiento habitual':'medications','Antecedentes perinatales y desarrollo':'perinatal',
    'Antecedentes gineco-obstétricos':'gyneco','FUM (si se conoce)':'fum',
    'Presión sistólica':'sys','Presión diastólica':'dia',
    'Frecuencia cardíaca':'hr','Frecuencia respiratoria':'rr',
    'Temperatura':'temp','Saturación de oxígeno':'sat','Peso':'weight','Talla':'height',
    'Examen físico por sistemas':'physical','Resultados clínicos relevantes':'findings',
    'Impresión clínica y razonamiento':'assessment',
    'Diagnósticos diferenciales o incertidumbres':'differential',
    'Estado diagnóstico (sospecha, provisional o confirmado)':'diagnosisStatus',
    'Diagnósticos adicionales y su evidencia':'secondaryDiagnosis',
    'Terminología o variante de codificación utilizada':'codeSystem',
    'CIE-10 sugerido (requiere verificación)':'icd10',
    'Analíticas consideradas (las órdenes se emiten por separado)':'tests',
    'Imágenes diagnósticas consideradas (no emitidas)':'imaging',
    'Derivaciones e interconsultas consideradas':'referrals',
    'Educación y recomendaciones de estilo de vida':'healthEducation',
    'Signos de alarma e indicaciones de retorno':'returnPrecautions',
    'Tratamiento e indicaciones':'plan','Estudios solicitados':'tests',
    'Seguimiento y signos de alarma':'followup',
  }
  let current:string|undefined
  for(const line of saved.split('\n').slice(1)) {
    if(line==='Pendiente de revisión, vinculación al paciente y firma profesional.')break
    // Continuation lines are indented by the writer: user prose that looks
    // like a clinical field or heading must never be reclassified.
    if(current && line.startsWith('  ')){values[current]=(values[current]??'')+'\n'+line.slice(2);continue}
    if(line.startsWith('IMC calculado: ')){current=undefined;continue}
    if(['ENTREVISTA','ANTECEDENTES','EXPLORACIÓN','EVALUACIÓN Y PLAN'].includes(line)){current=undefined;continue}
    const idx=line.indexOf(': ')
    const name=idx>0?line.slice(0,idx):''
    const id=names[name]
    if(id){
      current=id
      let value=line.slice(idx+2)
      if(['sys','dia','hr','rr','temp','sat','weight','height'].includes(id))
        value=value.replace(/\s(?:mmHg|lpm|rpm|°C|%|kg|cm)$/u,'')
      values[id]=value
    } else if(current&&line.trim()) values[current]=(values[current]??'')+'\n'+line
  }
  return {kind,values}
}

export function HealthiaClinicOperations({ area, selectedPatientId, onPatientChange, onNavigate,
  accessOnly=false, onSessionReady, requestedStep, onEditorState }: {
  area:Area
  /** Reuse exactly the professional login/setup flow without rendering patient records. */
  requestedStep?:ClinicalEditorRequest|undefined
  onEditorState?:((state:ClinicalEditorViewState|null)=>void)|undefined
  accessOnly?:boolean
  onSessionReady?:()=>void
  selectedPatientId?:string
  onPatientChange?:(id:string)=>void
  onNavigate?:(area:Area)=>void
}) {
  const [mode,setMode]=useState<Mode>('loading')
  const [session,setSession]=useState<ClinicalSession|null>(null)
  const [patients,setPatients]=useState<readonly ClinicalPatient[]>([])
  const [encounters,setEncounters]=useState<readonly ClinicalEncounter[]>([])
  const [patientId,setPatientIdInternal]=useState(selectedPatientId??'')
  // Share only an opaque patient id across sections; the clinical Host owns PHI.
  const setPatientId=(id:string):void=>{setPatientIdInternal(id);onPatientChange?.(id)}
  const [encounterId,setEncounterId]=useState('')
  const [user,setUser]=useState('')
  const [password,setPassword]=useState('')
  const [organization,setOrganization]=useState('')
  const [logo,setLogo]=useState<string|null>(null)
  const [logoDraft,setLogoDraft]=useState<string|null>(null)
  const [logoError,setLogoError]=useState('')
  const [connectionRetry,setConnectionRetry]=useState(0)
  const [name,setName]=useState('')
  const [birthDate,setBirthDate]=useState('')
  const [sexAtBirth,setSexAtBirth]=useState<''|'female'|'male'|'intersex'|'unknown'>('')
  const [email,setEmail]=useState('')
  const [phone,setPhone]=useState('')
  const [patientSearch,setPatientSearch]=useState('')
  const [documentType,setDocumentType]=useState<'cedula'|'passport'|'other'>('cedula')
  const [documentNumber,setDocumentNumber]=useState('')
  const [admissionNotes,setAdmissionNotes]=useState('')
  const [customFields,setCustomFields]=useState<Record<string,string>>({})
  const [intakeTemplate,setIntakeTemplate]=useState<ClinicalIntakeTemplate|null>(null)
  const [identityMatches,setIdentityMatches]=useState<ClinicalIdentityMatches|null>(null)
  const [confirmDistinct,setConfirmDistinct]=useState(false)
  const [distinctReason,setDistinctReason]=useState('')
  const [specialty,setSpecialty]=useState('Medicina familiar')
  const [complaint,setComplaint]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [creatingPatient,setCreatingPatient]=useState(false)
  const [creatingEncounter,setCreatingEncounter]=useState(false)
  const [accessSetup,setAccessSetup]=useState(false)
  const [doctorUser,setDoctorUser]=useState('')
  const [doctorPassword,setDoctorPassword]=useState('')
  const [doctorAssigned,setDoctorAssigned]=useState(false)
  useEffect(()=>{setAccessSetup(false);setDoctorPassword('');setDoctorAssigned(false);setComplaint('');setCreatingEncounter(false);setAnswerKey('');setAnswerText('')},[patientId])
  const [interviewGuide,setInterviewGuide]=useState<ClinicalInterviewGuide|null>(null)
  const [answerKey,setAnswerKey]=useState('')
  const [answerText,setAnswerText]=useState('')
  const [signChecked,setSignChecked]=useState(false)
  const [dirtyEncounter,setDirtyEncounter]=useState(false)
  useEffect(()=>{setDirtyEncounter(false);setSignChecked(false)},[encounterId,patientId])
  const readyRef=useRef(false)
  const userRole=session?.actor.role
  const canManagePatients=userRole==='admin'||userRole==='clinician'||userRole==='reception'
  const canManageEncounters=userRole==='clinician'||userRole==='psychologist'
  const selectedPatient=patients.find(p=>p.id===patientId)
  const normalizedSearch=patientSearch.trim().toLocaleLowerCase('es')
  const visiblePatients=patients.filter(p=>!normalizedSearch||
    [p.name,p.dateOfBirth,p.phone,p.email,p.documentNumber].some(value=>
      typeof value==='string'&&value.toLocaleLowerCase('es').includes(normalizedSearch)))
  const selectedEncounter=encounters.find(e=>e.id===encounterId&&e.patientId===patientId)
  const patientEncounters=encounters.filter(e=>e.patientId===patientId)
  const currentNote=selectedEncounter?restoreClinicalNote(selectedEncounter):undefined

  const refreshLists=async(s:ClinicalSession):Promise<void>=>{
    // The Host filters by institution, assignment and authenticated role.
    const list=await api.patients(s)
    setPatients(list)
    if(['admin','clinician','reception'].includes(s.actor.role)) {
      try { setIntakeTemplate(await api.patientIntakeTemplate(s)) }
      catch { setIntakeTemplate(null) }
    } else setIntakeTemplate(null)
    if(['clinician','psychologist','admin','nurse'].includes(s.actor.role)) {
      const visits=await api.encounters(s)
      setEncounters(visits)
    } else setEncounters([])
  }
  useEffect(()=>{
    let mounted=true
    readyRef.current=false
    void api.branding().then(value=>{if(mounted)setLogo(value)}).catch(()=>{/* Keep the Healthia fallback */})
    void (async()=>{
      try {
        const s=await api.session()
        if(!mounted)return
        setSession(s)
        setMode('ready')
        if(!accessOnly)await refreshLists(s)
        if(mounted){readyRef.current=true;if(accessOnly)onSessionReady?.()}
      } catch(err) {
        if(!mounted)return
        setSession(null)
        setPatients([])
        setEncounters([])
        setPatientId('')
        setEncounterId('')
        if(err instanceof ProtectedClinicError && err.status===401) {
          try {
            const state=await api.status()
            if(mounted)setMode(state.initialized?'login':'setup')
          }catch{if(mounted)setMode('unavailable')}
        } else setMode('unavailable')
      }
    })()
    return()=>{mounted=false}
  },[connectionRetry])

  const readLogo=async(file?:File):Promise<void>=>{
    if(!file){setLogoDraft(null);setLogoError('');return}
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>160_000||file.size===0){
      setLogoDraft(null)
      setLogoError('El logo debe ser PNG, JPG o WebP y no superar 160 KB.')
      return
    }
    try {
      const encoded=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader()
        reader.onload=()=>resolve(typeof reader.result==='string'?reader.result:'')
        reader.onerror=()=>reject(new Error('Lectura de imagen fallida'))
        reader.readAsDataURL(file)
      })
      if(!/^data:image\/(png|jpeg|webp);base64,/u.test(encoded))throw Error('Formato inválido')
      setLogoDraft(encoded);setLogoError('')
    }catch{setLogoDraft(null);setLogoError('No se pudo leer el logo institucional.')}
  }
  const saveBranding=async(next:string|null):Promise<void>=>{
    if(!session||session.actor.role!=='admin'||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      setLogo(await api.updateBranding(session,next))
      setLogoDraft(null)
      setNotice(next?'Logo institucional guardado en la clínica local.':'Se restauró el logo de Healthia.')
    }catch(err){setError(err instanceof Error?err.message:'No se pudo actualizar el logo')}
    finally{setBusy(false)}
  }
  const brandMark=<div className={css.brand} aria-label="Identidad visual clínica">
    {(logoDraft??logo)?<img src={(logoDraft??logo)!} alt="Logo de la institución" className={css.brandImage}/>:
      <span className={css.brandFallback}><span className={css.brandSymbol} aria-hidden="true">✚</span>Healthia</span>}
  </div>

  const authenticated=async(event:FormEvent<HTMLFormElement>):Promise<void>=>{
    event.preventDefault()
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try {
      if(mode==='setup'){
        try{await api.setup(organization.trim(),user.trim(),password,logoDraft)}
        catch(err){
          // A slow Host may commit a new clinic before the transport times out.
          // Verify server state; login below still proves ownership of the new admin.
          if(!(err instanceof ProtectedClinicError&&err.status===503
            &&(await api.status().catch(()=>null))?.initialized))throw err
        }
      }
      const s=await api.login(user.trim(),password)
      setPassword('')
      setSession(s)
      setMode('ready')
      if(logoDraft!==null){setLogo(logoDraft);setLogoDraft(null)}
      if(!accessOnly)await refreshLists(s)
      readyRef.current=true
      if(accessOnly)onSessionReady?.()
    } catch(err) {
      setPassword('')
      setError(err instanceof Error?err.message:'No se pudo autenticar la clínica')
      if(mode==='setup'){
        try{const state=await api.status();if(state.initialized)setMode('login')}catch{/* Keep the form */ }
      }
    } finally{setBusy(false)}
  }
  const addPatient=async(event:FormEvent<HTMLFormElement>):Promise<void>=>{
    event.preventDefault()
    if(!session||!canManagePatients||busy)return
    setBusy(true);setError('');setNotice('')
    try {
      const record=await api.createPatient(session,{
        name:name.trim(),dateOfBirth:birthDate,
        ...(sexAtBirth?{sexAtBirth}:{}),
        ...(phone.trim()?{phone:phone.trim()}:{}),
        ...(email.trim()?{email:email.trim()}:{}),
        ...(documentNumber.trim()?{documentType,documentNumber:documentNumber.trim()}:{}),
        ...(admissionNotes.trim()?{notes:admissionNotes.trim()}:{}),
        ...(intakeTemplate?{customFields}:{}),
        ...(confirmDistinct?{confirmDistinct:true,distinctReason:distinctReason.trim()}:{}),
      })
      setPatients(prev=>[record,...prev])
      setPatientId(record.id)
      setEncounterId('')
      setName('');setBirthDate('');setEmail('');setPhone('');setSexAtBirth('')
      setDocumentNumber('');setAdmissionNotes('');setCustomFields({})
      setIdentityMatches(null);setConfirmDistinct(false);setDistinctReason('')
      setCreatingPatient(false)
      setNotice('Paciente registrado en el repositorio local cifrado.')
    } catch(err){setError(err instanceof Error?err.message:'No se pudo registrar al paciente')}
    finally{setBusy(false)}
  }
  const checkPatientIdentity=async():Promise<void>=>{
    if(!session||!canManagePatients||busy||!name.trim()||!birthDate)return
    setBusy(true);setError('');setNotice('');setIdentityMatches(null)
    try {
      const result=await api.patientIdentityMatches(session,{
        name:name.trim(),dateOfBirth:birthDate,
        ...(documentNumber.trim()?{documentType,documentNumber:documentNumber.trim()}:{}),
        ...(phone.trim()?{phone:phone.trim()}:{}),
        ...(email.trim()?{email:email.trim()}:{}),
      })
      setIdentityMatches(result)
      setNotice(result.matches.length||result.restrictedCount
        ?'Se detectaron posibles coincidencias. Comprueba la identidad antes de registrar.'
        :'Sin coincidencias detectadas. Se comprobará nuevamente al guardar.')
    }catch(err){setError(err instanceof Error?err.message:'No se pudo verificar la identidad.')}
    finally{setBusy(false)}
  }
  const createDoctor=async():Promise<void>=>{
    if(!session||userRole!=='admin'||busy||doctorPassword.length<6||!doctorUser.trim())return
    setBusy(true);setError('');setNotice('')
    try{
      await api.createClinicStaff(session,{username:doctorUser.trim(),password:doctorPassword,role:'clinician'})
      setNotice('Cuenta médica creada. Ahora asigna este paciente al profesional.')
    }catch(err){setError(err instanceof Error?err.message:'No se pudo crear la cuenta médica')}
    finally{setDoctorPassword('');setBusy(false)}
  }
  const assignDoctor=async():Promise<void>=>{
    if(!session||userRole!=='admin'||busy||!selectedPatient||!doctorUser.trim())return
    setBusy(true);setError('');setNotice('')
    try{
      await api.setClinicAssignment(session,{patientId:selectedPatient.id,staffId:doctorUser.trim(),action:'grant',purpose:'Atención clínica solicitada por el administrador'})
      setDoctorAssigned(true)
      setNotice('Paciente asignado. Accede con la cuenta médica para iniciar la atención.')
    }catch(err){setError(err instanceof Error?err.message:'No se pudo asignar el paciente')}
    finally{setBusy(false)}
  }
  const switchToDoctor=async():Promise<void>=>{
    if(!session||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      await api.logout(session)
      setSession(null);setPatients([]);setEncounters([]);setPatientId('');setEncounterId('')
      setUser(doctorUser.trim());setPassword('');setDoctorPassword('');setMode('login')
    }catch(err){setError(err instanceof Error?err.message:'No se pudo cerrar la sesión')}
    finally{setBusy(false)}
  }
  const addEncounter=async(event:FormEvent<HTMLFormElement>):Promise<void>=>{
    event.preventDefault()
    if(!session||!canManageEncounters||!selectedPatient||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const record=await api.createEncounter(session,{
        patientId:selectedPatient.id,specialty:specialty.trim(),complaint:complaint.trim(),
      })
      setEncounters(prev=>[record,...prev])
      setEncounterId(record.id)
      setComplaint('')
      setCreatingEncounter(false)
      setNotice('Consulta abierta para el paciente seleccionado. Pendiente de documentación.')
    }catch(err){setError(err instanceof Error?err.message:'No se pudo abrir la consulta')}
    finally{setBusy(false)}
  }
  const saveNote=async(kind:ClinicalNoteKind,values:Readonly<ClinicalNoteValues>):Promise<void>=>{
    if(!session||!canManageEncounters||!selectedPatient||!selectedEncounter)
      throw new Error('Seleccione primero un paciente y una consulta propia.')
    if(selectedEncounter.status==='signed')throw new Error('La consulta firmada no admite modificaciones.')
    const parts=formatClinicalNoteParts(kind,values)
    // Separate encrypted columns preserve all authored sections without duplicates.
    const record=await api.saveEncounter(session,selectedEncounter,parts)
    if(record.patientId!==selectedPatient.id)throw new Error('No coincide la identidad clínica.')
    setEncounters(prev=>prev.map(e=>e.id===record.id?record:e))
    setNotice('Consulta guardada con versión '+String(record.version)+'. Revisión y firma pendientes.')
  }
  const reload=async():Promise<void>=>{
    if(!session)return
    setBusy(true);setError('')
    try{
      await refreshLists(session)
      setNotice('Registros actualizados desde el repositorio local.')
    }catch(err){setError(err instanceof Error?err.message:'No se pudieron actualizar los registros')}
    finally{setBusy(false)}
  }


  useEffect(()=>{
    setInterviewGuide(null)
    if(!session||!selectedEncounter||selectedEncounter.status==='signed'||!canManageEncounters)return
    let active=true
    void api.interviewGuide(session,selectedEncounter.id).then(guide=>{
      if(active)setInterviewGuide(guide)
    }).catch(()=>{if(active)setInterviewGuide(null)})
    return()=>{active=false}
  },[session,selectedEncounter?.id,selectedEncounter?.version,canManageEncounters])
  const mutateEncounter=async(
    operation:(current:ClinicalEncounter)=>Promise<ClinicalEncounter>,message:string
  ):Promise<void>=>{
    if(!selectedEncounter||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const updated=await operation(selectedEncounter)
      if(updated.id!==selectedEncounter.id||updated.patientId!==selectedEncounter.patientId)
        throw Error('La respuesta no corresponde al paciente seleccionado')
      setEncounters(items=>items.map(item=>item.id===updated.id?updated:item))
      setNotice(message)
      setSignChecked(false)
    }catch(err){setError(err instanceof Error?err.message:'La operación no quedó confirmada')}
    finally{setBusy(false)}
  }
  const submitInterview=():void=>{
    if(!session||!answerKey||!answerText.trim()||!selectedEncounter)return
    void mutateEncounter(record=>api.answerInterview(session,record,answerKey,answerText),
      'Respuesta registrada en el interrogatorio protegido.')
    setAnswerKey('');setAnswerText('')
  }
  if(mode==='loading')return <div className={css.status} role="status">Comprobando la sesión clínica local…</div>
  if(mode==='unavailable')return <div className={css.panel} role="status">
    {!accessOnly&&brandMark}
    <h3>Servicio clínico local no disponible</h3>
    <p>El Host clínico no respondió. Comprueba la conexión y reintenta; los expedientes no se trasladarán a un almacén sin protección.</p>
    <div className={css.toolbarActions}>
      <button type="button" className={css.primary} onClick={()=>{setMode('loading');setConnectionRetry(v=>v+1)}}>Reintentar conexión</button>
      <a href="/health" target="_blank" rel="noopener noreferrer">Diagnóstico del servicio protegido</a>
    </div>
  </div>
  if(mode==='login'||mode==='setup')return <section className={accessOnly?css.accessPanel:css.panel} aria-label="Acceso clínico protegido">
    {!accessOnly&&brandMark}
    <h3>{mode==='setup'?'Inicializar clínica local':'Inicio de sesión profesional'}</h3>
    <p>{mode==='setup'
      ? 'La clínica es local y cifrada. Crea el administrador con una contraseña de 6 caracteres o más; recomendamos 12 o más. Guárdala fuera de PHOENIX: también protege el cifrado del expediente.'
      : 'La misma identidad profesional del servicio /health; nunca uses las credenciales en el chat de Kira.'}</p>
    <form className={css.form} autoComplete="off" onSubmit={event=>{void authenticated(event)}}>
      {mode==='setup'&&<label>Centro o institución
        <input required maxLength={120} value={organization} onChange={e=>setOrganization(e.target.value)}/>
      </label>}
      {mode==='setup'&&<label>Logo institucional (opcional)
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void readLogo(event.currentTarget.files?.[0])}}/>
        <small>PNG, JPG o WebP · máximo 160 KB. Sin imagen se utilizará el logo de Healthia.</small>
      </label>}
      <label>Usuario profesional
        <input required maxLength={80} value={user} onChange={e=>setUser(e.target.value)}/>
      </label>
      <label>Contraseña
        <input required type="password" minLength={6} maxLength={256} value={password}
          autoComplete="off" onChange={e=>setPassword(e.target.value)}/>
      </label>
      <button className={css.primary} type="submit" disabled={busy||password.length<6}>
        {busy?'Verificando…':mode==='setup'?'Crear clínica local':'Acceder'}
      </button>
    </form>
    {logoError&&<p className={css.error} role="alert">{logoError}</p>}
    {error&&<p className={css.error} role="alert">{error}</p>}
    {error&&<button type="button" onClick={()=>{setMode('loading');setConnectionRetry(v=>v+1)}}>Comprobar conexión</button>}
  </section>

  if(accessOnly)return <p className={css.notice} role="status">Sesión clínica verificada. Preparando el espacio de trabajo…</p>

  return <section className={css.root} aria-label={area==='patients'?'Pacientes clínicos':'Consultas clínicas'}>
    <header className={css.toolbar}>
      <div className={css.identity}>
        <span className={css.secureIndicator}>● Repositorio clínico protegido</span>
        <strong>Sesión profesional activa</strong>
        <small>{session?.actor.username} · {session?.actor.role}</small>
      </div>
      <div className={css.toolbarActions}>
        <button type="button" disabled={busy} onClick={()=>{void reload()}}>Actualizar</button>
        <details className={css.settingsMenu}>
          <summary>Opciones de clínica</summary>
          <div className={css.settingsPanel}>
            {userRole==='admin'&&<div className={css.brandSettings}>
              <strong>Identidad institucional</strong>
              {brandMark}
              <label>Logo de la institución
                <input type="file" accept="image/png,image/jpeg,image/webp"
                  onChange={event=>{void readLogo(event.currentTarget.files?.[0])}}/>
              </label>
              <small>PNG, JPG o WebP · máximo 160 KB.</small>
              <div className={css.toolbarActions}>
                <button type="button" disabled={busy||logoDraft===null||!!logoError}
                  onClick={()=>{void saveBranding(logoDraft)}}>Guardar logo</button>
                <button type="button" disabled={busy||(!logo&&!logoDraft)}
                  onClick={()=>{void saveBranding(null)}}>Usar logo de Healthia</button>
              </div>
              {logoError&&<p role="alert" className={css.error}>{logoError}</p>}
            </div>}
            <button type="button" className={css.logoutAction} onClick={()=>{
              if(!session||busy)return
              setBusy(true);setError('')
              void api.logout(session).then(()=>{
                setSession(null);setPatients([]);setEncounters([])
                setPatientId('');setEncounterId('');setMode('login')
              }).catch(()=>{
                setError('No se pudo cerrar la sesión en el Host. Reintenta antes de abandonar el equipo.')
              }).finally(()=>setBusy(false))
            }}>Cerrar sesión clínica</button>
          </div>
        </details>
      </div>
    </header>
    {!readyRef.current&&<p role="status" className={css.notice}>Cargando registros autorizados…</p>}
    {(error||notice)&&<p role={error?'alert':'status'} className={error?css.error:css.notice}>{error||notice}</p>}
    {!selectedPatient&&<div className={css.directoryHeader}>
      <div>
        <strong>{area==='patients'?'Directorio de pacientes':'Atención de consultas'}</strong>
        <small>{patients.length} expedientes autorizados · {area==='patients'?'Selecciona uno para ver su ficha':'Selecciona un paciente para continuar'}</small>
      </div>
      <label>Buscar paciente
        <input aria-label="Buscar pacientes" type="search" value={patientSearch}
          placeholder="Nombre, cédula, teléfono o fecha…" onChange={e=>setPatientSearch(e.currentTarget.value)}/>
      </label>
      {area==='patients'&&canManagePatients&&<button className={css.primary} type="button"
        onClick={()=>setCreatingPatient(value=>!value)}>
        {creatingPatient?'Cancelar registro':'Registrar paciente'}
      </button>}
    </div>}
    {area==='encounters'&&!selectedPatient&&<label className={css.selectPatient}>Paciente del expediente
      <select value={patientId} aria-label="Paciente del expediente" disabled={busy||dirtyEncounter}
        onChange={e=>{setPatientId(e.currentTarget.value);setEncounterId('');setError('');setNotice('')}}>
        <option value="">Seleccionar paciente</option>
        {visiblePatients.map(item=><option key={item.id} value={item.id}>{item.name} · {item.dateOfBirth}</option>)}
        {selectedPatient&&!visiblePatients.some(item=>item.id===selectedPatient.id)&&
          <option value={selectedPatient.id}>{selectedPatient.name}</option>}
      </select>
    </label>}
    {selectedPatient&&<div className={css.patientFocus} aria-label="Paciente activo">
      <div className={css.patientFocusIdentity}>
        <span className={css.patientInitial} aria-hidden="true">{selectedPatient.name.trim().slice(0,1).toUpperCase()}</span>
        <span><strong>{selectedPatient.name}</strong><small>Nacimiento: {selectedPatient.dateOfBirth||'Sin fecha documentada'}</small></span>
      </div>
      <div className={css.toolbarActions}>
        {area==='patients'&&(canManageEncounters||userRole==='admin')&&onNavigate&&
          <button className={css.primary} type="button" onClick={()=>onNavigate('encounters')}>Ir a consultas</button>}
        {area==='encounters'&&canManageEncounters&&<button className={css.primary} type="button" disabled={busy||dirtyEncounter}
          onClick={()=>{setCreatingEncounter(v=>!v);setEncounterId('')}}>{creatingEncounter?'Cancelar':'Nueva consulta'}</button>}
        <button type="button" disabled={busy||dirtyEncounter} onClick={()=>{setPatientId('');setEncounterId('')}}>Cambiar paciente</button>
      </div>
    </div>}
    {area==='patients'&&<>
      {!selectedPatient&&!creatingPatient&&<div className={css.patientResults} role="group" aria-label="Resultados del directorio">
        {visiblePatients.slice(0,50).map(item=><button type="button" key={item.id}
          className={patientId===item.id?css.patientResultActive:css.patientResult}
          aria-pressed={patientId===item.id}
          onClick={()=>{setPatientId(item.id);setEncounterId('');setError('');setNotice('')}}>
          <span className={css.patientInitial} aria-hidden="true">{item.name.trim().slice(0,1).toUpperCase()}</span>
          <span><strong>{item.name}</strong><small>Nacimiento: {item.dateOfBirth||'Sin fecha documentada'}</small></span>
          <span className={css.patientRecordIndicator}>{patientId===item.id?'Abierto':'Abrir'}</span>
        </button>)}
        {!visiblePatients.length&&<p className={css.notice}>No hay pacientes que coincidan con esta búsqueda.</p>}
        {visiblePatients.length>50&&<p className={css.notice}>Mostrando 50 de {visiblePatients.length}. Precisa la búsqueda.</p>}
      </div>}
      {creatingPatient&&canManagePatients&&<form className={css.form} onSubmit={event=>{void addPatient(event)}} autoComplete="off">
        <h3>Registro de paciente · admisión protegida</h3>
        <p>Identidad, contacto y datos de admisión. El expediente interno se asigna al guardar; documento y teléfono no son su identificador principal.</p>
        <div className={css.admissionGrid}>
          <label>Nombre completo<input required maxLength={160} value={name} onChange={e=>{setName(e.target.value);setIdentityMatches(null)}}/></label>
          <label>Fecha de nacimiento<input type="date" required value={birthDate} max={new Date().toISOString().slice(0,10)}
            onChange={e=>{setBirthDate(e.target.value);setIdentityMatches(null)}}/></label>
          <label>Sexo registrado al nacer (opcional)
            <select value={sexAtBirth} onChange={e=>setSexAtBirth(e.target.value as typeof sexAtBirth)}>
              <option value="">No documentado</option>
              <option value="female">Femenino</option><option value="male">Masculino</option>
              <option value="intersex">Intersexual</option><option value="unknown">Desconocido</option>
            </select>
          </label>
          <label>Tipo de documento<select value={documentType} onChange={e=>{setDocumentType(e.target.value as typeof documentType);setIdentityMatches(null)}}>
            <option value="cedula">Cédula dominicana</option><option value="passport">Pasaporte</option><option value="other">Otro documento</option>
          </select></label>
          <label>Número de documento (opcional)<input maxLength={32} value={documentNumber}
            onChange={e=>{setDocumentNumber(e.target.value);setIdentityMatches(null)}}/></label>
          <label>Teléfono (opcional)<input maxLength={35} type="tel" value={phone}
            onChange={e=>{setPhone(e.target.value);setIdentityMatches(null)}}/></label>
          <label>Correo (opcional)<input type="email" maxLength={254} value={email}
            onChange={e=>{setEmail(e.target.value);setIdentityMatches(null)}}/></label>
        </div>
        {intakeTemplate&&<fieldset className={css.admissionFields}><legend>Datos complementarios de admisión</legend>
          <div className={css.admissionGrid}>{intakeTemplate.fields.map(field=>
            <label key={field.id}>{field.label}
              {field.kind==='select'?<select required={field.required} value={customFields[field.id]??''}
                onChange={e=>setCustomFields(x=>({...x,[field.id]:e.target.value}))}>
                  <option value="">Sin registrar</option>
                  {(field.choices??[]).map(choice=><option key={choice} value={choice}>{choice}</option>)}
                </select>:<input required={field.required} maxLength={250}
                  type={field.kind==='number'?'number':field.kind==='email'?'email':field.kind==='tel'?'tel':field.kind==='date'?'date':'text'}
                  value={customFields[field.id]??''}
                  onChange={e=>setCustomFields(x=>({...x,[field.id]:e.target.value}))}/>}
            </label>)}</div>
        </fieldset>}
        <label>Observaciones de admisión (opcional)<textarea maxLength={4000} value={admissionNotes}
          onChange={e=>setAdmissionNotes(e.target.value)} placeholder="Información administrativa facilitada y su procedencia"/></label>
        <div className={css.actionBar}>
          <button type="button" disabled={busy||!name.trim()||!birthDate}
            onClick={()=>{void checkPatientIdentity()}}>Comprobar identidad</button>
        </div>
        {identityMatches&&<div className={css.identityResults} role="status">
          {identityMatches.matches.length===0&&identityMatches.restrictedCount===0
            ?'Sin coincidencias en los registros autorizados.'
            :'Posibles duplicados: revisa si el paciente ya tiene expediente. No se fusionan automáticamente.'}
          {identityMatches.matches.map(match=><button key={match.id} type="button"
            onClick={()=>{setPatientId(match.id);setCreatingPatient(false)}}
            className={css.candidate}>Abrir existente: {match.name} · {match.dateOfBirth} · {match.reason}</button>)}
          {identityMatches.restrictedCount>0&&<p>Hay coincidencias restringidas. Solicita revisión de admisión antes de crear una ficha.</p>}
        </div>}
        {identityMatches?.matches.some(item=>item.reason!=='document')&&<label className={css.override}>
          <input type="checkbox" checked={confirmDistinct} onChange={e=>setConfirmDistinct(e.target.checked)}/>
          He verificado que se trata de una persona diferente
        </label>}
        {confirmDistinct&&<label>Justificación de identidad distinta
          <textarea required minLength={12} maxLength={300} value={distinctReason} onChange={e=>setDistinctReason(e.target.value)}/>
        </label>}
        <button className={css.primary} type="submit"
          disabled={busy||!name.trim()||!birthDate||(confirmDistinct&&distinctReason.trim().length<12)}>Guardar paciente</button>
        <p className={css.notice}>La clínica realiza nuevamente la detección de duplicados al guardar y registra cualquier excepción justificada.</p>
      </form>}
      {selectedPatient&&session&&<HealthiaPatientDossier key={selectedPatient.id}

        session={session} patient={selectedPatient} intakeTemplate={intakeTemplate}
        onPatientUpdated={updated=>setPatients(previous=>previous.map(p=>p.id===updated.id?updated:p))}/>}

    </>}
    {area==='encounters'&&<>
      {!selectedPatient&&<div className={css.patientResults} role="group" aria-label="Elegir paciente para consultar">
        {visiblePatients.slice(0,50).map(item=><button type="button" key={item.id}
          className={css.patientResult} onClick={()=>{setPatientId(item.id);setEncounterId('')}}>
          <span className={css.patientInitial} aria-hidden="true">{item.name.trim().slice(0,1).toUpperCase()}</span>
          <span><strong>{item.name}</strong><small>{item.dateOfBirth||'Sin fecha documentada'}</small></span>
          <span className={css.patientRecordIndicator}>Seleccionar</span>
        </button>)}
        {!visiblePatients.length&&<p className={css.notice}>No hay pacientes que coincidan con esta búsqueda.</p>}
        {visiblePatients.length>50&&<p className={css.notice}>Mostrando 50 de {visiblePatients.length}. Refina la búsqueda.</p>}
      </div>}
      {selectedPatient&&!canManageEncounters&&<section className={css.clinicianAccess} aria-label="Acceso para atender pacientes">
        <div><h3>Iniciar atención médica</h3>
          <p>{userRole==='admin'?'Estás en la cuenta de administración. Para documentar una consulta, utiliza una cuenta médica autorizada.':'Tu cuenta no tiene permiso para documentar consultas. Accede con un profesional autorizado.'}</p>
        </div>
        <div className={css.toolbarActions}>
          {userRole==='admin'&&<button className={css.primary} type="button" disabled={busy}
            onClick={()=>setAccessSetup(v=>!v)}>{accessSetup?'Cerrar configuración':'Preparar acceso médico'}</button>}
          <button type="button" disabled={busy} onClick={()=>{void switchToDoctor()}}>Cambiar de cuenta</button>
        </div>
        {userRole==='admin'&&accessSetup&&<div className={css.doctorSetup}>
          <label>Usuario médico (nuevo o existente)
            <input autoComplete="off" maxLength={80} value={doctorUser} disabled={busy}
              onChange={e=>{setDoctorUser(e.currentTarget.value);setDoctorAssigned(false)}} placeholder="doctor1"/>
          </label>
          <details><summary>Crear una cuenta médica nueva</summary>
            <label>Contraseña de la nueva cuenta médica
              <input type="password" autoComplete="new-password" minLength={6} maxLength={256}
                value={doctorPassword} disabled={busy} onChange={e=>setDoctorPassword(e.currentTarget.value)}/>
            </label>
            <button type="button" disabled={busy||!doctorUser.trim()||doctorPassword.length<6}
              onClick={()=>{void createDoctor()}}>Crear cuenta médica</button>
          </details>
          <button className={css.primary} type="button" disabled={busy||!doctorUser.trim()||doctorAssigned}
            onClick={()=>{void assignDoctor()}}>Asignar este paciente al profesional</button>
          {doctorAssigned&&<p role="status">Asignación confirmada. Usa «Cambiar de cuenta» para acceder como médico.</p>}
          <small>La cuenta administrativa no se convierte en una cuenta médica. El profesional debe autenticarse con su propia contraseña.</small>
        </div>}
      </section>}
      {selectedPatient&&creatingEncounter&&canManageEncounters&&<form className={css.form}
        onSubmit={event=>{void addEncounter(event)}} autoComplete="off">
        <h3>Iniciar consulta para {selectedPatient.name}</h3>
        <label>Especialidad<input required maxLength={120} value={specialty} onChange={e=>setSpecialty(e.target.value)}/></label>
        <label>Motivo de consulta<textarea required maxLength={2000} value={complaint}
          onChange={e=>setComplaint(e.target.value)}/></label>
        <button className={css.primary} disabled={busy||!complaint.trim()||!specialty.trim()}
          type="submit">Abrir consulta</button>
      </form>}
      {selectedPatient&&patientEncounters.length>0&&<label className={css.selectPatient}>Consulta del paciente
        <select value={encounterId} aria-label="Consulta del paciente" disabled={busy||dirtyEncounter} onChange={e=>{
          setEncounterId(e.currentTarget.value);setError('');setNotice('')
        }}>
          <option value="">Seleccionar consulta</option>
          {patientEncounters.map(item=><option key={item.id} value={item.id}>
            {item.complaint} · {item.status==='signed'?'Firmada':item.status==='reviewed'?'Revisada':'Borrador'}
          </option>)}
        </select>
      </label>}
      {selectedPatient&&canManageEncounters&&!creatingEncounter&&!patientEncounters.length&&
        <p className={css.emptyState}>Este paciente aún no tiene consultas accesibles. Utiliza «Nueva consulta» para iniciar la atención.</p>}
      {selectedEncounter&&currentNote&&<div className={css.encounter}>
        {canManageEncounters&&selectedEncounter.status!=='signed'&&<details className={css.interviewCard} aria-label="Ask clínico protegido">
          <summary className={css.interviewSummary}><strong>Ask · Interrogatorio clínico</strong><small>{interviewGuide?.nextQuestions.length??0} preguntas disponibles</small></summary>
          <p className={css.notice}>Preguntas del servicio local; ninguna respuesta se envía al chat de Kira.</p>
          <p className={css.notice}>Registra únicamente lo que refiere el paciente o lo verificado.
            Ante signos de alarma, realiza valoración inmediata; la guía no determina un diagnóstico.</p>
          {(interviewGuide?.nextQuestions??[]).map(question=><button type="button" key={question.key}
            className={answerKey===question.key?css.interviewQuestionActive:css.interviewQuestion}
            onClick={()=>{setAnswerKey(question.key);setAnswerText('')}}>
            {question.question}
          </button>)}
          {answerKey&&<div className={css.interviewAnswer}>
            <label>Respuesta documentada por el profesional
              <textarea maxLength={1600} rows={3} value={answerText}
                onChange={e=>setAnswerText(e.currentTarget.value)}/>
            </label>
            <button className={css.primary} type="button" disabled={busy||!answerText.trim()}
              onClick={submitInterview}>Guardar respuesta en consulta</button>
          </div>}
          {interviewGuide&&interviewGuide.nextQuestions.length===0&&
            <p className={css.notice}>No quedan preguntas pendientes de esta guía; comprueba si necesitas ampliar la entrevista.</p>}
          {Object.entries(selectedEncounter.interviewAnswers??{}).length>0&&
            <div className={css.interviewAnswered}><strong>Respuestas registradas</strong>
              {Object.entries(selectedEncounter.interviewAnswers??{}).map(([key,value])=>
                <p key={key}>{key.replaceAll('_',' ')}: {value}</p>)}
            </div>}
          {!selectedEncounter.history.trim()&&Object.keys(selectedEncounter.interviewAnswers??{}).length>0&&
            <button type="button" disabled={busy} onClick={()=>{
              if(session)void mutateEncounter(record=>api.draftEncounterFromInterview(session,record),
                'Borrador construido a partir de las respuestas registradas; requiere revisión profesional.')
            }}>Preparar borrador desde el interrogatorio</button>}
        </details>}

        <p className={css.notice}>Consulta · versión {selectedEncounter.version} · {selectedEncounter.status}
          {selectedEncounter.status==='signed'?' · Solo lectura': ' · Borrador pendiente de revisión y firma'}</p>
        {selectedEncounter.status==='signed' ? <div className={css.panel}>
          <strong>Consulta firmada · protegida contra edición</strong>
          <pre>{selectedEncounter.history}</pre>
          <p className={css.notice}>Firmada por {selectedEncounter.signedBy??'profesional autorizado'} ·
            {selectedEncounter.signedAt??'fecha protegida'}. No admite sobrescritura; correcciones mediante adenda.</p>
        </div> : <HealthiaClinicalNote key={selectedEncounter.id} initialKind={currentNote.kind}
          initialValues={currentNote.values} patient={selectedPatient} encounterVersion={selectedEncounter.version}
          requestedStep={requestedStep} onEditorState={onEditorState} onDirtyChange={setDirtyEncounter} {...(canManageEncounters&&session?.actor.username===selectedEncounter.practitioner?{onSave:saveNote}:{})}
          {...(session?.actor.role==='clinician'&&session.actor.username===selectedEncounter.practitioner&&selectedEncounter.status==='draft'?{
            loadModels:()=>api.editorModels(session),
            refineField:(field:string,text:string,model:import('./HealthiaClinicalApi.ts').ClinicalEditorModel,confirmed:boolean)=>api.refineEditorField(session,selectedEncounter,field,text,model,confirmed),
          }:{})}/>}
        <button type="button" className={css.printAction} disabled={dirtyEncounter} onClick={()=>{
          try {
            printProtectedClinicalDocument({
              title:selectedEncounter.status==='signed'?'Historia clínica firmada':'Historia clínica · borrador',
              institution:session?.actor.org??'Healthia',
              patientName:selectedPatient?.name??'Paciente autorizado',
              ...(selectedPatient?.dateOfBirth?{patientBirth:selectedPatient.dateOfBirth}:{}),
              patientId:selectedEncounter.patientId,
              practitioner:selectedEncounter.signedBy??selectedEncounter.practitioner,
              date:selectedEncounter.signedAt??new Date().toISOString(),
              status:selectedEncounter.status,
              sections:[
                {heading:'Entrevista y antecedentes',body:selectedEncounter.history},
                {heading:'Exploración',body:selectedEncounter.exam},
                {heading:'Diagnósticos y valoración',body:selectedEncounter.assessment},
                {heading:'Plan e indicaciones',body:selectedEncounter.plan},
              ],
              disclaimer:selectedEncounter.status==='signed'
                ?'Historia firmada en el registro protegido; confirme la autenticidad institucional de la copia.'
                :'BORRADOR SIN FIRMAR. Prohibido interpretarlo como documento clínico definitivo.',
            })
          }catch(err){setError(err instanceof Error?err.message:'No se pudo preparar la impresión')}
        }}>Imprimir {selectedEncounter.status==='signed'?'historia clínica':'borrador sin firmar'}</button>
        {canManageEncounters&&selectedEncounter.status==='draft'&&selectedEncounter.history.trim()&&
          <div className={css.reviewCard}>
            <strong>Validación profesional</strong>
            <p>Comprueba identidad, motivo, enfermedad actual, antecedentes, exploración, diagnóstico,
              códigos, plan, indicaciones y datos faltantes antes de marcar la versión como revisada.</p>
            {dirtyEncounter&&<p role="status">Guarda los cambios del editor antes de revisar la consulta.</p>}
            <button className={css.primary} type="button" disabled={busy||dirtyEncounter} onClick={()=>{
              if(session&&!dirtyEncounter)void mutateEncounter(record=>api.reviewEncounter(session,record),
                'Versión de la consulta revisada. Requiere firma explícita.')
            }}>Marcar esta versión como revisada</button>
          </div>}
        {canManageEncounters&&selectedEncounter.status==='reviewed'&&
          <div className={css.reviewCard}>
            <strong>Firma clínica</strong>
            <p>La firma deja la consulta inmutable. Después podrán emitirse órdenes y recetas autorizadas.</p>
            <label className={css.signCheck}><input type="checkbox" checked={signChecked}
              onChange={e=>setSignChecked(e.currentTarget.checked)}/>
              He revisado la historia, las decisiones y los datos de este paciente.</label>
            <button className={css.primary} type="button" disabled={busy||!signChecked||dirtyEncounter} onClick={()=>{
              if(session&&!dirtyEncounter)void mutateEncounter(record=>api.signEncounter(session,record),
                'Consulta firmada por el servicio clínico protegido.')
            }}>Firmar consulta revisada</button>
          </div>}
      </div>}
    </>}
  </section>
}
