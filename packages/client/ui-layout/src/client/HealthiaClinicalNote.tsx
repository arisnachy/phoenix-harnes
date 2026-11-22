/**
 * Native encounter-note composer, adapted from the legacy Healthia intake,
 * antecedentes, signos vitales and enfermedad-actual workflows.
 *
 * Privacy: clinical values are held only in React memory; no storage, network,
 * chat event, telemetry, model call, or implied clinical signature occurs here.
 * Only an authenticated Host-owned clinical repository may persist records.
 */
import { useMemo, useState, type FormEvent } from 'react'
import css from './HealthiaClinicalNote.module.css'

export type ClinicalNoteKind = 'first' | 'followup' | 'soap' | 'pediatric' | 'obstetric'
export type ClinicalNoteValues = Record<string, string>
export type ClinicalNoteField = {
  readonly id: string
  readonly label: string
  readonly kind?: 'textarea' | 'number' | 'date'
  readonly maxLength?: number
  readonly unit?: string
  readonly for?: readonly ClinicalNoteKind[]
}
export type ClinicalNoteSection = {
  readonly id: string
  readonly label: string
  readonly fields: readonly ClinicalNoteField[]
}

export const NOTE_KINDS: readonly { value: ClinicalNoteKind; label: string }[] = [
  { value: 'first', label: 'Primera consulta' },
  { value: 'followup', label: 'Evolución' },
  { value: 'soap', label: 'SOAP' },
  { value: 'pediatric', label: 'Pediatría' },
  { value: 'obstetric', label: 'Ginecología / obstetricia' },
]

const VITAL_FIELDS: readonly ClinicalNoteField[] = [
  { id: 'sys', label: 'Presión sistólica', kind: 'number', unit: 'mmHg' },
  { id: 'dia', label: 'Presión diastólica', kind: 'number', unit: 'mmHg' },
  { id: 'hr', label: 'Frecuencia cardíaca', kind: 'number', unit: 'lpm' },
  { id: 'rr', label: 'Frecuencia respiratoria', kind: 'number', unit: 'rpm' },
  { id: 'temp', label: 'Temperatura', kind: 'number', unit: '°C' },
  { id: 'sat', label: 'Saturación de oxígeno', kind: 'number', unit: '%' },
  { id: 'weight', label: 'Peso', kind: 'number', unit: 'kg' },
  { id: 'height', label: 'Talla', kind: 'number', unit: 'cm' },
]

/** Stable, typed field IDs. Blank means unknown, NEVER absent or negative. */
export const CLINICAL_NOTE_SECTIONS: readonly ClinicalNoteSection[] = [
  { id: 'interview', label: 'Entrevista', fields: [
    { id: 'date', label: 'Fecha de consulta', kind: 'date' },
    { id: 'chief', label: 'Motivo de consulta', maxLength: 400 },
    { id: 'hea', label: 'Historia de la enfermedad actual', kind: 'textarea', maxLength: 4500 },
    { id: 'ros', label: 'Revisión por sistemas', kind: 'textarea', maxLength: 1800 },
  ] },
  { id: 'background', label: 'Antecedentes', fields: [
    { id: 'personal', label: 'Antecedentes personales patológicos', kind: 'textarea' },
    { id: 'surgical', label: 'Quirúrgicos y hospitalizaciones', kind: 'textarea' },
    { id: 'family', label: 'Heredofamiliares', kind: 'textarea' },
    { id: 'habits', label: 'Hábitos y contexto social', kind: 'textarea' },
    { id: 'allergies', label: 'Alergias declaradas', kind: 'textarea' },
    { id: 'medications', label: 'Tratamiento habitual', kind: 'textarea' },
    { id: 'perinatal', label: 'Antecedentes perinatales y desarrollo', kind: 'textarea', for: ['pediatric'] },
    { id: 'gyneco', label: 'Antecedentes gineco-obstétricos', kind: 'textarea', for: ['obstetric'] },
    { id: 'fum', label: 'FUM (si se conoce)', kind: 'date', for: ['obstetric'] },
  ] },
  { id: 'exam', label: 'Exploración', fields: [
    ...VITAL_FIELDS,
    { id: 'physical', label: 'Examen físico por sistemas', kind: 'textarea', maxLength: 3500 },
    { id: 'findings', label: 'Resultados clínicos relevantes', kind: 'textarea' },
  ] },
  { id: 'plan', label: 'Evaluación y plan', fields: [
    { id: 'assessment', label: 'Impresión clínica y razonamiento', kind: 'textarea', maxLength: 3500 },
    { id: 'differential', label: 'Diagnósticos diferenciales o incertidumbres', kind: 'textarea' },
    { id: 'icd10', label: 'CIE-10 sugerido (requiere verificación)' },
    { id: 'plan', label: 'Tratamiento e indicaciones', kind: 'textarea', maxLength: 3500 },
    { id: 'tests', label: 'Estudios solicitados', kind: 'textarea' },
    { id: 'followup', label: 'Seguimiento y signos de alarma', kind: 'textarea' },
  ] },
]

export function fieldsForKind(section: ClinicalNoteSection, kind: ClinicalNoteKind): readonly ClinicalNoteField[] {
  return section.fields.filter(field => field.for === undefined || field.for.includes(kind))
}

function safeValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function describeVital(field: ClinicalNoteField, value: string): string {
  if (!value || !Number.isFinite(Number(value))) return ''
  return `${field.label}: ${value}${field.unit ? ' ' + field.unit : ''}`
}

