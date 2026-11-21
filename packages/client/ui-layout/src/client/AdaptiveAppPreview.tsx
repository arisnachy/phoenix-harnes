import { useState } from 'react'
import type { AdaptiveAppBlueprint } from './AdaptiveAppCatalog.ts'
import { addAdaptiveField, type AdaptiveFormDraft } from './AdaptiveAppCatalog.ts'
import css from './HealthiaWorkspace.module.css'

/** Generic blueprint surface: layout/forms preview only, no connector or server access. */
export function AdaptiveAppPreview({
  app, section, onSectionChange, onReturn,
}: {
  app: AdaptiveAppBlueprint
  section: string
  onSectionChange: (section: string) => void
  onReturn: () => void
}) {
  const active = app.sections.find(item => item.id === section) ?? app.sections[0]
  const [fieldName, setFieldName] = useState('')
  const [form, setForm] = useState<AdaptiveFormDraft>(() => ({
    version: 1, appId: app.id, templateId: 'default', revision: 0,
    state: 'local-draft', fields: [],
  }))
  const [history, setHistory] = useState<readonly AdaptiveFormDraft[]>([])
  const [error, setError] = useState('')
  return <section className={css.shell} aria-label={`Aplicación adaptable: ${app.title}`}>
    <div className={css.header}>
      <div className={css.identity}><span className={css.symbol} aria-hidden="true">▦</span><div><strong>{app.title}</strong><small>Aplicación generada · solo vista preliminar</small></div></div>
      <button className={css.action} type="button" onClick={onReturn}>Volver a PHOENIX</button>
    </div>
    <div className={css.body}>
      <div className={css.titleRow}><div><span className={css.eyebrow}>PHOENIX / APP STUDIO</span><h2>{active?.label ?? app.title}</h2></div><span className={css.status}>Sin backend</span></div>
      <nav className={css.tabs} aria-label="Secciones de la aplicación">
        {app.sections.map(item => <button key={item.id} type="button" aria-current={item.id === active?.id ? 'page' : undefined}
          className={item.id === active?.id ? css.activeTab : css.tab} onClick={() => onSectionChange(item.id)}>{item.label}</button>)}
      </nav>
      <p className={css.description}>Los menús y el esquema de campos se generan desde un manifiesto validado. Ninguna acción API/IA ni almacenamiento se activa automáticamente.</p>
      <div className={css.draftHeader}><span>Campos configurados · revisión {form.revision}</span><button className={css.action} type="button" disabled={!history.length}
        onClick={() => { const prev = history.at(-1); if (prev) { setForm(prev); setHistory(items => items.slice(0, -1)); setError('') } }}>Deshacer</button></div>
      <div className={css.fieldList}>{form.fields.map(field => <div key={field.id} className={css.fieldRow}><strong>{field.label}</strong><span className={css.locked}>Borrador local</span></div>)}</div>
      <form className={css.builder} onSubmit={event => {
        event.preventDefault()
        try {
          const next = addAdaptiveField(form, { label: fieldName.trim(), kind: 'text', destination: 'local', output: 'inline' })
          setHistory(items => [...items.slice(-19), form]); setForm(next); setFieldName(''); setError('')
        } catch { setError('Revisa el nombre del campo: debe ser único y válido.') }
      }}>
        <input aria-label="Nombre de campo configurable" maxLength={60} placeholder="Agregar campo a la app" value={fieldName} onChange={event => setFieldName(event.target.value)}/>
        <button type="submit" disabled={!fieldName.trim()}>Agregar campo</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div className={css.footer}><span className={css.notice}>Vista temporal. Para hacerla operativa hace falta almacenamiento, adaptadores y permisos.</span><span className={css.chatHint}>Kira sigue disponible en el chat inferior.</span></div>
    </div>
  </section>
}
