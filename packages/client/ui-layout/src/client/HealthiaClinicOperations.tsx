/**
 * Native clinical operations under PHOENIX's structural workspace.
 * Existing protected /health HTTP session owns authentication and EHR writes.
 * No patient details, notes, passwords or CSRF are emitted into chat/global
 * events, browser storage, model context, console or telemetry.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HealthiaClinicalApi, ProtectedClinicError } from './HealthiaClinicalApi.ts'
import type { ClinicalSession, ClinicalPatient, ClinicalEncounter, ClinicalIntakeTemplate, ClinicalIdentityMatches } from './HealthiaClinicalApi.ts'
import { HealthiaPatientDossier } from './HealthiaPatientDossier.tsx'
import { HealthiaClinicalNote, formatClinicalNote, NOTE_KINDS } from './HealthiaClinicalNote.tsx'
import type { ClinicalNoteValues, ClinicalNoteKind } from './HealthiaClinicalNote.tsx'
import css from './HealthiaClinicOperations.module.css'

const api = new HealthiaClinicalApi()
type Mode = 'loading' | 'unavailable' | 'setup' | 'login' | 'ready'
type Area = 'patients' | 'encounters'

/** Reverse only our own structured note labels; existing clinician prose
 * remains intact in HEA rather than disappearing or being overwritten. */