export function clinicalBmi(values: Readonly<ClinicalNoteValues>): number | undefined {
  const kg = Number(values.weight)
  const cm = Number(values.height)
  if (!safeValue(values.weight) || !safeValue(values.height)
    || !Number.isFinite(kg) || !Number.isFinite(cm)
    || kg <= 0 || cm <= 0 || kg > 1000 || cm > 300) return undefined
  const calculated = kg / Math.pow(cm / 100, 2)
  return Math.round(calculated * 10) / 10
}

/** Pure draft composition: never invent facts, negatives, normal findings or signatures. */
export function formatClinicalNote(kind: ClinicalNoteKind, values: Readonly<ClinicalNoteValues>): string {
  const title = NOTE_KINDS.find(item => item.value === kind)?.label ?? 'Consulta'
  const lines: string[] = [title + ' · BORRADOR SIN FIRMAR']
  for (const section of CLINICAL_NOTE_SECTIONS) {
    const parts = fieldsForKind(section, kind).flatMap(field => {
      const value = safeValue(values[field.id])
      if (!value) return []
      if (field.kind === 'number') {
        const description = describeVital(field, value)
        return description ? [description] : []
      }
      return [`${field.label}: ${value}`]
    })
    if (section.id === 'exam') {
      const bmi = clinicalBmi(values)
      if (bmi !== undefined) parts.push(`IMC calculado: ${bmi} kg/m²`)
    }
    if (parts.length > 0) lines.push('', section.label.toUpperCase(), ...parts)
  }
  lines.push('', 'Pendiente de revisión, vinculación al paciente y firma profesional.')
  return lines.join('\n')
}

/** Native local-only draft; persistence requires a separate authenticated Host bridge. */
export function HealthiaClinicalNote({ onReturn }: { onReturn?: () => void }) {
  const [kind, setKind] = useState<ClinicalNoteKind>('first')
  const [values, setValues] = useState<ClinicalNoteValues>({})
  const [section, setSection] = useState('interview')
  const [preview, setPreview] = useState(false)
  const [message, setMessage] = useState('')
  const note = useMemo(() => formatClinicalNote(kind, values), [kind, values])
  const hasContent = Object.values(values).some(value => value.trim().length > 0)
  const current = CLINICAL_NOTE_SECTIONS.find(item => item.id === section) ?? CLINICAL_NOTE_SECTIONS[0]!
  const edit = (id: string, value: string): void => {
    setValues(previous => ({ ...previous, [id]: value }))
    setMessage('')
  }
  const reset = (): void => {
    setValues({})
    setPreview(false)
    setSection('interview')
    setMessage('Borrador descartado de esta sesión.')
  }
  const copy = async (): Promise<void> => {
    if (!hasContent) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(note)
      setMessage('Borrador copiado por solicitud del profesional. No se ha guardado en el expediente.')
    } catch {
      setMessage('No fue posible copiar el borrador. Puedes seleccionar la vista previa.')
    }
  }
  const showPreview = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setPreview(true)
  }
  return (
    <section className={css.root} aria-label="Historia clínica estructurada">
      <div className={css.top}>
        <div>
          <span className={css.eyebrow}>CONSULTA · BORRADOR LOCAL TEMPORAL</span>
          <h3>Historia clínica</h3>
          <p>La información permanece en esta vista hasta cerrarla. No hay guardado ni firma clínica habilitados desde este editor.</p>
        </div>
        {onReturn && <button type="button" className={css.secondary} onClick={onReturn}>Volver</button>}
      </div>
      <form onSubmit={showPreview} autoComplete="off">
        <label className={css.noteKind}>Tipo de consulta
          <select value={kind} onChange={event => { setKind(event.currentTarget.value as ClinicalNoteKind); setPreview(false) }} aria-label="Tipo de consulta">
            {NOTE_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className={css.steps} role="group" aria-label="Secciones de historia clínica">
          {CLINICAL_NOTE_SECTIONS.map(item => (
            <button key={item.id} type="button" className={item.id === section ? css.stepActive : css.step}
              aria-pressed={item.id === section} onClick={() => { setSection(item.id); setPreview(false) }}>
              {item.label}
            </button>
          ))}
        </div>
        <div className={css.fields}>
          {fieldsForKind(current, kind).map(field => (
            <label key={field.id} className={field.kind === 'textarea' ? css.wideField : css.field}>
              <span>{field.label}{field.unit ? ` · ${field.unit}` : ''}</span>
              {field.kind === 'textarea' ? (
                <textarea rows={3} maxLength={field.maxLength ?? 1800} value={values[field.id] ?? ''}
                  onChange={event => edit(field.id, event.currentTarget.value)} />
              ) : (
                <input type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
                  maxLength={field.kind === 'number' || field.kind === 'date' ? undefined : (field.maxLength ?? 400)}
                  step={field.kind === 'number' ? 'any' : undefined}
                  value={values[field.id] ?? ''} onChange={event => edit(field.id, event.currentTarget.value)} />
              )}
            </label>
          ))}
        </div>
        <div className={css.actions}>
          <button type="submit" className={css.primary} disabled={!hasContent}>Vista previa de nota</button>
          <button type="button" className={css.secondary} onClick={reset} disabled={!hasContent}>Descartar borrador</button>
        </div>
      </form>
      {preview && hasContent && (
        <section className={css.preview} aria-label="Vista previa clínica">
          <div className={css.previewHeader}>
            <strong>Nota generada · sin firmar</strong>
            <button type="button" className={css.secondary} onClick={() => { void copy() }}>Copiar borrador</button>
          </div>
          <pre>{note}</pre>
        </section>
      )}
      {message && <p role="status" className={css.status}>{message}</p>}
      <p className={css.disclaimer}>Los datos no registrados permanecen desconocidos. Las inferencias y códigos deben ser revisados por el profesional antes de incorporarlos al expediente protegido.</p>
    </section>
  )
}
