import type { AdaptiveAppBlueprint } from './AdaptiveAppCatalog.ts'
import type { AdaptivePalette } from './AdaptiveWorkspaceControl.ts'
import { AdaptiveFormPanel } from './AdaptiveFormPanel.tsx'
import { AdaptiveVisualStudio } from './AdaptiveVisualStudio.tsx'
import css from './HealthiaWorkspace.module.css'

/** Reusable app panel; no model or executable code is run in this component. */
export function AdaptiveAppPreview({
  app, section, onSectionChange, onReturn, palette = 'pearl',
}: {
  app: AdaptiveAppBlueprint
  palette?: AdaptivePalette
  section: string
  onSectionChange: (section: string) => void
  onReturn: () => void
}) {
  const active = app.sections.find(item => item.id === section) ?? app.sections[0]
  return <section className={css.shell} data-app-palette={palette} aria-label={`Aplicación adaptable: ${app.title}`}>
    <div className={css.header}>
      <div className={css.identity}><span className={css.symbol} aria-hidden="true">▦</span><div><strong>{app.title}</strong><small>Espacio adaptativo · esquema local</small></div></div>
      <button className={css.action} type="button" onClick={onReturn}>Volver a PHOENIX</button>
    </div>
    <div className={css.body}>
      <div className={css.titleRow}><div><span className={css.eyebrow}>PHOENIX / APP STUDIO</span><h2>{active?.label ?? app.title}</h2></div><span className={css.status}>Sin backend conectado</span></div>
      <nav className={css.tabs} aria-label="Secciones de la aplicación">
        {app.sections.map(item => <button key={item.id} type="button" aria-current={item.id === active?.id ? 'page' : undefined}
          className={item.id === active?.id ? css.activeTab : css.tab} onClick={() => onSectionChange(item.id)}>{item.label}</button>)}
      </nav>
      {active && <AdaptiveVisualStudio key={active.id} appId={app.id} sectionId={active.id}/>}
      {active && <AdaptiveFormPanel key={active.id} appId={app.id} sectionId={active.id}/>}
      <div className={css.footer}><span className={css.notice}>App genérica local. Las API y la IA requieren adaptadores autorizados; no guardar información sensible.</span><span className={css.chatHint}>Kira continúa disponible en el panel de conversación.</span></div>
    </div>
  </section>
}
