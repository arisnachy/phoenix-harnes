/** On-demand academic title-page editor. An image preview is not a file upload to the host. */
import { useEffect, useState } from 'react'
import css from './AcademicCoverEditor.module.css'

export interface AcademicCoverDraft {
  title: string
  institution: string
  faculty: string
  degree: string
  course: string
  advisor: string
  authors: string
  city: string
  citation: 'apa7' | 'vancouver' | 'scientific_article'
  logoName?: string
}
/**
 * Draft the academic request without disclosing a preview-only image as an uploaded asset.
 * @param draft - only user-entered institutional information.
 * @returns text for Kira's existing unsent composer.
 */
export function academicCoverPrompt(draft: AcademicCoverDraft): string {
  const names = draft.authors.split('\n').map(value => value.trim()).filter(Boolean).slice(0, 30)
  const description = draft.citation === 'scientific_article'
    ? 'artículo científico (acordar aparte su estilo de citación y revista)'
    : draft.citation === 'vancouver' ? 'investigación Vancouver' : 'investigación APA 7'
  const parts = [
    'Kira, prepara una ' + description + ' con portada personalizada y un documento profesional.',
    'Título: ' + (draft.title.trim() || 'proponer según mi tema'),
    'Institución: ' + (draft.institution.trim() || 'por confirmar'),
    draft.faculty.trim() ? 'Facultad/departamento: ' + draft.faculty.trim() : '',
    draft.degree.trim() ? 'Programa: ' + draft.degree.trim() : '',
    draft.course.trim() ? 'Asignatura: ' + draft.course.trim() : '',
    draft.advisor.trim() ? 'Profesor o asesor: ' + draft.advisor.trim() : '',
    names.length ? 'Participantes (nombre | matrícula/ID, si corresponde):\n' + names.join('\n') : 'Solicita participantes.',
    draft.city.trim() ? 'Ciudad y país: ' + draft.city.trim() : '',
    draft.logoName ? 'El logo ' + draft.logoName + ' fue seleccionado SOLO para previsualización; pídeme que lo adjunte al chat antes de incluirlo en PDF/DOCX.' : '',
    'Usa phoenix_research_plan; verifica las referencias científicas; aplica reglas del manual institucional si se adjunta; genera archivos DOCX y PDF reales y comprueba páginas. Nunca inventes resultados.',
  ]
  return parts.filter(Boolean).join('\n')
}

/** Contained visual preview and academic form; never transmits data until the user submits the draft. */
export function AcademicCoverEditor({ onUse, onClose }: {
  onUse: (draft: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<AcademicCoverDraft>({
    title: '', institution: '', faculty: '', degree: '', course: '', advisor: '',
    authors: '', city: '', citation: 'apa7',
  })
  const [previewUrl, setPreviewUrl] = useState<string | undefined>()
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  const change = (key: keyof AcademicCoverDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value }))
  }
  return (
    <section className={css.editor} aria-label="Editor de portada académica">
      <div className={css.heading}>
        <strong>Portada de investigación</strong>
        <button type="button" onClick={onClose} aria-label="Cerrar editor de portada">×</button>
      </div>
      <div className={css.columns}>
        <div className={css.fields}>
          <label>Formato
            <select value={draft.citation} onChange={(event) => { change('citation', event.target.value) }}>
              <option value="apa7">APA 7</option>
              <option value="vancouver">Vancouver</option>
              <option value="scientific_article">Artículo científico</option>
            </select>
          </label>
          <label>Título<input value={draft.title} maxLength={240} placeholder="Tema de investigación" onChange={(event) => { change('title', event.target.value) }} /></label>
          <label>Universidad<input value={draft.institution} maxLength={200} placeholder="Institución" onChange={(event) => { change('institution', event.target.value) }} /></label>
          <label>Facultad<input value={draft.faculty} maxLength={180} onChange={(event) => { change('faculty', event.target.value) }} /></label>
          <label>Programa<input value={draft.degree} maxLength={180} onChange={(event) => { change('degree', event.target.value) }} /></label>
          <label>Asignatura<input value={draft.course} maxLength={180} onChange={(event) => { change('course', event.target.value) }} /></label>
          <label>Asesor o docente<input value={draft.advisor} maxLength={180} onChange={(event) => { change('advisor', event.target.value) }} /></label>
          <label>Participantes (uno por línea; nombre | matrícula o ID)
            <textarea value={draft.authors} maxLength={1200} rows={3} placeholder="Ana Pérez | 2026-001" onChange={(event) => { change('authors', event.target.value) }} />
          </label>
          <label>Ciudad y país<input value={draft.city} maxLength={160} onChange={(event) => { change('city', event.target.value) }} /></label>
          <label>Vista previa de logo
            <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file || file.size > 3_000_000) return
              if (previewUrl) URL.revokeObjectURL(previewUrl)
              setPreviewUrl(URL.createObjectURL(file))
              change('logoName', file.name)
            }} />
          </label>
          <small>El logo se muestra solo aquí. Para incluirlo en el informe, adjúntalo también al chat.</small>
        </div>
        <div className={css.preview} aria-label="Vista previa de la hoja de presentación">
          {previewUrl ? <img className={css.logo} src={previewUrl} alt="Logo institucional seleccionado" /> : <span className={css.logoPlaceholder}>LOGO</span>}
          <strong>{draft.institution || 'Nombre de universidad'}</strong>
          <span>{draft.faculty || 'Facultad / departamento'}</span>
          <span>{draft.degree || 'Programa académico'}</span>
          <h3>{draft.title || 'Título de la investigación'}</h3>
          <div>{draft.authors.trim() || 'Participantes y matrículas'}</div>
          <span>{draft.advisor || 'Profesor / asesor'}</span>
          <span>{draft.city || 'Ciudad y país'}</span>
        </div>
      </div>
      <div className={css.actions}>
        <button type="button" onClick={onClose}>Cancelar</button>
        <button type="button" onClick={() => { onUse(academicCoverPrompt(draft)) }}>Usar datos en el chat</button>
      </div>
    </section>
  )
}
