/** Healthia adaptive workspace. Never handles patient-identifiable form values. */
import { useEffect, useState, type FormEvent } from 'react'
import css from './HealthiaWorkspace.module.css'
import type { AdaptiveLiveSnapshot } from './AdaptiveLiveSlots.ts'
import {
  addAdaptiveField, removeAdaptiveField, describeAdaptiveApp, isBindingConnected,
  HEALTHIA_DOCTOR_FORM,
  type AdaptiveInputKind, type AdaptiveDestination, type AdaptiveOutput, type AdaptiveFormDraft,
} from './AdaptiveAppCatalog.ts'

export type HealthiaRole = 'doctor' | 'patient'

export const HEALTHIA_NAV: Record<HealthiaRole, readonly { id: string; label: string }[]> = {
  doctor: [
    { id: 'overview', label: 'Inicio clínico' },
    { id: 'patients', label: 'Pacientes' },
    { id: 'encounters', label: 'Consultas' },
    { id: 'records', label: 'Historia clínica' },
    { id: 'prescriptions', label: 'Recetas e informes' },
    { id: 'forms', label: 'Formularios' },
    { id: 'capabilities', label: 'Capacidades' },
    { id: 'exchange', label: 'Intercambios' },
  ],
  patient: [
    { id: 'overview', label: 'Mi espacio' },
    { id: 'appointments', label: 'Citas' },
    { id: 'records', label: 'Mi expediente' },
    { id: 'documents', label: 'Documentos' },
    { id: 'consent', label: 'Autorizaciones' },
    { id: 'capabilities', label: 'Capacidades' },
    { id: 'exchange', label: 'Compartir con mi médico' },
  ],
}

const CLINICAL_DESCRIPTIONS: Record<string, string> = {
  overview: 'El copiloto permanece abajo. Los datos del expediente solo se consultan en el servicio clínico autenticado.',
  patients: 'Búsqueda, identificación y conciliación supervisada de pacientes desde el registro clínico protegido.',
  encounters: 'Apertura de consulta, anamnesis, exploración, signos vitales y revisión profesional.',
  records: 'Información longitudinal y documentos restringidos según identidad, función y relación asistencial.',
  prescriptions: 'Borradores clínicos, revisión del profesional, firma y entrega documentada.',
  appointments: 'Agenda y solicitudes de citas. Pendiente de conexión al portal autenticado del paciente.',
  documents: 'Documentos y resultados que un profesional haya autorizado a visualizar.',
  consent: 'Autorizaciones granulares con vigencia, finalidad, destinatario y posibilidad de revocación.',
  exchange: 'Solicitudes entre instancias PHOENIX: sin transmisión automática ni acceso por defecto.',
}

