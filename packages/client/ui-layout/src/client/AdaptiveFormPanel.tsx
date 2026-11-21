import { useEffect, useState } from 'react'
import {
  addAdaptiveField, removeAdaptiveField,
  type AdaptiveDestination, type AdaptiveInputKind, type AdaptiveOutput, type AdaptiveFormDraft,
} from './AdaptiveAppCatalog.ts'
import { readAdaptiveForm, saveAdaptiveForm } from './AdaptiveFormMetadataStore.ts'
import css from './HealthiaWorkspace.module.css'

/**
 * Generic app form editor and LOCAL ephemeral preview.
 * Clinical field VALUES must never be entered here. No API, chat,
 * model call or data persistence happens from values in this component.
 */
export function AdaptiveFormPanel({ appId, sectionId }: { appId: string; sectionId: string }) {
  const [form, setForm] = useState<AdaptiveFormDraft>(() => readAdaptiveForm(appId, sectionId) ?? {
    version: 1, appId, templateId: sectionId, revision: 0, state: 'local-draft', fields: [],
  })
  const [history, setHistory] = useState<readonly AdaptiveFormDraft[]>([])
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<AdaptiveInputKind>('text')
  const [destination, setDestination] = useState<AdaptiveDestination>('local')
  const [output, setOutput] = useState<AdaptiveOutput>('inline')
  const [values, setValues] = useState<Record<string, string>>({})
  const [reviewFieldId, setReviewFieldId] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Refresh only metadata after an explicit chat-card approval.
  useEffect(() => {
    const onRefresh = (event: Event): void => {
      const detail = (event as CustomEvent<{ appId?: string; sectionId?: string }>).detail
      if (detail?.appId !== appId || detail?.sectionId !== sectionId) return
      const revised = readAdaptiveForm(appId, sectionId)
      if (!revised) return
      setForm(revised)
      setHistory([])
      setValues({})
      setReviewFieldId(null)
      setError('')
    }
    window.addEventListener('phoenix:adaptive-form-refreshed', onRefresh)
    return () => window.removeEventListener('phoenix:adaptive-form-refreshed', onRefresh)
  }, [appId, sectionId])
  const commit = (next: AdaptiveFormDraft): void => {
    try {
      saveAdaptiveForm(next)
      setHistory(items => [...items.slice(-19), form])
      setForm(next)
      setError('')
    } catch {
      setError('No fue posible guardar el esquema. El formulario anterior permanece intacto.')
    }
  }
  const undo = (): void => {
    const previous = history.at(-1)
    if (!previous) return
    try {
      // Rollback creates a new revision instead of mutating old persisted history.
      const reverted = { ...previous, revision: form.revision + 1 }
      saveAdaptiveForm(reverted)
      setForm(reverted)
      setHistory(items => items.slice(0, -1))
      setError('')
    } catch { setError('No fue posible restaurar el esquema anterior.') }
  }

  return <div className={css.formPreview}>
    <div className={css.draftHeader}>
      <strong>Formulario de {sectionId} · revisión {form.revision}</strong>
      <div className={css.actions}>
        <button className={css.action} type="button" onClick={() => window.dispatchEvent(
          new CustomEvent('phoenix:adaptive-form-mission', { detail: { appId, sectionId } }),
        )}>Configurar con Kira</button>
        <button className={css.action} type="button" onClick={() => window.dispatchEvent(
          new CustomEvent('phoenix:adaptive-form-inspect', { detail: {
            appId, sectionId, revision: form.revision,
            fields: form.fields.map(field => ({
              id: field.id, label: field.label, kind: field.kind,
              destination: field.binding.destination, output: field.binding.output,
            })),
          } }),
        )}>Compartir estructura con Kira</button>
        <button className={css.action} type="button" disabled={!history.length} onClick={undo}>Deshacer</button>
      </div>
    </div>
    <p>Personaliza entradas y salidas. Solo el esquema se guarda en este navegador; los valores permanecen temporalmente en memoria.</p>
    <div className={css.fieldList}>
      {form.fields.map(field => <div key={field.id} className={css.fieldRow}>
        <span><strong>{field.label}</strong><small>{field.kind} · {field.binding.destination.toUpperCase()} → {field.binding.output}{field.binding.destination !== 'local' ? ' · pendiente de autorización' : ''}</small></span>
        <button className={css.removeField} type="button" aria-label={`Quitar campo ${field.label}`}
          onClick={() => {
            try { commit(removeAdaptiveField(form, field.id)) }
            catch { setError('No se puede eliminar ese campo.') }
          }}>×</button>
      </div>)}
    </div>
    <form className={css.builder} onSubmit={event => {
      event.preventDefault()
      try {
        const next = addAdaptiveField(form, { label: label.trim(), kind, destination, output })
        commit(next)
        setLabel('')
      } catch { setError('Introduce un nombre único y un tipo de entrada permitido.') }
    }}>
      <input value={label} onChange={event => setLabel(event.currentTarget.value)}
        aria-label="Nombre del nuevo campo" placeholder="Nombre del campo" maxLength={60}/>
      <label className={css.formSelect}>Entrada
        <select value={kind} aria-label="Tipo de entrada" onChange={event => setKind(event.currentTarget.value as AdaptiveInputKind)}>
          <option value="text">Texto</option><option value="number">Número</option><option value="date">Fecha</option>
          <option value="textarea">Texto extenso</option><option value="select">Lista</option>
        </select>
      </label>
      <label className={css.formSelect}>Conectar a
        <select value={destination} aria-label="Destino configurado" onChange={event => setDestination(event.currentTarget.value as AdaptiveDestination)}>
          <option value="local">Local</option><option value="api">API (requiere conector)</option>
          <option value="chat">Chat (requiere autorización)</option><option value="ai">IA (requiere autorización)</option>
        </select>
      </label>
      <label className={css.formSelect}>Resultado
        <select value={output} aria-label="Tipo de salida" onChange={event => setOutput(event.currentTarget.value as AdaptiveOutput)}>
          <option value="inline">Vista</option><option value="table">Tabla</option>
          <option value="document">Documento</option><option value="chat">Chat</option>
        </select>
      </label>
      <button type="submit" disabled={!label.trim()}>Añadir campo</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {form.fields.length > 0 && <div className={css.formPreview}>
      <h3>Vista operativa local</h3>
      {form.fields.map(field => <div key={field.id} className={css.formSelect}>
        <label htmlFor={`adaptive-value-${field.id}`}>{field.label}</label>
        {field.kind === 'textarea'
          ? <textarea id={`adaptive-value-${field.id}`} maxLength={400} rows={2}
            value={values[field.id] ?? ''} onChange={event => { const value = event.currentTarget.value; setValues(old => ({ ...old, [field.id]: value })) }}/>
          : field.kind === 'select'
            ? <select id={`adaptive-value-${field.id}`} disabled><option>Configura opciones con Kira</option></select>
            : <input id={`adaptive-value-${field.id}`} type={field.kind} maxLength={400}
                value={values[field.id] ?? ''} onChange={event => { const value = event.currentTarget.value; setValues(old => ({ ...old, [field.id]: value })) }}/>}
      </div>)}
      <div className={css.fieldList} aria-label="Salidas en pantalla">
        {form.fields.filter(field => field.binding.destination === 'local' && values[field.id]).map(field =>
          <div key={field.id} className={css.fieldRow}>
            <strong>{field.label}</strong><span>{values[field.id]}</span>
          </div>)}
      </div>
      <div className={css.fieldList} aria-label="Revisar acciones configuradas">
        {form.fields.filter(field => field.binding.destination !== 'local' && Boolean(values[field.id])).map(field => (
          <div key={field.id} className={css.fieldRow}>
            <span><strong>{field.label}</strong><small>{field.binding.destination.toUpperCase()} · acción pendiente de autorización y confirmación</small></span>
            <button type="button" className={css.action} onClick={() => setReviewFieldId(field.id)}>
              Revisar con Kira
            </button>
          </div>
        ))}
      </div>
      {reviewFieldId && (() => {
        const field = form.fields.find(item => item.id === reviewFieldId)
        if (!field || field.binding.destination === 'local' || !values[field.id]) return null
        return <div className={css.exchange} aria-label="Confirmación antes de compartir entrada">
          <p><strong>Antes de compartir:</strong> revisa este valor. No incluyas datos de pacientes, contraseñas ni información confidencial: se copiará al borrador del chat y podrás decidir si enviarlo.</p>
          <p><strong>{field.label}:</strong> {values[field.id]}</p>
          <div className={css.actions}>
            <button type="button" className={css.action} onClick={() => setReviewFieldId(null)}>Cancelar</button>
            <button type="button" className={css.action} onClick={() => {
              window.dispatchEvent(new CustomEvent('phoenix:adaptive-form-action-draft', {
                detail: {
                  appId, sectionId, fieldId:field.id, fieldLabel:field.label,
                  destination:field.binding.destination, output:field.binding.output,
                  value:values[field.id],
                },
              }))
              setReviewFieldId(null)
            }}>Copiar al borrador de Kira</button>
          </div>
        </div>
      })()}
      <p className={css.notice}>Los valores de prueba son temporales. Solo al confirmar se copia un valor concreto al borrador del chat; PHOENIX no lo envía automáticamente ni ejecuta conectores.</p>
    </div>}
  </div>
}
