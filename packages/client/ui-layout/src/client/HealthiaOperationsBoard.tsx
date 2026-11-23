/**
 * Authenticated PHOENIX Healthia operational desk. Every action uses existing
 * encrypted /health routes. No clinical record, password or CSRF enters Kira.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { HealthiaClinicalApi } from './HealthiaClinicalApi.ts'
import type { ClinicResource, ClinicStaff, ClinicAssignment,
  ClinicalEncounter, ClinicalPatient, ClinicalSession } from './HealthiaClinicalApi.ts'
import { printProtectedClinicalDocument } from './HealthiaClinicalPrint.ts'
import css from './HealthiaOperationsBoard.module.css'

const api=new HealthiaClinicalApi()
type Section='appointments'|'documents'|'management'
type Desk='appointments'|'followups'|'orders'|'prescriptions'|'invoices'|'team'
type Role=ClinicalSession['actor']['role']
const TITLE:Record<Desk,string>={
  appointments:'Agenda',followups:'Seguimiento',orders:'Laboratorio e imágenes',
  prescriptions:'Recetas',invoices:'Facturación',team:'Equipo y asignaciones',
}
const READ:Readonly<Record<Exclude<Desk,'team'>,readonly Role[]>>={
  appointments:['admin','clinician','psychologist','nurse','reception'],
  followups:['admin','clinician','psychologist','nurse','reception'],
  orders:['admin','clinician','psychologist','nurse','lab','radiology'],
  prescriptions:['admin','clinician','pharmacy'],invoices:['admin','billing'],
}
const WRITE:Readonly<Record<Exclude<Desk,'team'>,readonly Role[]>>={
  appointments:['admin','clinician','psychologist','reception'],
  followups:['admin','clinician','psychologist','nurse','reception'],
  orders:['clinician'],prescriptions:['clinician'],invoices:['admin','billing'],
}
const STAGES:Readonly<Record<Section,readonly Desk[]>>={
  appointments:['appointments','followups'],documents:['orders','prescriptions'],
  management:['invoices','team'],
}
const label=(item:ClinicResource):string=>{
  for(const key of ['reason','description','medication','concept','display']){
    if(typeof item[key]==='string'&&String(item[key]).trim())return String(item[key])
  }
  return 'Registro clínico'
}
const moment=(value:unknown):string=>{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return 'Sin fecha registrada'
  return new Date(value).toLocaleString('es-DO',{dateStyle:'medium',timeStyle:'short'})
}
const euro=(value:unknown):string=>{
  const amount=Number(value)
  return Number.isFinite(amount)?'RD$ '+(amount/100).toLocaleString('es-DO',{minimumFractionDigits:2,maximumFractionDigits:2}):'Monto no verificado'
}
/** Arithmetic only. The clinician supplies an independently validated regimen. */
export function clinicianDoseCalculation(weight:unknown,perKg:unknown,maxDose:unknown):number|undefined {
  const kg=Number(weight),mgKg=Number(perKg),cap=Number(maxDose)
  if(![kg,mgKg,cap].every(Number.isFinite)||kg<=0||kg>350||mgKg<=0||mgKg>1000||cap<=0||cap>100000)
    return undefined
  return Math.round(Math.min(kg*mgKg,cap)*100)/100
}
export function HealthiaOperationsBoard({section,selectedPatientId,onPatientChange}:{
  section:Section;selectedPatientId?:string;onPatientChange?:(id:string)=>void
}) {
  const [session,setSession]=useState<ClinicalSession|null>(null)
  const [patients,setPatients]=useState<readonly {id:string;name:string;allergyReview?:ClinicalPatient['allergyReview']}[]>([])
  const [encounters,setEncounters]=useState<readonly ClinicalEncounter[]>([])
  const [staff,setStaff]=useState<readonly ClinicStaff[]>([])
  const [assignments,setAssignments]=useState<readonly ClinicAssignment[]>([])
  const [desk,setDesk]=useState<Desk>(STAGES[section][0]!)
  const [records,setRecords]=useState<readonly ClinicResource[]>([])
  const [form,setForm]=useState<Record<string,string>>({})
  const [patientId,setPatientId]=useState(selectedPatientId??'')
  const [safety,setSafety]=useState(false)
  const [teamMode,setTeamMode]=useState<'assign'|'staff'>('assign')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const role=session?.actor.role
  const options=useMemo(()=>STAGES[section].filter(kind=>kind==='team'
    ?role==='admin'||role==='reception':role!==undefined&&READ[kind].includes(role)),[role,section])
  const active=options.includes(desk)?desk:options[0]
  const canCreate=active!==undefined&&role!==undefined&&(active==='team'
    ?role==='admin'||role==='reception':WRITE[active].includes(role))
  const signedEncounters=encounters.filter(e=>e.status==='signed'&&e.practitioner===session?.actor.username)
  const selectedEncounter=signedEncounters.find(e=>e.id===form.encounterId)
  const currentPatient=patients.find(p=>p.id===(selectedEncounter?.patientId??patientId))
  const calcDose=clinicianDoseCalculation(form.weightKg,form.mgPerKg,form.maxDoseMg)

  useEffect(()=>{setDesk(STAGES[section][0]!);setForm({});setNotice('');setError('')},[section])
  useEffect(()=>{if(selectedPatientId!==undefined)setPatientId(selectedPatientId)},[selectedPatientId])
  useEffect(()=>{
    let live=true
    setLoading(true)
    void (async()=>{
      try{
        const s=await api.session()
        if(!live)return
        setSession(s)
        const canPatients=['admin','clinician','psychologist','nurse','reception'].includes(s.actor.role)
        const canOptions=['billing'].includes(s.actor.role)
        const canVisits=['admin','clinician','psychologist','nurse'].includes(s.actor.role)
        const [directory,visits,members,grants]=await Promise.all([
          canPatients?api.patients(s):canOptions?api.clinicPatientOptions(s):Promise.resolve([]),
          canVisits?api.encounters(s):Promise.resolve([]),
          s.actor.role==='admin'?api.clinicStaff(s):Promise.resolve([]),
          ['admin','reception'].includes(s.actor.role)?api.clinicAssignments(s):Promise.resolve([]),
        ])
        if(live){setPatients(directory);setEncounters(visits);setStaff(members);setAssignments(grants)}
      }catch(e){if(live)setError(e instanceof Error?e.message:'No se pudo abrir el servicio protegido')}
      finally{if(live)setLoading(false)}
    })()
    return()=>{live=false}
  },[])
  useEffect(()=>{
    if(!session||!active||active==='team'){setRecords([]);return}
    let live=true
    setLoading(true)
    void api.listClinicResources(session,active).then(items=>{if(live)setRecords(items)})
      .catch(e=>{if(live)setError(e instanceof Error?e.message:'No se pudieron recuperar los registros')})
      .finally(()=>{if(live)setLoading(false)})
    return()=>{live=false}
  },[session,active])

  const put=(id:string,value:string):void=>{setForm(old=>({...old,[id]:value}));setError('');setNotice('')}
  const selectPatient=(id:string):void=>{setPatientId(id);onPatientChange?.(id);setForm({});setSafety(false)}
  const field=(id:string,title:string,type='text',required=true,placeholder='')=><label key={id} className={css.field}>
    {title}<input type={type} value={form[id]??''} required={required} placeholder={placeholder}
      min={type==='number'?'0':undefined} step={type==='number'?'any':undefined}
      maxLength={type==='text'?400:undefined}
      onChange={e=>put(id,e.currentTarget.value)}/>
  </label>
  const textarea=(id:string,title:string)=><label key={id} className={css.field}>
    {title}<textarea rows={3} maxLength={1400} required value={form[id]??''}
      onChange={e=>put(id,e.currentTarget.value)}/>
  </label>
  const update=async(item:ClinicResource,change:Record<string,unknown>)=>{
    if(!session||!active||active==='team'||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const changed=await api.updateClinicResource(session,active,item,change)
      setRecords(items=>items.map(row=>row.id===changed.id?changed:row))
      setNotice('Cambio confirmado en el repositorio clínico protegido.')
    }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el registro')}
    finally{setBusy(false)}
  }
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!session||!active||!canCreate||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      if(active==='team'){
        if(teamMode==='staff'){
          if(role!=='admin')throw Error('Solo administración crea usuarios.')
          await api.createClinicStaff(session,{username:form.username??'',password:form.password??'',role:form.role??'nurse'})
          setStaff(await api.clinicStaff(session))
        }else{
          await api.setClinicAssignment(session,{patientId,staffId:form.staffId??'',
            purpose:form.purpose??'',action:'grant'})
          setAssignments(await api.clinicAssignments(session))
        }
      }else{
        let payload:Record<string,unknown>={}
        if(active==='appointments')payload={patientId,practitioner:form.practitioner||session.actor.username,
          startsAt:new Date(form.startsAt??'').toISOString(),reason:form.reason}
        if(active==='followups')payload={patientId,assignedTo:form.assignedTo||session.actor.username,
          dueAt:new Date(form.dueAt??'').toISOString(),description:form.description}
        if(active==='orders')payload={encounterId:form.encounterId,modality:form.modality||'laboratory',
          description:form.description}
        if(active==='prescriptions'){
          if(!safety)throw Error('Debe completar la revisión farmacológica antes de recetar.')
          payload={encounterId:form.encounterId,medication:form.medication,
            directions:form.directions,safetyAcknowledged:true}
        }
        if(active==='invoices'){
          const decimal=Number((form.amount??'').replace(',','.'))
          const amountCents=Math.round(decimal*100)
          if(!Number.isFinite(decimal)||decimal<=0||!Number.isSafeInteger(amountCents)
            ||Math.abs(decimal*100-amountCents)>0.000001)throw Error('Monto inválido: utilice dos decimales.')
          payload={patientId,concept:form.concept,amountCents}
        }
        const saved=await api.createClinicResource(session,active,payload)
        setRecords(items=>[saved,...items])
      }
      setForm({});setSafety(false)
      setNotice('Registro confirmado y protegido. No se emitió ningún documento fiscal ni se envió información al chat.')
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar. Revise los campos y permisos.')}
    finally{setBusy(false)}
  }
  if(loading&&!session)return <p className={css.message} role="status">Comprobando acceso y registros autorizados…</p>
  if(!session)return <div className={css.message} role="alert">{error||'Inicie sesión en Healthia desde Pacientes o Consultas.'}</div>
  if(!active)return <p className={css.message}>Este perfil no tiene permisos para los módulos de esta sección.</p>
  return <section className={css.shell} aria-label={'Healthia · '+TITLE[active]}>
    <div className={css.header}><div><span className={css.eyebrow}>REPOSITORIO CLÍNICO PROTEGIDO</span>
      <h3>{TITLE[active]}</h3><p>{session.actor.username} · {session.actor.role}</p></div>
      <span className={css.status}>Sesión verificada</span>
    </div>
    <nav className={css.tabs} aria-label="Módulos autorizados">
      {options.map(item=><button type="button" key={item} aria-current={item===active?'page':undefined}
        className={item===active?css.active:css.tab}
        onClick={()=>{setDesk(item);setForm({});setNotice('');setError('')}}>{TITLE[item]}</button>)}
    </nav>
    {(error||notice)&&<p role={error?'alert':'status'} className={error?css.error:css.message}>{error||notice}</p>}
    {canCreate&&<form className={css.form} onSubmit={e=>{void submit(e)}}>
      <div className={css.formHeading}>
        <strong>{active==='team'?'Administrar equipo':'Nuevo registro de '+TITLE[active].toLocaleLowerCase('es')}</strong>
        <small>Los cambios se confirman directamente en el servicio clínico cifrado.</small>
      </div>
      {active==='team'&&role==='admin'&&<div className={css.tabs}>
        <button className={teamMode==='assign'?css.active:css.tab} type="button" onClick={()=>setTeamMode('assign')}>Asignar paciente</button>
        <button className={teamMode==='staff'?css.active:css.tab} type="button" onClick={()=>setTeamMode('staff')}>Crear cuenta profesional</button>
      </div>}
      {(active!=='team'||teamMode==='assign'||role==='reception')&&
        !['orders','prescriptions'].includes(active)&&<label className={css.field}>Paciente
          <select required value={patientId} onChange={e=>selectPatient(e.currentTarget.value)}>
            <option value="">Seleccione el paciente autorizado</option>
            {patients.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
          </select>
        </label>}
      <div className={css.grid}>
        {active==='appointments'&&<>
          {field('startsAt','Fecha y hora de la cita','datetime-local')}
          {field('practitioner','Profesional asignado (usuario institucional)','text',true,'Cuenta del profesional')}
          {textarea('reason','Motivo de la cita')}
        </>}
        {active==='followups'&&<>
          {field('dueAt','Fecha límite de seguimiento','datetime-local')}
          {field('assignedTo','Responsable (usuario institucional)','text',true)}
          {textarea('description','Tarea pendiente y criterio de cierre')}
        </>}
        {(active==='orders'||active==='prescriptions')&&<label className={css.field}>Consulta firmada
          <select required value={form.encounterId??''} onChange={e=>put('encounterId',e.currentTarget.value)}>
            <option value="">Seleccione una consulta firmada propia</option>
            {signedEncounters.map(e=><option value={e.id} key={e.id}>{e.complaint} · {e.patientId.slice(0,8)}</option>)}
          </select>
        </label>}
        {active==='orders'&&<>
          <label className={css.field}>Modalidad
            <select value={form.modality??'laboratory'} onChange={e=>put('modality',e.currentTarget.value)}>
              <option value="laboratory">Analítica / laboratorio</option><option value="imaging">Imagen diagnóstica</option>
            </select>
          </label>{textarea('description','Estudio, región, indicación y preparación')}
        </>}
        {active==='prescriptions'&&<>
          {field('medication','Principio activo, presentación y concentración')}
          {textarea('directions','Dosis, vía, frecuencia, duración, cantidad y observaciones')}
        </>}
        {active==='invoices'&&<>
          {field('concept','Servicio o concepto facturable')}
          {field('amount','Importe en RD$ (comprobante interno)','number')}
        </>}
        {active==='team'&&teamMode==='staff'&&role==='admin'&&<>
          {field('username','Identificador profesional')}
          {field('password','Contraseña inicial de al menos seis caracteres','password')}
          <label className={css.field}>Función institucional
            <select value={form.role??'nurse'} onChange={e=>put('role',e.currentTarget.value)}>
              {['clinician','psychologist','nurse','reception','lab','radiology','pharmacy','billing'].map(r=>
                <option value={r} key={r}>{r}</option>)}
            </select>
          </label>
        </>}
        {active==='team'&&(teamMode==='assign'||role==='reception')&&<>
          <label className={css.field}>Profesional autorizado
            {role==='admin'?<select required value={form.staffId??''} onChange={e=>put('staffId',e.currentTarget.value)}>
              <option value="">Elegir del equipo</option>
              {staff.filter(s=>['clinician','psychologist','nurse'].includes(s.role)).map(s=>
                <option key={s.username} value={s.username}>{s.username} · {s.role}</option>)}
            </select>:<input required maxLength={80} value={form.staffId??''}
              onChange={e=>put('staffId',e.currentTarget.value)} placeholder="Usuario profesional"/>}
          </label>
          {field('purpose','Motivo asistencial de la asignación')}
        </>}
      </div>
      {active==='prescriptions'&&<>
        <fieldset className={css.safety}>
          <legend>Apoyo aritmético de dosificación (no prescribe)</legend>
          <p>Introduce una pauta mg/kg y una dosis máxima previamente comprobadas en una fuente farmacológica válida.
            No hay una pauta predeterminada ni comprobación automática de interacciones.</p>
          <div className={css.grid}>
            {field('weightKg','Peso actualizado (kg)','number',false)}
            {field('mgPerKg','Pauta validada (mg/kg por administración)','number',false)}
            {field('maxDoseMg','Límite máximo verificado (mg por administración)','number',false)}
          </div>
          <p role="status">Resultado de cálculo: {calcDose===undefined?'requiere los tres valores válidos':calcDose+' mg por administración; verificar redondeo y presentación'}.</p>
        </fieldset>
        <div className={css.safety}>
          <strong>Revisión obligatoria antes de emitir</strong>
          <p>Alergias: {currentPatient?.allergyReview?.status==='documented'
            ?'Documentadas; revisar las reacciones':currentPatient?.allergyReview?.status==='none-known'
              ?'Revisadas anteriormente; reconfirmar':'No verificadas en esta vista'}. Compruebe interacciones,
            embarazo, función renal/hepática, edad, indicación, peso, vía y límites de dosis.
            El servidor exige revisión de alergias por el prescriptor.</p>
          <label className={css.check}><input type="checkbox" checked={safety}
            onChange={e=>setSafety(e.currentTarget.checked)}/> Confirmo que realicé las comprobaciones necesarias con fuentes fiables.</label>
        </div>
      </>}
      {active==='orders'&&<p className={css.message}>Solo se pueden emitir órdenes desde consultas firmadas por el profesional prescriptor.</p>}
      {active==='invoices'&&<p className={css.message}>Registro de cuenta interna. No genera NCF, e-CF ni comprobantes fiscales automáticos.</p>}
      <button className={css.primary} disabled={busy||(active==='prescriptions'&&!safety)
        ||((active==='orders'||active==='prescriptions')&&!selectedEncounter)} type="submit">
        {busy?'Guardando…':active==='team'?'Confirmar en la clínica':'Guardar registro protegido'}
      </button>
    </form>}
    <div className={css.listHeader}><strong>{active==='team'?'Equipo y acceso vigente':'Registros autorizados'}</strong>
      <small>{active==='team'?assignments.length:records.length} resultados</small></div>
    {loading&&<p role="status" className={css.message}>Actualizando registros…</p>}
    {active==='team'?<div className={css.list}>
      {assignments.map((a,i)=><article className={css.record} key={a.patientId+':'+a.staffId+':'+i}>
        <div><strong>{patients.find(p=>p.id===a.patientId)?.name??'Paciente autorizado'}</strong>
          <small>{a.staffId} · {a.purpose}</small></div>
        <button type="button" disabled={busy} onClick={()=>{
          if(!session)return
          setBusy(true);setError('')
          void api.setClinicAssignment(session,{patientId:a.patientId,staffId:a.staffId,action:'revoke'})
            .then(()=>api.clinicAssignments(session)).then(setAssignments)
            .catch(e=>setError(e instanceof Error?e.message:'No se pudo revocar la asignación'))
            .finally(()=>setBusy(false))
        }}>Revocar acceso</button>
      </article>)}
      {!assignments.length&&<p className={css.message}>Todavía no hay asignaciones registradas.</p>}
    </div>:<div className={css.list}>
      {records.map(item=><article key={item.id} className={css.record}>
        <div className={css.recordBody}><strong>{label(item)}</strong>
          <small>{patients.find(p=>p.id===item.patientId)?.name??'Paciente vinculado'} · {moment(item.startsAt??item.dueAt??item.createdAt)}</small>
          <span className={css.recordStatus}>{item.status??(active==='invoices'?'Cuenta abierta':'Registrado')}</span>
          {active==='invoices'&&<small>{euro(item.paidCents)} pagado de {euro(item.amountCents)}</small>}
        </div>
        <div className={css.recordActions}>
          <button type="button" onClick={()=>{
            try{
              printProtectedClinicalDocument({
                title:TITLE[active],
                institution:session.actor.org,
                patientName:patients.find(p=>p.id===item.patientId)?.name??'Paciente autorizado',
                patientId:typeof item.patientId==='string'?item.patientId:'No aplica',
                practitioner:typeof item.signedBy==='string'?item.signedBy:session.actor.username,
                date:moment(item.createdAt),
                status:active==='prescriptions'&&item.status==='prescribed'?'signed':item.status??'registrado',
                sections:[
                  {heading:'Descripción',body:label(item)},
                  {heading:'Indicaciones',body:typeof item.directions==='string'?item.directions:''},
                  {heading:'Resultado',body:typeof item.result==='string'?item.result:''},
                  ...(active==='invoices'?[{heading:'Cuenta administrativa (NO fiscal)',
                    body:'Total: '+euro(item.amountCents)+'\nAbonado: '+euro(item.paidCents)}]:[]),
                ],
                disclaimer:active==='invoices'
                  ?'RESUMEN ADMINISTRATIVO INTERNO: no es comprobante fiscal ni NCF/e-CF.'
                  :'Copia del registro clínico autorizado. Verifique alcance, estado y autenticidad.',
              })
            }catch(e){setError(e instanceof Error?e.message:'No se pudo imprimir el registro')}
          }}>Imprimir copia</button>
          {active==='appointments'&&['scheduled'].includes(item.status??'')&&canCreate&&
            <button type="button" disabled={busy} onClick={()=>{void update(item,{status:'completed'})}}>Atendida</button>}
          {active==='followups'&&item.status==='pending'&&canCreate&&
            <button type="button" disabled={busy} onClick={()=>{void update(item,{status:'done'})}}>Completar</button>}
          {active==='orders'&&role==='clinician'&&
            ['resulted'].includes(item.status??'')&&
            <button type="button" disabled={busy} onClick={()=>{void update(item,{action:'review'})}}>Revisar resultado</button>}
          {active==='invoices'&&canCreate&&Number(item.paidCents)<Number(item.amountCents)&&
            <button type="button" disabled={busy} onClick={()=>{
              const remaining=Number(item.amountCents)-Number(item.paidCents)
              void update(item,{paymentCents:remaining})
            }}>Registrar pago total</button>}
        </div>
      </article>)}
      {!records.length&&!loading&&<p className={css.message}>No hay registros accesibles para esta sección.</p>}
    </div>}
  </section>
}
