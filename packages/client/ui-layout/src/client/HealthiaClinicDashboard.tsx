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
import { HealthiaClinicOperations } from './HealthiaClinicOperations.tsx'
import css from './HealthiaClinicDashboard.module.css'

const api=new HealthiaClinicalApi()
const clinicDay=(value:string):string=>new Date(value).toLocaleDateString('en-CA',{
  timeZone:'America/Santo_Domingo',
})
const clock=(value:unknown):string=>typeof value==='string'&&Number.isFinite(Date.parse(value))
  ?new Date(value).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Santo_Domingo'})
  :'Hora no registrada'

type Page='patients'|'encounters'|'appointments'|'documents'|'management'
const DESTINATIONS:readonly {id:Page;label:string;detail:string;glyph:string}[]=[
  {id:'patients',label:'Pacientes',detail:'Admisión y expediente',glyph:'P'},
  {id:'encounters',label:'Consultas',detail:'Historia, evaluación y firma',glyph:'C'},
  {id:'appointments',label:'Agenda',detail:'Citas y seguimiento',glyph:'A'},
  {id:'documents',label:'Documentos',detail:'Órdenes y recetas',glyph:'D'},
  {id:'management',label:'Gestión',detail:'Equipo y administración',glyph:'G'},
]

export function HealthiaClinicDashboard({onNavigate,onPatientChange,accessStatus,onSessionReady}:{
  onNavigate:(section:string)=>void
  onPatientChange:(patientId:string)=>void
  accessStatus:'authenticated'|'locked'|'unavailable'
  onSessionReady:()=>void
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
  const today=clinicDay(new Date().toISOString())
  const todayVisits=visits.filter(item=>typeof item.startsAt==='string'
    &&Number.isFinite(Date.parse(item.startsAt))
    &&clinicDay(item.startsAt)===today&&item.status!=='cancelled')
  const pending=todayVisits.filter(item=>item.status==='scheduled')
  const term=search.trim().toLocaleLowerCase('es')
  const matches=term?patients.filter(p=>[p.name,p.documentNumber,p.phone,p.email].some(v=>
    typeof v==='string'&&v.toLocaleLowerCase('es').includes(term))):patients.slice(0,7)
  const openPatient=(id:string):void=>{onPatientChange(id);onNavigate('patients')}

  return <section className={css.root} aria-label="Inicio de Healthia">
    <header className={css.hero}>
      <div className={css.heroCopy}>
        <span className={css.eyebrow}>CENTRO DE TRABAJO CLÍNICO</span>
        <h3>Tu jornada clínica, en un solo espacio</h3>
        <p>Gestiona pacientes, consultas, citas y documentos sin abandonar PHOENIX.
          El expediente permanece en el servicio clínico protegido.</p>
      </div>
      <div className={css.heroActions}>
        <button type="button" className={css.primary}
          onClick={()=>onNavigate('encounters')}>+ Nueva consulta</button>
        <button type="button" className={css.secondary}
          onClick={()=>onNavigate('patients')}>Registrar paciente</button>
      </div>
    </header>
    <nav className={css.destinations} aria-label="Accesos clínicos rápidos">
      {DESTINATIONS.map(item=><button key={item.id} className={css.destination} type="button"
        onClick={()=>onNavigate(item.id)}>
        <span className={css.destinationIcon} aria-hidden="true">{item.glyph}</span>
        <span className={css.destinationCopy}><strong>{item.label}</strong><small>{item.detail}</small></span>
        <span className={css.destinationArrow} aria-hidden="true">›</span>
      </button>)}
    </nav>

    {!isUnlocked&&<div className={css.columns}>
      <div className={css.journey}>
        <div className={css.sectionHead}>
          <div><span className={css.eyebrow}>ATENCIÓN INTEGRADA</span><h4>Así trabajará tu clínica</h4></div>
        </div>
        <div className={css.steps}>
          {[['01','Identifica al paciente','Admisión, contacto y expediente longitudinal'],
            ['02','Registra la consulta','Entrevista, exploración, diagnóstico y evolución'],
            ['03','Revisa y firma','Decisión profesional antes de emitir documentos'],
            ['04','Da seguimiento','Citas, estudios, recetas y continuidad asistencial']].map(([number,title,detail])=>
            <div className={css.step} key={number}>
              <span className={css.stepNumber}>{number}</span>
              <div><strong>{title}</strong><small>{detail}</small></div>
            </div>)}
        </div>
        <div className={css.smallNote}>Los menús y formularios están disponibles.
          Para leer o modificar un expediente real se requiere autorización profesional.</div>
      </div>
      <aside className={css.access} aria-label="Acceso profesional">
        <span className={css.eyebrow}>ACCESO INSTITUCIONAL</span>
        <h4>{accessStatus==='locked'?'Continuar con mi clínica':'Conectar el servicio clínico'}</h4>
        <p className={css.accessHelp}>
          {accessStatus==='locked'
            ?'Utiliza la cuenta de tu institución. Al acceder aparecerán los pacientes y citas reales.'
            :'El servicio local no respondió. Puedes explorar el entorno y comprobar la conexión aquí.'}
        </p>
        <HealthiaClinicOperations area="patients" accessOnly onSessionReady={onSessionReady}/>
      </aside>
    </div>}

    {isUnlocked&&<div className={css.operational}>
      {loading&&<p className={css.feedback} role="status">Cargando la jornada desde los registros autorizados…</p>}
      {error&&<p className={css.feedback} role="alert">{error}</p>}
      {session&&<div className={css.metrics}>
        <button className={css.metric} type="button" onClick={()=>onNavigate('patients')}>
          <small>Pacientes autorizados</small>
          <strong>{canDirectory?patients.length:'—'}</strong>
          <span>{canDirectory?'Expedientes accesibles':'Sin acceso a directorio'}</span>
        </button>
        <button className={css.metric} type="button" onClick={()=>onNavigate('appointments')}>
          <small>Citas de hoy</small>
          <strong>{canDirectory?todayVisits.length:'—'}</strong>
          <span>{canDirectory?'Agenda de la institución':'Según permisos de la cuenta'}</span>
        </button>
        <button className={css.metric} type="button" onClick={()=>onNavigate('appointments')}>
          <small>Pendientes de atención</small>
          <strong>{canDirectory?pending.length:'—'}</strong>
          <span>Programadas para hoy</span>
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
            {matches.map(patient=><button className={css.person} key={patient.id} type="button"
              onClick={()=>openPatient(patient.id)}>
              <span className={css.avatar} aria-hidden="true">{patient.name.slice(0,1).toLocaleUpperCase('es')}</span>
              <span><strong>{patient.name}</strong><small>Ver expediente longitudinal</small></span>
              <span aria-hidden="true">›</span>
            </button>)}
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
            {todayVisits.slice(0,8).map(item=><button className={css.appointment} key={item.id}
              type="button" onClick={()=>typeof item.patientId==='string'
                ?openPatient(item.patientId):onNavigate('appointments')}>
              <span className={css.appointmentHour}>{clock(item.startsAt)}</span>
              <span><strong>{patients.find(patient=>patient.id===item.patientId)?.name??'Cita registrada'}</strong>
                <small>{item.status==='scheduled'?'Programada':String(item.status??'Registrada')}</small></span>
            </button>)}
            {!todayVisits.length&&<p className={css.empty}>No hay citas visibles para hoy en tu ámbito de acceso.</p>}
          </div>
        </aside>
      </div>}
    </div>}
  </section>
}