export function HealthiaWorkspace({
  role, section, onRoleChange, onSectionChange, onReturn, inspectRuntime,
}: {
  role: HealthiaRole
  section: string
  onRoleChange: (role: HealthiaRole) => void
  onSectionChange: (section: string) => void
  onReturn: () => void
  inspectRuntime?: (() => AdaptiveLiveSnapshot) | undefined
}) {
  // Only field METADATA is edited in this view; never place patient values in chat/events.
  const [fieldLabel, setFieldLabel] = useState('')
  const [draft, setDraft] = useState<AdaptiveFormDraft>(HEALTHIA_DOCTOR_FORM)
  const [history, setHistory] = useState<readonly AdaptiveFormDraft[]>([])
  const [kind, setKind] = useState<AdaptiveInputKind>('text')
  const [destination, setDestination] = useState<AdaptiveDestination>('local')
  const [output, setOutput] = useState<AdaptiveOutput>('inline')
  const [draftError, setDraftError] = useState('')
  const capabilities = describeAdaptiveApp('healthia')?.capabilities ?? []
  const addField = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const next = addAdaptiveField(draft, { label: fieldLabel.trim(), kind, destination, output })
      setHistory(items => [...items.slice(-19), draft])
      setDraft(next)
      setFieldLabel('')
      setDraftError('')
    } catch {
      setDraftError('No se pudo validar el cambio del formulario; no se modificó el borrador.')
    }
  }
  const removeField = (id: string): void => {
    try {
      const next = removeAdaptiveField(draft, id)
      setHistory(items => [...items.slice(-19), draft])
      setDraft(next)
      setDraftError('')
    } catch {
      setDraftError('El campo está protegido o el borrador requiere revisión.')
    }
  }
  const undo = (): void => {
    const previous = history[history.length - 1]
    if (!previous) return
    setDraft(previous)
    setHistory(items => items.slice(0, -1))
    setDraftError('')
  }
  const active = HEALTHIA_NAV[role].some(item => item.id === section) ? section : 'overview'
  const isPatient = role === 'patient'
  const [liveStatus, setLiveStatus] = useState<AdaptiveLiveSnapshot | null>(null)
  useEffect(() => {
    if (active !== 'capabilities' || inspectRuntime === undefined) return
    try { setLiveStatus(inspectRuntime()) }
    catch { setLiveStatus(null) }
  }, [active, inspectRuntime])

  return (
    <section className={css.shell} aria-label="Healthia: espacio de trabajo adaptativo">
      <div className={css.header}>
        <div className={css.identity}>
          <span className={css.symbol} aria-hidden="true">✚</span>
          <div><strong>Healthia</strong><small>{isPatient ? 'Espacio del paciente · vista preliminar' : 'Entorno médico · PHOENIX'}</small></div>
        </div>
        <div className={css.actions}>
          <button className={role === 'doctor' ? css.selected : css.action} type="button" onClick={() => onRoleChange('doctor')} aria-pressed={role === 'doctor'}>Médico</button>
          <button className={role === 'patient' ? css.selected : css.action} type="button" onClick={() => onRoleChange('patient')} aria-pressed={role === 'patient'}>Paciente</button>
          <button className={css.action} type="button" onClick={onReturn}>Volver a PHOENIX</button>
        </div>
      </div>
      <div className={css.body}>
        <div className={css.titleRow}>
          <div><span className={css.eyebrow}>PHOENIX / HEALTHIA</span><h2>{HEALTHIA_NAV[role].find(item => item.id === active)?.label}</h2></div>
          <span className={css.status}>{isPatient ? 'Portal no activado' : 'Backend clínico separado'}</span>
        </div>
        <nav className={css.tabs} aria-label="Secciones Healthia">
          {HEALTHIA_NAV[role].map(item => <button key={item.id} type="button" aria-current={item.id === active ? 'page' : undefined} className={item.id === active ? css.activeTab : css.tab} onClick={() => onSectionChange(item.id)}>{item.label}</button>)}
        </nav>
        {active === 'forms' && !isPatient ? (
          <div className={css.formPreview}>
            <p><strong>Editor adaptable · solo estructura.</strong> Campos, destinos y formatos configurables sin ejecutar código ni enviar datos clínicos. Los cambios están en memoria y requieren un publicador clínico autorizado para ser persistentes.</p>
            <div className={css.draftHeader}><span>Plantilla de consulta · revisión {draft.revision}</span>
              <button type="button" className={css.action} disabled={history.length === 0} onClick={undo}>Deshacer cambio</button>
            </div>
            <div className={css.fieldList}>
              {draft.fields.map(field => (
                <div key={field.id} className={css.fieldRow}>
                  <span><strong>{field.label}</strong><small>{field.kind} · {field.binding.destination.toUpperCase()} → {field.binding.output} · {isBindingConnected(field.binding, capabilities) ? 'Vista local' : 'Conector pendiente'}</small></span>
                  {field.protected ? <span className={css.locked}>Protegido</span> : <button type="button" className={css.removeField} aria-label={`Quitar campo ${field.label}`} onClick={() => removeField(field.id)}>×</button>}
                </div>
              ))}
            </div>
            <form className={css.builder} onSubmit={addField}>
              <input maxLength={60} aria-label="Etiqueta de nuevo campo" value={fieldLabel} onChange={e => setFieldLabel(e.target.value)} placeholder="Nombre del campo" />
              <label className={css.formSelect}>Tipo
                <select aria-label="Tipo de campo" value={kind} onChange={e => setKind(e.currentTarget.value as AdaptiveInputKind)}>
                  <option value="text">Texto</option><option value="number">Número</option><option value="date">Fecha</option><option value="select">Selector</option><option value="textarea">Texto extenso</option>
                </select>
              </label>
              <label className={css.formSelect}>Acción
                <select aria-label="Destino de campo" value={destination} onChange={e => setDestination(e.currentTarget.value as AdaptiveDestination)}>
                  <option value="local">Local</option><option value="api">API autorizada (pendiente)</option><option value="chat">Chat (pendiente)</option><option value="ai">IA (pendiente)</option>
                </select>
              </label>
              <label className={css.formSelect}>Salida
                <select aria-label="Formato de salida" value={output} onChange={e => setOutput(e.currentTarget.value as AdaptiveOutput)}>
                  <option value="inline">En pantalla</option><option value="table">Tabla</option><option value="document">Documento</option><option value="chat">Chat</option>
                </select>
              </label>
              <button type="submit" disabled={!fieldLabel.trim()}>Agregar campo</button>
            </form>
            {draftError && <p role="alert">{draftError}</p>}
            <p className={css.notice}>Las conexiones API, Chat e IA son propuestas declarativas: ejecutar, almacenar, compartir o publicar requiere permisos y un adaptador validado.</p>
          </div>
        ) : active === 'capabilities' ? (
          <div className={css.capabilityList}>
            <p>Autoconocimiento declarativo: las funciones se anuncian en un catálogo limitado, sin revelar contraseñas ni considerar conectadas las API por el mero hecho de existir.</p>
            {liveStatus && <>
              <p><strong>Componentes observados en este PHOENIX</strong> · registro real de vistas, no autorización para usar datos o servicios.</p>
              {liveStatus.slots.map(slot => (
                <div className={css.fieldRow} key={slot.id}>
                  <span><strong>{slot.id}</strong><small>Registro de interfaz · {slot.registrations} instancia(s)</small></span>
                  <span className={css.status}>{slot.state === 'registered' ? 'Registrado' : 'No encontrado'}</span>
                </div>
              ))}
            </>}
            {capabilities.map(capability => (
              <div className={css.fieldRow} key={capability.id}>
                <span><strong>{capability.label}</strong><small>{capability.explanation}</small></span>
                <span className={css.status}>{capability.state === 'ui-ready' ? 'Interfaz lista' : capability.state === 'requires-authentication' ? 'Requiere acceso' : capability.state === 'disabled' ? 'Deshabilitado' : 'Sin conectar'}</span>
              </div>
            ))}
          </div>
        ) : active === 'exchange' || (active === 'consent' && isPatient) ? (
          <div className={css.exchange}>
            <p><strong>Intercambio futuro, con aprobación explícita.</strong> Solicitud → autenticación del destinatario → revisión de alcance → consentimiento/autorización → entrega cifrada → comprobante y revocación.</p>
            <p>Salidas previstas: resumen clínico, recursos FHIR R4 y documentos autorizados. Ningún expediente se comparte desde esta vista.</p>
          </div>
        ) : (
          <p className={css.description}>{CLINICAL_DESCRIPTIONS[active] ?? CLINICAL_DESCRIPTIONS.overview}</p>
        )}
        <div className={css.footer}>
          {!isPatient && <a className={css.openClinical} href="/health" target="_blank" rel="noopener noreferrer">Abrir servicio clínico protegido ↗</a>}
          {isPatient && <span className={css.notice}>El acceso del paciente requiere identidad autenticada y permisos; no se ha habilitado aquí.</span>}
          <span className={css.chatHint}>Kira y el chat continúan disponibles debajo.</span>
        </div>
      </div>
    </section>
  )
}
