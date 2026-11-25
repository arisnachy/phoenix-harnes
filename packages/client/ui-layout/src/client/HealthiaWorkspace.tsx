/**
 * PHOENIX clinical workspace: one contextual app surface, never another branded
 * application shell. The protected local record remains Host-owned.
 * No patient record is read or written from chat, UI events or localStorage.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import css from './HealthiaWorkspace.module.css'
import { HealthiaClinicOperations } from './HealthiaClinicOperations.tsx'
import type { ClinicalEditorRequest, ClinicalEditorViewState } from './HealthiaEditorSupport.ts'
import { HealthiaClinicDashboard } from './HealthiaClinicDashboard.tsx'
import { HealthiaOperationsBoard } from './HealthiaOperationsBoard.tsx'
import { clinicalBmi } from './HealthiaClinicalNote.tsx'
import { estimatedMap } from './HealthiaEditorSupport.ts'
import type { AdaptiveLiveSnapshot } from './AdaptiveLiveSlots.ts'
import { probeClinicalSession, type ClinicalRouteStatus } from './HealthiaClinicalBridge.ts'
import {
  addAdaptiveField, removeAdaptiveField, describeAdaptiveApp, isBindingConnected,
  HEALTHIA_DOCTOR_FORM,
  type AdaptiveInputKind, type AdaptiveDestination, type AdaptiveOutput, type AdaptiveFormDraft,
} from './AdaptiveAppCatalog.ts'

export type HealthiaRole = 'doctor' | 'patient'

/** Seven clinician destinations; editing, calculators and advanced features live inside Tools. */
export const HEALTHIA_NAV: Record<HealthiaRole, readonly { id: string; label: string }[]> = {
  doctor: [
    { id: 'overview', label: 'Inicio' },
    { id: 'appointments', label: 'Agenda' },
    { id: 'patients', label: 'Pacientes' },
    { id: 'encounters', label: 'Consultas' },
    { id: 'documents', label: 'Documentos' },
    { id: 'management', label: 'Gestión' },
    { id: 'tools', label: 'Herramientas' },
  ],
  patient: [
    { id: 'overview', label: 'Mi espacio' },
    { id: 'appointments', label: 'Citas' },
    { id: 'records', label: 'Mi expediente' },
    { id: 'documents', label: 'Documentos' },
    { id: 'consent', label: 'Autorizaciones' },
  ],
}

const MODULES: Readonly<Record<string, { title: string; detail: string }>> = {
  patients: { title: 'Registro longitudinal', detail: 'Identidad, contacto, alergias, medicamentos y antecedentes. La escritura clínica solo podrá ocurrir desde el repositorio protegido.' },
  appointments: { title: 'Agenda de consultas', detail: 'Citas, seguimiento y recordatorios. La agenda necesita un servicio autenticado antes de mostrar datos o confirmar una cita.' },
  documents: { title: 'Documentación clínica', detail: 'Recetas, solicitudes, indicaciones, certificados y resultados se generarán a partir de una consulta registrada y revisada.' },
  management: { title: 'Operación administrativa', detail: 'Facturación, inventario e informes operativos se habilitarán según permisos, sin exponer historias clínicas.' },
  records: { title: 'Expediente del paciente', detail: 'El acceso depende de la identidad autenticada y de los permisos de divulgación del profesional.' },
  consent: { title: 'Autorizaciones', detail: 'Ningún expediente se comparte desde esta vista. Los permisos deberán ser explícitos, verificables y revocables.' },
}

