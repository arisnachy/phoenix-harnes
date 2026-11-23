/**
 * Healthia daily dashboard: actual authorized clinical records only.
 * No fictitious counts, browser persistence or patient data sent to chat.
 */
import { useEffect, useState } from 'react'
import { HealthiaClinicalApi } from './HealthiaClinicalApi.ts'
import type { ClinicResource, ClinicalPatient } from './HealthiaClinicalApi.ts'
import css from './HealthiaClinicDashboard.module.css'
const api=new HealthiaClinicalApi()
const localDay=(value:string):string=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/Santo_Domingo'})
const today=():string=>localDay(new Date().toISOString())
export function HealthiaClinicDashboard({onNavigate,onPatientChange}:{
  onNavigate:(section:string)=>void;onPatientChange:(patientId:string)=>void
}) {
  const [patients,setPatients]=useState<readonly ClinicalPatient[]>([])
  const [visits,setVisits]=useState<readonly ClinicResource[]>([])
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    let active=true
    void (async()=>{
      try {
        const s=await api.session()
        const [directory,appointments]=await Promise.all([
          ['admin','clinician','psychologist','nurse','reception'].includes(s.actor.role)
            ?api.patients(s):Promise.resolve([]),
          ['admin','clinician','psychologist','nurse','reception'].includes(s.actor.role)
            ?api.listClinicResources(s,'appointments'):Promise.resolve([]),
        ])
        if(active){setPatients(directory);setVisits(appointments)}
      }catch(e){if(active)setError(e instanceof Error?e.message:'No se pudo verificar la sesión clínica')}
      finally{if(active)setLoading(false)}
    })()
    return()=>{active=false}
  },[])
  const date=today()
  const todays=visits.filter(v=>typeof v.startsAt==='string'&&localDay(v.startsAt)===date&&v.status!=='cancelled')
  const pending=todays.filter(v=>v.status==='scheduled')
  const matches=search.trim()?patients.filter(p=>
    [p.name,p.documentNumber,p.phone,p.email].some(v=>typeof v==='string'&&
      v.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))))
    :patients.slice(0,8)
  const pick=(id:string)=>{onPatientChange(id);onNavigate('patients')}
  if(loading||error)return <section className={css.root} aria-label="Inicio clínico">
    <header className={css.top}><div><h3>¿Qué necesitas hacer hoy?</h3>
      <p>{loading?'Cargando la actividad autorizada…':'Inicia sesión para acceder a los registros clínicos.'}</p></div>
      <button className={css.primary} type="button" onClick={()=>onNavigate('encounters')}>+ Nueva consulta</button>
    </header>
    <p className={css.empty} role={error?'alert':'status'}>
      {error||'Recuperando pacientes y citas desde el servicio protegido…'}
    </p>
    {error&&<button className={css.primary} type="button" onClick={()=>onNavigate('patients')}>
      Abrir registro de pacientes
    </button>}
  </section>
  return <section className={css.root} aria-label="Inicio clínico">
    <header className={css.top}><div><h3>¿Qué necesitas hacer hoy?</h3><p>Actividad clínica desde el repositorio protegido</p></div>
      <button className={css.primary} type="button" onClick={()=>onNavigate('encounters')}>+ Nueva consulta</button>
    </header>
    <label className={css.search}>Buscar paciente, cédula o teléfono
      <input type="search" aria-label="Buscar paciente en inicio" placeholder="Buscar expediente autorizado…" value={search}
        onChange={e=>setSearch(e.currentTarget.value)}/>
    </label>
    <div className={css.metrics}>
      <button type="button" className={css.metric} onClick={()=>onNavigate('appointments')}>
        <span>Agenda de hoy</span><strong>{todays.length}</strong><small>Citas registradas</small>
      </button>
      <button type="button" className={css.metric} onClick={()=>onNavigate('appointments')}>
        <span>Por atender</span><strong>{pending.length}</strong><small>Programadas y sin cerrar</small>
      </button>
    </div>
    <div className={css.header}><h4>{search.trim()?'Resultados de pacientes':'Pacientes recientes'}</h4>
      <button type="button" onClick={()=>onNavigate('patients')}>Abrir directorio</button>
    </div>
    <div className={css.list}>
      {matches.map(p=><button type="button" className={css.person} key={p.id} onClick={()=>pick(p.id)}>
        <span className={css.avatar} aria-hidden="true">{p.name.slice(0,1).toLocaleUpperCase('es')}</span>
        <span><strong>{p.name}</strong><small>Expediente disponible</small></span><span aria-hidden="true">›</span>
      </button>)}
      {!matches.length&&<p className={css.empty}>No existen coincidencias entre los expedientes autorizados. Puedes registrar un paciente en el directorio.</p>}
    </div>
    <div className={css.header}><h4>Citas registradas para hoy</h4>
      <button type="button" onClick={()=>onNavigate('appointments')}>Ver agenda</button>
    </div>
    <div className={css.list}>
      {todays.slice(0,20).map(v=><button type="button" key={v.id} className={css.person}
        onClick={()=>typeof v.patientId==='string'?pick(v.patientId):onNavigate('appointments')}>
        <span className={css.avatar} aria-hidden="true">◷</span>
        <span><strong>{patients.find(p=>p.id===v.patientId)?.name??'Cita autorizada'}</strong>
          <small>{new Date(String(v.startsAt)).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',timeZone:'America/Santo_Domingo'})} · {v.status==='scheduled'?'Programada':v.status??'Registrada'}</small>
        </span><span aria-hidden="true">›</span>
      </button>)}
      {!todays.length&&<p className={css.empty}>No hay citas registradas para hoy en tu ámbito de acceso.</p>}
    </div>
  </section>
}
