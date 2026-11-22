/**
 * Native clinical operations under PHOENIX's structural workspace.
 * Existing protected /health HTTP session owns authentication and EHR writes.
 * No patient details, notes, passwords or CSRF are emitted into chat/global
 * events, browser storage, model context, console or telemetry.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HealthiaClinicalApi, ProtectedClinicError } from './HealthiaClinicalApi.ts'
import type { ClinicalSession, ClinicalPatient, ClinicalEncounter } from './HealthiaClinicalApi.ts'
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
    } else if(current&&line.trim()) values[current]+='\n'+line
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
  const [name,setName]=useState('')
  const [birthDate,setBirthDate]=useState('')
  const [email,setEmail]=useState('')
  const [phone,setPhone]=useState('')
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
  const selectedEncounter=encounters.find(e=>e.id===encounterId&&e.patientId===patientId)
  const patientEncounters=encounters.filter(e=>e.patientId===patientId)
  const currentNote=selectedEncounter?restoreClinicalNote(selectedEncounter):undefined

  const refreshLists=async(s:ClinicalSession):Promise<void>=>{
    // The Host filters by institution, assignment and authenticated role.
    const list=await api.patients(s)
    setPatients(list)
    if(['clinician','psychologist','admin','nurse'].includes(s.actor.role)) {
      const visits=await api.encounters(s)
      setEncounters(visits)
    } else setEncounters([])
  }
  useEffect(()=>{
    let mounted=true
    readyRef.current=false
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
  },[])

  const authenticated=async(event:FormEvent<HTMLFormElement>):Promise<void>=>{
    event.preventDefault()
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try {
      if(mode==='setup')await api.setup(organization.trim(),user.trim(),password)
      const s=await api.login(user.trim(),password)
      setPassword('')
      setSession(s)
      setMode('ready')
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
      })
      setPatients(prev=>[record,...prev])
      setPatientId(record.id)
      setEncounterId('')
      setName('');setBirthDate('');setEmail('');setPhone('')
      setCreatingPatient(false)
      setNotice('Paciente registrado en el repositorio local cifrado.')
    } catch(err){setError(err instanceof Error?err.message:'No se pudo registrar al paciente')}
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
      history,exam:(values.physical??'').slice(0,4000),
      assessment:(values.assessment??'').slice(0,4000),
      plan:(values.plan??'').slice(0,4000),
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
    <h3>Servicio clínico local no disponible</h3>
    <p>Para proteger el expediente, este panel no creará un almacén alternativo ni guardará datos clínicos sin el Host autorizado.</p>
    <a href="/health" target="_blank" rel="noopener noreferrer">Comprobar servicio clínico protegido</a>
  </div>
  if(mode==='login'||mode==='setup')return <section className={css.panel} aria-label="Acceso clínico protegido">
    <h3>{mode==='setup'?'Inicializar clínica local':'Inicio de sesión profesional'}</h3>
    <p>{mode==='setup'
      ? 'La clínica es local y cifrada. Define un administrador y una contraseña maestra de al menos 16 caracteres. Conserva esa contraseña fuera de PHOENIX.'
      : 'La misma identidad profesional del servicio /health; nunca uses las credenciales en el chat de Kira.'}</p>
    <form className={css.form} autoComplete="off" onSubmit={event=>{void authenticated(event)}}>
      {mode==='setup'&&<label>Centro o institución
        <input required maxLength={120} value={organization} onChange={e=>setOrganization(e.target.value)}/>
      </label>}
      <label>Usuario profesional
        <input required maxLength={80} value={user} onChange={e=>setUser(e.target.value)}/>
      </label>
      <label>Contraseña
        <input required type="password" minLength={16} maxLength={256} value={password}
          autoComplete="off" onChange={e=>setPassword(e.target.value)}/>
      </label>
      <button className={css.primary} type="submit" disabled={busy||password.length<16}>
        {busy?'Verificando…':mode==='setup'?'Crear clínica local':'Acceder'}
      </button>
    </form>
    {error&&<p className={css.error} role="alert">{error}</p>}
  </section>

  return <section className={css.root} aria-label={area==='patients'?'Pacientes clínicos':'Consultas clínicas'}>
    <div className={css.toolbar}>
      <div className={css.identity}><strong>Sesión profesional activa</strong><small>{session?.actor.username} · {session?.actor.role}</small></div>
      <div className={css.toolbarActions}>
        <button type="button" disabled={busy} onClick={()=>{void reload()}}>Actualizar</button>
        <button type="button" onClick={()=>{if(!session)return;void api.logout(session).finally(()=>{
          setSession(null);setPatients([]);setEncounters([]);setPatientId('');setEncounterId('');setMode('login')
        })}}>Cerrar sesión clínica</button>
      </div>
    </div>
    {!readyRef.current&&<p role="status" className={css.notice}>Cargando registros autorizados…</p>}
    {(error||notice)&&<p role={error?'alert':'status'} className={error?css.error:css.notice}>{error||notice}</p>}
    <label className={css.selectPatient}>Paciente del expediente
      <select value={patientId} aria-label="Paciente del expediente"
        onChange={e=>{setPatientId(e.currentTarget.value);setEncounterId('');setError('');setNotice('')}}>
        <option value="">Seleccionar paciente</option>
        {patients.map(item=><option key={item.id} value={item.id}>{item.name} · {item.dateOfBirth}</option>)}
      </select>
    </label>
    {area==='patients'&&<>
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