export function HealthiaWorkspace({
  role, section, onRoleChange, onSectionChange, onReturn, inspectRuntime, requestedStep, onEditorState,
}: {
  requestedStep?:ClinicalEditorRequest|undefined
  onEditorState?:((state:ClinicalEditorViewState|null)=>void)|undefined
  role: HealthiaRole
  section: string
  onRoleChange: (role: HealthiaRole) => void
  onSectionChange: (section: string) => void
  onReturn: () => void
  inspectRuntime?: (() => AdaptiveLiveSnapshot) | undefined
}) {
  const [draft, setDraft] = useState<AdaptiveFormDraft>(HEALTHIA_DOCTOR_FORM)
  const [history, setHistory] = useState<readonly AdaptiveFormDraft[]>([])
  const [fieldLabel, setFieldLabel] = useState('')
  const [kind, setKind] = useState<AdaptiveInputKind>('text')
  const [destination, setDestination] = useState<AdaptiveDestination>('local')
  const [output, setOutput] = useState<AdaptiveOutput>('inline')
  const [draftError, setDraftError] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [calculator,setCalculator]=useState({weight:'',height:'',sys:'',dia:''})
  const bmi=clinicalBmi(calculator)
  const pam=estimatedMap(calculator)
  const [minimized, setMinimized] = useState(false)
  const [entry, setEntry] = useState<{kind:'patient'|'encounter';sequence:number}|undefined>()
  const entrySequence = useRef(0)
  const [clinical, setClinical] = useState<ClinicalRouteStatus>({
    status: 'unavailable', role: null, patientPortal: 'not-verified',
  })
  const [clinicalRefresh, setClinicalRefresh] = useState(0)
  const [accessOpen,setAccessOpen]=useState(false)
  const [accessEpoch,setAccessEpoch]=useState(0)
  const accessDialog=useRef<HTMLDialogElement>(null)
  const requestAccess=()=>setAccessOpen(true)
  const accessReady=()=>{setAccessOpen(false);setAccessEpoch(value=>value+1);setClinicalRefresh(value=>value+1)}
  useEffect(()=>{
    if(!accessOpen)return
    const dialog=accessDialog.current
    if(!dialog)return
    if(typeof dialog.showModal==='function')dialog.showModal()
    else dialog.setAttribute('open','')
    return()=>{if(typeof dialog.close==='function'&&dialog.open)dialog.close()}
  },[accessOpen])
  useEffect(()=>{setAccessOpen(false)},[role])
  const [selectedClinicalPatient, setSelectedClinicalPatient] = useState('')
  const [liveStatus, setLiveStatus] = useState<AdaptiveLiveSnapshot | null>(null)
  const isPatient = role === 'patient'
  const active = HEALTHIA_NAV[role].some(item => item.id === section) ? section : 'overview'
  const capabilities = describeAdaptiveApp('healthia')?.capabilities ?? []
  useEffect(() => { setMinimized(false) }, [section, role, requestedStep])
  const start = (kind:'patient'|'encounter'):void => {
    setEntry({kind,sequence:++entrySequence.current})
    setMinimized(false)
    onSectionChange(kind==='patient'?'patients':'encounters')
  }
  useEffect(() => {
    let mounted = true
    void probeClinicalSession().then(status => { if (mounted) setClinical(status) })
    return () => { mounted = false }
  }, [clinicalRefresh])
  useEffect(() => {
    if (active !== 'tools' || !showEditor || inspectRuntime === undefined) return
    try { setLiveStatus(inspectRuntime()) }
    catch { setLiveStatus(null) }
  }, [active, showEditor, inspectRuntime])

  const addField = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const next = addAdaptiveField(draft, { label: fieldLabel.trim(), kind, destination, output })
      setHistory(items => [...items.slice(-19), draft])
      setDraft(next)
      setFieldLabel('')
      setDraftError('')
    } catch {
      setDraftError('El campo no pasó la validación. El borrador anterior sigue intacto.')
    }
  }
  const removeField = (id: string): void => {
    try {
      const next = removeAdaptiveField(draft, id)
      setHistory(items => [...items.slice(-19), draft])
      setDraft(next)
      setDraftError('')
    } catch {
      setDraftError('El campo está protegido o el borrador necesita revisión.')
    }
  }

  return (
    <section className={css.shell} aria-label="Espacio clínico de PHOENIX">
      <header className={css.titleRow}>
        <div>
          <span className={css.eyebrow}>{minimized ? 'ESPACIO CLÍNICO · EN PAUSA VISUAL' : 'ESPACIO CLÍNICO'}</span>
          <h2>{HEALTHIA_NAV[role].find(item => item.id === active)?.label}</h2>
        </div>
        <div className={css.actions}>
          {!isPatient&&clinical.status!=='authenticated'&&<button type="button" className={css.action} onClick={requestAccess}>Acceso clínico</button>}
          <details className={css.roleMenu}>
            <summary>Vista: {isPatient ? 'Paciente' : 'Médico'}</summary>
            <div className={css.roleChoices}>
              <button type="button" aria-pressed={role === 'doctor'}
                onClick={() => onRoleChange('doctor')}>Médico</button>
              <button type="button" aria-pressed={role === 'patient'}
                onClick={() => onRoleChange('patient')}>Paciente</button>
            </div>
          </details>
          <button className={css.action} type="button" aria-expanded={!minimized} onClick={()=>setMinimized(value=>!value)}>{minimized?'Restaurar espacio clínico':'Minimizar espacio clínico'}</button>
          <button className={css.action} type="button" onClick={onReturn}>Volver al chat</button>
        </div>
      </header>
      {!isPatient&&accessOpen&&<dialog ref={accessDialog} className={css.accessDialog} aria-label="Acceso clínico seguro" onCancel={event=>{event.preventDefault();setAccessOpen(false)}}>
        <div className={css.dialogHeader}><strong>Acceso a la clínica</strong><button type="button" className={css.action} onClick={()=>setAccessOpen(false)}>Cerrar</button></div>
        <HealthiaClinicOperations area="patients" accessOnly onSessionReady={accessReady}/>
      </dialog>}
      <div className={css.workspaceContent} hidden={minimized}>
      {isPatient && (
        <div className={css.sessionStrip} role="status">
          <span className={css.notice}>
            {isPatient
              ? 'Vista del paciente. Cambiar la vista no inicia sesión ni concede acceso a datos.'
              : clinical.status === 'locked'
                ? 'Inicia sesión para acceder a los expedientes del servicio clínico protegido.'
                : 'El servicio clínico aún no está disponible. Los expedientes no se guardan fuera del repositorio protegido.'}
          </span>

        </div>
      )}
      <details className={css.manualNavigation} open={isPatient||undefined}>
      <summary>Accesos manuales</summary>
      <nav className={css.tabs} aria-label="Secciones del espacio clínico">
        {HEALTHIA_NAV[role].map(item => (
          <button key={item.id} type="button" aria-current={item.id === active ? 'page' : undefined}
            className={item.id === active ? css.activeTab : css.tab}
            onClick={() => onSectionChange(item.id)}>{item.label}</button>
        ))}
      </nav>
      </details>
      <div className={css.body}>
        {active === 'overview' && (!isPatient
          ? <HealthiaClinicDashboard onNavigate={onSectionChange} onStart={start}
              onPatientChange={setSelectedClinicalPatient}
              accessStatus={clinical.status}
              onRequestAccess={requestAccess}/>
          : <div className={css.dashboard}>
              <p className={css.description}>El portal del paciente utiliza una cuenta vinculada y permisos propios.
                Cambiar de vista no concede acceso a un expediente.</p>
              <div className={css.quickGrid}>
                {[{id:'appointments',title:'Mis citas',detail:'Solicitudes y próximas visitas'},
                  {id:'records',title:'Mi expediente',detail:'Información autorizada'},
                  {id:'documents',title:'Mis documentos',detail:'Recetas e informes compartidos'}].map(item=>
                  <button key={item.id} className={css.quickCard} type="button"
                    onClick={()=>onSectionChange(item.id)}><strong>{item.title}</strong><span>{item.detail}</span></button>)}
              </div>
            </div>
        )}
        {!isPatient && (active === 'encounters' || active === 'patients') &&
          <HealthiaClinicOperations key={accessEpoch} area={active} selectedPatientId={selectedClinicalPatient}
            onPatientChange={setSelectedClinicalPatient} onNavigate={onSectionChange} onRequestAccess={requestAccess} onSessionReady={()=>setClinicalRefresh(value=>value+1)} entry={entry} onEntryHandled={sequence=>setEntry(previous=>previous?.sequence===sequence?undefined:previous)} requestedStep={requestedStep} onEditorState={onEditorState} />}
        {!isPatient && (active === 'appointments' || active === 'documents' || active === 'management') &&
          (clinical.status==='authenticated'
            ?<HealthiaOperationsBoard section={active} selectedPatientId={selectedClinicalPatient}
              onPatientChange={setSelectedClinicalPatient}/>
            :<HealthiaClinicOperations key={active} area="patients" accessOnly deferredAccess onRequestAccess={requestAccess}
              onSessionReady={()=>setClinicalRefresh(value=>value+1)}/>)} 
        {active !== 'overview' && active !== 'encounters' && active !== 'patients' && active !== 'tools'
          && (isPatient || !['appointments','documents','management'].includes(active)) && (
          <div className={css.modulePlaceholder}>
            <strong>{MODULES[active]?.title ?? HEALTHIA_NAV[role].find(item => item.id === active)?.label}</strong>
            <p>{MODULES[active]?.detail}</p>
            <span className={css.notice}>Sin datos ficticios ni acciones clínicas simuladas. El acceso se habilitará desde el proveedor autorizado.</span>
          </div>
        )}
        {active === 'tools' && !isPatient && (
          <div className={css.tools}>
            <div className={css.toolActions}>
              <button className={css.action} type="button" onClick={()=>start('encounter')}>Abrir consulta</button>
              <button className={css.action} type="button" onClick={()=>setShowEditor(value=>!value)} aria-expanded={showEditor}>{showEditor?'Cerrar editor de plantillas':'Editar estructura de formularios'}</button>
              <button className={css.action} type="button" onClick={()=>setCalculator({weight:'',height:'',sys:'',dia:''})}>Limpiar cálculos</button>
            </div>
            <div className={css.calculatorGrid}>
              <section className={css.calculator} aria-label="Calculadora de IMC">
                <h3>IMC</h3>
                <div className={css.calculatorFields}>
                  <label>Peso (kg)<input type="number" min="0.05" max="1000" step="any" value={calculator.weight} onChange={e=>setCalculator(old=>({...old,weight:e.target.value}))}/></label>
                  <label>Talla (cm)<input type="number" min="10" max="300" step="any" value={calculator.height} onChange={e=>setCalculator(old=>({...old,height:e.target.value}))}/></label>
                </div>
                <output aria-label="Resultado IMC" className={css.calculatorResult}>{bmi===undefined?'—':bmi.toFixed(1)+' kg/m²'}</output>
              </section>
              <section className={css.calculator} aria-label="Calculadora de presión arterial media">
                <h3>PAM estimada</h3>
                <div className={css.calculatorFields}>
                  <label>Sistólica (mmHg)<input type="number" min="1" max="400" step="any" value={calculator.sys} onChange={e=>setCalculator(old=>({...old,sys:e.target.value}))}/></label>
                  <label>Diastólica (mmHg)<input type="number" min="1" max="300" step="any" value={calculator.dia} onChange={e=>setCalculator(old=>({...old,dia:e.target.value}))}/></label>
                </div>
                <output aria-label="Resultado PAM" className={css.calculatorResult}>{pam===undefined?'—':pam.toFixed(1)+' mmHg'}</output>
              </section>
            </div>
            {showEditor && (
              <div className={css.formPreview}>
                <p>Cambios: borradores sin publicar; no modifican expedientes.</p>
                <div className={css.draftHeader}><span>Plantilla de consulta · revisión {draft.revision}</span>
                  <button type="button" className={css.action} disabled={!history.length}
                    onClick={() => { const last = history.at(-1); if (last) setDraft(last); setHistory(items => items.slice(0, -1)) }}>Deshacer cambio</button>
                </div>
                <div className={css.fieldList}>
                  {draft.fields.map(field => (
                    <div className={css.fieldRow} key={field.id}>
                      <span><strong>{field.label}</strong><small>{field.kind} · {isBindingConnected(field.binding, capabilities) ? 'Local' : 'Conector pendiente'}</small></span>
                      {field.protected ? <span className={css.locked}>Protegido</span> : (
                        <button type="button" className={css.removeField} aria-label={`Quitar campo ${field.label}`}
                          onClick={() => removeField(field.id)}>×</button>
                      )}
                    </div>
                  ))}
                </div>
                <form className={css.builder} onSubmit={addField}>
                  <input maxLength={60} value={fieldLabel} aria-label="Etiqueta de nuevo campo"
                    onChange={event => setFieldLabel(event.currentTarget.value)} placeholder="Nuevo campo" />
                  <label className={css.formSelect}>Tipo
                    <select value={kind} aria-label="Tipo de campo" onChange={event => setKind(event.target.value as AdaptiveInputKind)}>
                      <option value="text">Texto</option><option value="number">Número</option>
                      <option value="date">Fecha</option><option value="select">Selector</option>
                      <option value="textarea">Texto extenso</option>
                    </select>
                  </label>
                  <label className={css.formSelect}>Destino
                    <select value={destination} aria-label="Destino de campo" onChange={event => setDestination(event.target.value as AdaptiveDestination)}>
                      <option value="local">Local</option><option value="api">API autorizada</option>
                      <option value="chat">Chat (pendiente)</option><option value="ai">IA (pendiente)</option>
                    </select>
                  </label>
                  <label className={css.formSelect}>Salida
                    <select value={output} aria-label="Formato de salida" onChange={event => setOutput(event.target.value as AdaptiveOutput)}>
                      <option value="inline">En pantalla</option><option value="table">Tabla</option>
                      <option value="document">Documento</option><option value="chat">Chat</option>
                    </select>
                  </label>
                  <button type="submit" disabled={!fieldLabel.trim()}>Agregar campo</button>
                </form>
                {draftError && <p role="alert">{draftError}</p>}
                {liveStatus && <p className={css.notice}>Componentes UI inspeccionados: {liveStatus.slots.length}. Este recuento no concede permisos clínicos.</p>}
              </div>
            )}
          </div>
        )}
      </div>
      {active === 'tools' && <details className={css.supportDetails}>
        <summary>Información y acceso técnico</summary>
        <p>Los registros clínicos permanecen en el servicio protegido, no en el chat.</p>
        <a className={css.openClinical} href={isPatient ? '/health/patient' : '/health'}
          target="_blank" rel="noopener noreferrer">
          {isPatient ? 'Portal protegido del paciente' : 'Servicio clínico protegido'}
        </a>
      </details>}
      </div>
    </section>
  )
}
