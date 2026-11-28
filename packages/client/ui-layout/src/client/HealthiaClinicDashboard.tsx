/**
 * Native Healthia clinical home.
 *
 * Always show a useful clinic workspace, including before login. The access
 * gateway reuses the real Host credentials, setup flow and encrypted store.
 * Never show synthetic counts or copy patient information into chat.
 */
import { useEffect, useState } from 'react'
import { HealthiaClinicalApi } from './HealthiaClinicalApi.ts'
import type { ClinicalPatient, ClinicResource, ClinicalSession } from './HealthiaClinicalApi.ts'
import css from './HealthiaClinicDashboard.module.css'

const api=new HealthiaClinicalApi()
const clinicDay=(value:string):string=>new Date(value).toLocaleDateString('en-CA',{
  timeZone:'America/Santo_Domingo',
})
const clock=(value:unknown):string=>typeof value==='string'&&Number.isFinite(Date.parse(value))
  ?new Date(value).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Santo_Domingo'})
  :'Hora no registrada'

type Page='patients'|'encounters'|'appointments'|'documents'|'management'
const DESTINATIONS:readonly {id:Page;label:string;detail:string}[]=[
  {id:'patients',label:'Pacientes',detail:'Admisión y expediente'},
  {id:'encounters',label:'Consultas',detail:'Historia, evaluación y firma'},
  {id:'appointments',label:'Agenda',detail:'Citas y seguimiento'},
  {id:'documents',label:'Documentos',detail:'Órdenes y recetas'},
  {id:'management',label:'Gestión',detail:'Equipo y administración'},
]
/** Compact local stroke icons: no external icon CDN or duplicated menu branding. */
function ClinicalIcon({kind}:{kind:Page}) {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind==='patients'&&<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 7a3 3 0 0 1 0 6M18 16c1.9.4 3 1.7 3 4"/></>}
    {kind==='encounters'&&<><path d="M6 3v5a6 6 0 0 0 12 0V3M4 3h4M16 3h4"/><circle cx="18" cy="16" r="2"/><path d="M12 14v3a4 4 0 0 0 8 0"/></>}
    {kind==='appointments'&&<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15l2 2 5-5"/></>}
    {kind==='documents'&&<><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7M8 15h8M8 18h5"/></>}
    {kind==='management'&&<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>}
  </svg>
}

export function HealthiaClinicDashboard({onNavigate,onPatientChange,accessStatus,onRequestAccess,onStart}:{
  onStart?:(kind:'patient'|'encounter')=>void
  onNavigate:(section:string)=>void
  onPatientChange:(patientId:string)=>void
  accessStatus:'authenticated'|'locked'|'unavailable'
  onRequestAccess:()=>void
}) {
  const [session,setSession]=useState<ClinicalSession|null>(null)
  const [patients,setPatients]=useState<readonly ClinicalPatient[]>([])
  const [visits,setVisits]=useState<readonly ClinicResource[]>([])
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)

  useEffect(()=>{
    if(accessStatus!=='authenticated'){
      setSession(null);setPatients([]);setVisits([]);setError('');setLoading(false)
      return
    }
    let active=true
    setLoading(true);setError('')
    void (async()=>{
      try{
        const current=await api.session()
        const role=current.actor.role
        const [directory,appointments]=await Promise.all([
          ['admin','clinician','psychologist','nurse','reception'].includes(role)
            ?api.patients(current):Promise.resolve([]),
          ['admin','clinician','psychologist','nurse','reception'].includes(role)
            ?api.listClinicResources(current,'appointments'):Promise.resolve([]),
        ])
        if(active){setSession(current);setPatients(directory);setVisits(appointments)}
      }catch(e){if(active){setSession(null);setError(e instanceof Error?e.message:'No se pudo cargar el panel clínico')}}
      finally{if(active)setLoading(false)}
    })()
    return()=>{active=false}
  },[accessStatus])

  const isUnlocked=accessStatus==='authenticated'
  const canDirectory=session!==null&&['admin','clinician','psychologist','nurse','reception'].includes(session.actor.role)
  const now=new Date()
  const today=clinicDay(now.toISOString())
  const localDate=now.toLocaleDateString('es-DO',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'America/Santo_Domingo'})
  const todayVisits=visits.filter(item=>typeof item.startsAt==='string'
    &&Number.isFinite(Date.parse(item.startsAt))
    &&clinicDay(item.startsAt)===today&&item.status!=='cancelled')
    .sort((a,b)=>Date.parse(String(a.startsAt))-Date.parse(String(b.startsAt)))
  const pending=todayVisits.filter(item=>item.status==='scheduled')
  const term=search.trim().toLocaleLowerCase('es')
  const matches=term?patients.filter(p=>[p.name,p.documentNumber,p.phone,p.email].some(v=>
    typeof v==='string'&&v.toLocaleLowerCase('es').includes(term))):patients.slice(0,7)
  const openPatient=(id:string):void=>{onPatientChange(id);onNavigate('patients')}
  const consultPatient=(id:string):void=>{onPatientChange(id);if(onStart)onStart('encounter');else onNavigate('encounters')}
  const canConsult=session!==null&&['clinician','psychologist'].includes(session.actor.role)
  const canRegister=session!==null&&['admin','clinician','reception'].includes(session.actor.role)

  return <section className={css.root} aria-label="Inicio de Healthia">
    <header className={css.hero}>
      <div className={css.heroCopy}>
        <span className={css.eyebrow}>{localDate}</span>
        <h3>Jornada clínica</h3>
      </div>
      <div className={css.heroActions}>
        <button type="button" className={css.primary} disabled={isUnlocked&&session!==null&&!canConsult}
          onClick={()=>onStart?onStart('encounter'):onNavigate('encounters')}>+ Nueva consulta</button>
        <button type="button" className={css.secondary} disabled={isUnlocked&&session!==null&&!canRegister}
          onClick={()=>onStart?onStart('patient'):onNavigate('patients')}>Registrar paciente</button>
      </div>
    </header>
    <nav className={css.destinations} aria-label="Accesos clínicos rápidos">
      {DESTINATIONS.map(item=><button key={item.id} className={css.destination} type="button"
        onClick={()=>onNavigate(item.id)}>
        <span className={css.destinationIcon}><ClinicalIcon kind={item.id}/></span>
        <span className={css.destinationCopy}><strong>{item.label}</strong></span>
        <span className={css.destinationArrow} aria-hidden="true">›</span>
      </button>)}
    </nav>

    {!isUnlocked&&<div className={css.lockedStrip} role="status">
      <span>{accessStatus==='locked'?'Clínica bloqueada':'Servicio clínico sin conexión'}</span>
      <button type="button" className={css.primary} onClick={onRequestAccess}>Abrir acceso protegido</button>
    </div>}

    {isUnlocked&&<div className={css.operational}>
      {loading&&<p className={css.feedback} role="status">Cargando la jornada desde los registros autorizados…</p>}
      {error&&<p className={css.feedback} role="alert">{error}</p>}
      {session&&<div className={css.metrics}>
        <button className={css.metric} type="button" onClick={()=>onNavigate('patients')}>
          <small>Pacientes autorizados</small>
          <strong>{canDirectory?patients.length:'—'}</strong>
          
        </button>
        <button className={css.metric} type="button" onClick={()=>onNavigate('appointments')}>
          <small>Citas de hoy</small>
          <strong>{canDirectory?todayVisits.length:'—'}</strong>
          
        </button>
        <button className={css.metric} type="button" onClick={()=>onNavigate('appointments')}>
          <small>Pendientes de atención</small>
          <strong>{canDirectory?pending.length:'—'}</strong>
          
        </button>
      </div>}
      {session&&<div className={css.columns}>
        <section className={css.journey} aria-label="Pacientes autorizados">
          <div className={css.sectionHead}>
            <h4>Pacientes</h4>
            <button type="button" onClick={()=>onNavigate('patients')}>Abrir directorio</button>
          </div>
          {canDirectory&&<label className={css.search}>Buscar por nombre, documento o teléfono
            <input aria-label="Buscar paciente en inicio" type="search" value={search}
              onChange={event=>setSearch(event.currentTarget.value)}
              placeholder="Buscar expediente autorizado…"/>
          </label>}
          <div className={css.people}>
            {matches.map(patient=><div className={css.personRow} key={patient.id}><button className={css.person} type="button"
              onClick={()=>openPatient(patient.id)}>
              <span className={css.avatar} aria-hidden="true">{patient.name.trim().split(/\s+/u).slice(0,2).map(word=>word[0]??'').join('').toLocaleUpperCase('es')}</span>
              <span><strong>{patient.name}</strong></span>
              <span aria-hidden="true">›</span>
            </button>{canConsult&&<button type="button" className={css.secondary} onClick={()=>consultPatient(patient.id)}>Consultar</button>}</div>)}
            {!matches.length&&<p className={css.empty}>
              {canDirectory?'No se encontraron expedientes en tu ámbito de acceso.':'Tu rol no dispone de acceso al directorio de pacientes.'}
            </p>}
          </div>
        </section>
        <aside className={css.access} aria-label="Agenda del día">
          <div className={css.sectionHead}>
            <h4>Agenda de hoy</h4>
            <button type="button" onClick={()=>onNavigate('appointments')}>Ver todas</button>
          </div>
          <div className={css.people}>
            {todayVisits.slice(0,8).map(item=><div key={item.id} className={css.personRow}><button className={css.appointment}
              type="button" onClick={()=>typeof item.patientId==='string'
                ?openPatient(item.patientId):onNavigate('appointments')}>
              <span className={css.appointmentHour}>{clock(item.startsAt)}</span>
              <span><strong>{patients.find(patient=>patient.id===item.patientId)?.name??'Cita registrada'}</strong>
                <small>{item.status==='scheduled'?'Programada':String(item.status??'Registrada')}</small></span>
            </button>{canConsult&&typeof item.patientId==='string'&&patients.some(p=>p.id===item.patientId)&&item.status==='scheduled'&&<button type="button" className={css.secondary} onClick={()=>consultPatient(String(item.patientId))}>Atender</button>}</div>)}
            {!todayVisits.length&&<p className={css.empty}>No hay citas visibles para hoy en tu ámbito de acceso.</p>}
          </div>
        </aside>
      </div>}
    </div>}
  </section>
}
