import type { ReactNode } from 'react'
import type { HostObservable, PropsHooks, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type {} from '@phoenix-ai/dsh-client-ui-layout/client'
import {
  WORKSPACE_SURFACE_KINDS,
  type WorkspaceSurfaceKind,
  type WorkspaceSurfaceSnapshot,
} from './workspace-surface.ts'
import css from './WorkspaceSurfacePanel.module.css'

export type WorkspaceSurfaceInjected = {
  hooks: { workspaceSurface: HostObservable<WorkspaceSurfaceSnapshot> }
  activateSurface: (kind: WorkspaceSurfaceKind) => void
  collapseSurface: () => void
  clearSurface: (kind?: WorkspaceSurfaceKind) => void
}

export type WorkspaceSurfacePanelProps =
  PropsRuntime<'workspace.surface'>
  & Omit<WorkspaceSurfaceInjected, 'hooks'>
  & PropsHooks<WorkspaceSurfaceInjected['hooks']>

const LABELS: Record<WorkspaceSurfaceKind, string> = {
  preview: 'Preview',
  changes: 'Changes',
  files: 'Files',
  browser: 'Browser',
  terminal: 'Terminal',
}

function textual(content: string | undefined): ReactNode {
  return <pre className={css.code}>{content ?? 'No content yet.'}</pre>
}

function renderActive(snapshot: WorkspaceSurfaceSnapshot): ReactNode {
  const kind = snapshot.active
  if (kind === null) return <div className={css.empty}>Phoenix has not shared any visual work yet.</div>
  const item = snapshot.items[kind]
  if (item === null) return <div className={css.empty}>Nothing is available in this tab yet.</div>

  if (kind === 'preview') {
    if (item.mediaType === 'text/html' && item.content !== undefined) {
      return <iframe className={css.framePreview} title={item.title} sandbox="" referrerPolicy="no-referrer" srcDoc={item.content} />
    }
    if (item.mediaType?.startsWith('image/') && item.url !== undefined) {
      return <img className={css.mediaPreview} alt={item.title} src={item.url} />
    }
    if (item.mediaType?.startsWith('video/') && item.url !== undefined) {
      return <video className={css.mediaPreview} aria-label={item.title} src={item.url} controls />
    }
    return textual(item.content ?? item.url)
  }

  if (kind === 'browser' && item.url !== undefined) {
    return (
      <iframe
        className={css.framePreview}
        title={item.title}
        src={item.url}
        sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts"
        referrerPolicy="no-referrer"
      />
    )
  }

  return textual(item.content ?? item.url)
}

export function WorkspaceSurfacePanel({
  useWorkspaceSurface,
  activateSurface,
  collapseSurface,
  clearSurface,
}: WorkspaceSurfacePanelProps) {
  const snapshot = useWorkspaceSurface(value => value)
  const activeItem = snapshot.active === null ? null : snapshot.items[snapshot.active]

  return (
    <section className={css.root} aria-label="Workspace Surface" data-workspace-surface>
      <header className={css.header}>
        <div className={css.heading}>
          <span className={css.eyebrow}>PHOENIX · WORKSPACE</span>
          <strong className={css.title}>{activeItem?.title ?? 'Workspace Surface'}</strong>
        </div>
        <div className={css.headerActions}>
          {snapshot.active !== null && snapshot.items[snapshot.active] !== null && (
            <button type="button" className={css.iconButton} aria-label="Clear current surface" onClick={() => { clearSurface(snapshot.active ?? undefined) }}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M3 4h10M6 4V2.8h4V4m-5 0 .6 9h4.8l.6-9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <button type="button" className={css.iconButton} aria-label="Collapse Workspace Surface" onClick={collapseSurface}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </header>

      <nav className={css.tabs} role="tablist" aria-label="Workspace Surface views">
        {WORKSPACE_SURFACE_KINDS.map(kind => {
          const available = snapshot.items[kind] !== null
          const selected = snapshot.active === kind
          return (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={!available}
              className={css.tab}
              data-active={selected || undefined}
              onClick={() => { activateSurface(kind) }}
            >
              {LABELS[kind]}
            </button>
          )
        })}
      </nav>

      <div className={css.body} role="tabpanel">
        {renderActive(snapshot)}
      </div>
    </section>
  )
}
