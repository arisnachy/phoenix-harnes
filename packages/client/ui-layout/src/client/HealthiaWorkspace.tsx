/** Healthia adaptive workspace. Never handles patient-identifiable form values. */
import { useState } from 'react'
import css from './HealthiaWorkspace.module.css'

export type HealthiaRole = 'doctor' | 'patient'

export const HEALTHIA_NAV: Record<HealthiaRole, readonly { id: string; label: string }[]> = {
  doctor: [
    { id: 'overview', label: 'Inicio clínico' },
    { id: 'patients', label: 'Pacientes' },
    { id: 'encounters', label: 'Consultas' },
    { id: 'records', label: 'Historia clínica' },
    { id: 'prescriptions', label: 'Recetas e informes' },
    { id: 'forms', label: 'Formularios' },
    { id: 'exchange', label: 'Intercambios' },
  ],
  patient: [
    { id: 'overview', label: 'Mi espacio' },
    { id: 'appointments', label: 'Citas' },
    { id: 'records', label: 'Mi expediente' },
    { id: 'documents', label: 'Documentos' },
    { id: 'consent', label: 'Autorizaciones' },
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
  role, section, onRoleChange, onSectionChange, onReturn,
}: {
  role: HealthiaRole
  section: string
  onRoleChange: (role: HealthiaRole) => void
  onSectionChange: (section: string) => void
  onReturn: () => void
}) {
  // Configuration draft only: NO patient data, persistence, API call or model context.
  const [fieldLabel, setFieldLabel] = useState('')
  const [fields, setFields] = useState<readonly string[]>(['Motivo de consulta', 'Antecedentes', 'Signos vitales'])
  const active = HEALTHIA_NAV[role].some(item => item.id === section) ? section : 'overview'
  const isPatient = role === 'patient'

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
        {active === 'forms' && !isPatient ? (
          <div className={css.formPreview}>
            <p>Editor preliminar de estructura de formularios. No introducir información de pacientes: estos campos no se publican ni almacenan todavía.</p>
            <div className={css.chips}>{fields.map((field, i) => <span key={i} className={css.chip}>{field}<button type="button" aria-label={`Quitar campo ${field}`} onClick={() => setFields(items => items.filter((_, index) => index !== i))}>×</button></span>)}</div>
            <form className={css.builder} onSubmit={event => { event.preventDefault(); const label = fieldLabel.trim(); if (label && label.length <= 60 && !fields.includes(label)) setFields(items => [...items, label]); setFieldLabel('') }}>
              <input maxLength={60} aria-label="Etiqueta de nuevo campo" value={fieldLabel} onChange={e => setFieldLabel(e.target.value)} placeholder="Nombre de nuevo campo" />
              <button type="submit" disabled={!fieldLabel.trim()}>Agregar campo</button>
            </form>
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