export function restoreClinicalNote(encounter:ClinicalEncounter):{
  kind:ClinicalNoteKind;values:ClinicalNoteValues
} {
  const saved=encounter.history || ''
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
    'CIE-10 sugerido (requiere verificación)':'icd10',
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

export function HealthiaClinicOperations({ area }: {area:Area}) {
  const [mode,setMode]=useState<Mode>('loading')
  const [session,setSession]=useState<ClinicalSession|null>(null)
  const [patients,setPatients]=useState<readonly ClinicalPatient[]>([])
  const [encounters,setEncounters]=useState<readonly ClinicalEncounter[]>([])
  const [patientId,setPatientId]=useState('')
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
        await refreshLists(s)
        if(mounted)readyRef.current=true
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
      await refreshLists(s)
      readyRef.current=true
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
      setName('');setBirthDate('');setEmail('');setPhone('')
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
    const history=formatClinicalNote(kind,values)
    // Full note is kept losslessly inside the encrypted encounter. Do not
    // truncate or silently drop user-entered clinical observations.
    const record=await api.saveEncounter(session,selectedEncounter,{
      history,exam:values.physical??'',
      assessment:values.assessment??'',
      plan:values.plan??'',
    })
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

  if(mode==='loading')return <div className={css.status} role="status">Comprobando la sesión clínica local…</div>
  if(mode==='unavailable')return <div className={css.panel} role="status">
    {brandMark}
    <h3>Servicio clínico local no disponible</h3>
    <p>El Host clínico no respondió. Comprueba la conexión y reintenta; los expedientes no se trasladarán a un almacén sin protección.</p>
    <div className={css.toolbarActions}>
      <button type="button" className={css.primary} onClick={()=>{setMode('loading');setConnectionRetry(v=>v+1)}}>Reintentar conexión</button>
      <a href="/health" target="_blank" rel="noopener noreferrer">Diagnóstico del servicio protegido</a>
    </div>
  </div>
  if(mode==='login'||mode==='setup')return <section className={css.panel} aria-label="Acceso clínico protegido">
    {brandMark}
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

  return <section className={css.root} aria-label={area==='patients'?'Pacientes clínicos':'Consultas clínicas'}>
    <div className={css.toolbar}>
      {brandMark}
      <div className={css.identity}><strong>Sesión profesional activa</strong><small>{session?.actor.username} · {session?.actor.role}</small></div>
      <div className={css.toolbarActions}>
        <button type="button" disabled={busy} onClick={()=>{void reload()}}>Actualizar</button>
        <button type="button" onClick={()=>{
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
    </div>
    {userRole==='admin'&&<div className={css.brandSettings}>
      <label>Logo de la institución
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void readLogo(event.currentTarget.files?.[0])}}/>
      </label>
      <button type="button" disabled={busy||logoDraft===null||!!logoError} onClick={()=>{void saveBranding(logoDraft)}}>Guardar logo</button>
      <button type="button" disabled={busy||(!logo&&!logoDraft)} onClick={()=>{void saveBranding(null)}}>Usar logo de Healthia</button>
      {logoError&&<p role="alert" className={css.error}>{logoError}</p>}
    </div>}
    {!readyRef.current&&<p role="status" className={css.notice}>Cargando registros autorizados…</p>}
    {(error||notice)&&<p role={error?'alert':'status'} className={error?css.error:css.notice}>{error||notice}</p>}
    {area==='patients'&&<div className={css.directoryHeader}>
      <div><strong>Directorio de pacientes</strong><small>{patients.length} expedientes accesibles en esta institución · búsqueda local</small></div>
      <label>Buscar por nombre, fecha, contacto o documento
        <input aria-label="Buscar pacientes" type="search" value={patientSearch}
          placeholder="Buscar paciente…" onChange={e=>setPatientSearch(e.currentTarget.value)}/>
      </label>
    </div>}
    <label className={css.selectPatient}>Paciente del expediente
      <select value={patientId} aria-label="Paciente del expediente"
        onChange={e=>{setPatientId(e.currentTarget.value);setEncounterId('');setError('');setNotice('')}}>
        <option value="">Seleccionar paciente</option>
        {(area==='patients'?visiblePatients:patients).map(item=><option key={item.id} value={item.id}>{item.name} · {item.dateOfBirth}</option>)}
      </select>
    </label>
    {area==='patients'&&<>
      <div className={css.patientResults} role="group" aria-label="Resultados del directorio">
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
      </div>
      <div className={css.actionBar}>
        {canManagePatients&&<button type="button" onClick={()=>setCreatingPatient(x=>!x)}>
          {creatingPatient?'Cancelar registro':'Registrar paciente'}
        </button>}
      </div>
      {creatingPatient&&canManagePatients&&<form className={css.form} onSubmit={event=>{void addPatient(event)}} autoComplete="off">
        <h3>Registro protegido</h3>
        <label>Nombre completo<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label>Fecha de nacimiento<input type="date" required value={birthDate} onChange={e=>setBirthDate(e.target.value)}/></label>
        <label>Teléfono (opcional)<input maxLength={35} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
        <label>Correo (opcional)<input type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <button className={css.primary} type="submit" disabled={busy||!name.trim()||!birthDate}>Guardar paciente</button>
        <p className={css.notice}>La clínica verifica posibles identidades duplicadas; una coincidencia no se resuelve automáticamente.</p>
      </form>}
      {selectedPatient&&<div className={css.panel}>
        <h3>{selectedPatient.name}</h3>
        <p>Nacimiento: {selectedPatient.dateOfBirth}. Registro cifrado · versión {selectedPatient.version}.</p>
        <p>La historia longitudinal se consulta desde el servicio clínico autorizado, no desde la memoria de Kira.</p>
      </div>}
    </>}
    {area==='encounters'&&<>
      {!selectedPatient&&<p className={css.notice}>Selecciona un paciente para abrir o recuperar sus consultas.</p>}
      {selectedPatient&&canManageEncounters&&<div className={css.actionBar}>
        <button type="button" onClick={()=>{setCreatingEncounter(v=>!v);setEncounterId('')}}>
          {creatingEncounter?'Cancelar':'Nueva consulta'}
        </button>
      </div>}
      {selectedPatient&&creatingEncounter&&canManageEncounters&&<form className={css.form}
        onSubmit={event=>{void addEncounter(event)}} autoComplete="off">
        <h3>Iniciar consulta para {selectedPatient.name}</h3>
        <label>Especialidad<input required maxLength={120} value={specialty} onChange={e=>setSpecialty(e.target.value)}/></label>
        <label>Motivo de consulta<textarea required maxLength={2000} value={complaint}
          onChange={e=>setComplaint(e.target.value)}/></label>
        <button className={css.primary} disabled={busy||!complaint.trim()||!specialty.trim()}
          type="submit">Abrir consulta</button>
      </form>}
      {selectedPatient&&<label className={css.selectPatient}>Consulta del paciente
        <select value={encounterId} aria-label="Consulta del paciente" onChange={e=>{
          setEncounterId(e.currentTarget.value);setError('');setNotice('')
        }}>
          <option value="">Seleccionar consulta</option>
          {patientEncounters.map(item=><option key={item.id} value={item.id}>
            {item.complaint} · {item.status==='signed'?'Firmada':item.status==='reviewed'?'Revisada':'Borrador'}
          </option>)}
        </select>
      </label>}
      {selectedEncounter&&currentNote&&<div className={css.encounter}>
        <p className={css.notice}>Consulta · versión {selectedEncounter.version} · {selectedEncounter.status}
          {selectedEncounter.status==='signed'?' · Solo lectura': ' · Borrador pendiente de revisión y firma'}</p>
        {selectedEncounter.status==='signed' ? <div className={css.panel}>
          <strong>Consulta firmada · protegida contra edición</strong>
          <pre>{selectedEncounter.history}</pre>
        </div> : <HealthiaClinicalNote key={selectedEncounter.id} initialKind={currentNote.kind}
          initialValues={currentNote.values} onSave={saveNote}/>}
      </div>}
    </>}
  </section>
}
