/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ErrorInfo, ReactNode, FormEvent } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@phoenix-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'
import { HealthiaWorkspace, HEALTHIA_NAV, type HealthiaRole } from './HealthiaWorkspace.tsx'
import { ADAPTIVE_APP_PRESETS, createAdaptiveAppBlueprint, type AdaptiveAppBlueprint } from './AdaptiveAppCatalog.ts'
import { AdaptiveAppPreview } from './AdaptiveAppPreview.tsx'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'shell.workspace'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

interface SurfaceBoundaryProps {
  readonly name: 'conversation' | 'workspace' | 'details' | 'adaptive'
  readonly resetKey: string
  readonly children: ReactNode
}

interface SurfaceBoundaryState {
  readonly failed: boolean
  readonly autoRetried: boolean
}

/**
 * Keep one faulty optional surface from taking down the entire Phoenix shell.
 * The first render failure gets one automatic clean remount; a persistent
 * failure stays contained behind a small retry control instead of leaving a
 * white screen that requires restarting the Host.
 */
class SurfaceBoundary extends Component<SurfaceBoundaryProps, SurfaceBoundaryState> {
  override state: SurfaceBoundaryState = { failed: false, autoRetried: false }

  static getDerivedStateFromError(): Partial<SurfaceBoundaryState> {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`PHOENIX ${this.props.name} surface render failed:`, error, info.componentStack)
    this.setState(state => state.autoRetried
      ? null
      : { failed: false, autoRetried: true })
  }

  override componentDidUpdate(previous: SurfaceBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && (this.state.failed || this.state.autoRetried)) {
      this.setState({ failed: false, autoRetried: false })
    }
  }

  private readonly retry = (): void => {
    this.setState({ failed: false, autoRetried: true })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className={css.surfaceRecovery} role="alert" data-surface-recovery={this.props.name}>
        <span>PHOENIX isolated a rendering error in this view.</span>
        <button type="button" onClick={this.retry}>Retry view</button>
      </div>
    )
  }
}

/**
 * Evaluate a slot render call inside the error boundary rather than in
 * AppFrame's own render expression. This also contains failures thrown by the
 * slot engine itself before it returns a React element.
 */
function SurfaceRender(props: { readonly render: () => ReactNode }): ReactNode {
  return <>{props.render()}</>
}

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const currentSession = useSessions(s => s.current)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [adaptiveApp, setAdaptiveApp] = useState<string>('general')
  const [customApps, setCustomApps] = useState<readonly AdaptiveAppBlueprint[]>([])
  const [appTitle, setAppTitle] = useState('')
  const [appSectionsText, setAppSectionsText] = useState('')
  const [appBuilderOpen, setAppBuilderOpen] = useState(false)
  const [appError, setAppError] = useState('')
  const [customSection, setCustomSection] = useState('overview')
  const activeBlueprint = customApps.find(app => app.id === adaptiveApp)
  const createApp = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    try {
      const sections = appSectionsText.split(',').map(value => value.trim())
      const blueprint = createAdaptiveAppBlueprint(appTitle.trim(), sections)
      if (customApps.some(app => app.id === blueprint.id)) throw new Error('DUPLICATE_APP')
      setCustomApps(apps => [...apps, blueprint])
      setAdaptiveApp(blueprint.id)
      setCustomSection(blueprint.sections[0].id)
      setAppTitle('')
      setAppSectionsText('')
      setAppBuilderOpen(false)
      setAppMenuOpen(false)
      setAppError('')
    } catch {
      setAppError('Utiliza un nombre único y de 1 a 12 secciones separadas por comas.')
    }
  }
  const [healthiaRole, setHealthiaRole] = useState<HealthiaRole>('doctor')
  const [healthiaSection, setHealthiaSection] = useState('overview')
  const [appMenuOpen, setAppMenuOpen] = useState(false)

  // UI state only. This channel cannot grant access to medical records.
  useEffect(() => {
    const onWorkspace = (event: Event): void => {
      const request = (event as CustomEvent<{ app?: string; role?: string; section?: string }>).detail
      if (!request) return
      if (request.app === 'general') { setAdaptiveApp('general'); setAppMenuOpen(false); return }
      if (request.app !== 'healthia') {
        const custom = customApps.find(app => app.id === request.app)
        if (!custom) return
        setAdaptiveApp(custom.id)
        setCustomSection(custom.sections.some(item => item.id === request.section) ? request.section! : custom.sections[0].id)
        setAppMenuOpen(false)
        return
      }
      setAdaptiveApp('healthia')
      setAppMenuOpen(false)
      if (request.role === 'doctor' || request.role === 'patient') {
        setHealthiaRole(request.role)
        setHealthiaSection(HEALTHIA_NAV[request.role].some(v => v.id === request.section) ? request.section! : 'overview')
      } else if (request.section && HEALTHIA_NAV[healthiaRole].some(v => v.id === request.section)) {
        setHealthiaSection(request.section)
      }
    }
    window.addEventListener('phoenix:adaptive-workspace', onWorkspace)
    return () => window.removeEventListener('phoenix:adaptive-workspace', onWorkspace)
  }, [healthiaRole, customApps])
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('phoenix:adaptive-workspace-state', {
      detail: { app: adaptiveApp, role: healthiaRole, section: activeBlueprint ? customSection : healthiaSection,
        sections: activeBlueprint?.sections ?? undefined, title: activeBlueprint?.title ?? undefined },
    }))
  }, [adaptiveApp, healthiaRole, healthiaSection, customSection, activeBlueprint])


  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const cordisOnLeft = panels.workspaceCordis && panels.workspaceCordisSide === 'left'
  const sidebarCollapsed = cordisOnLeft || (narrow ? !panels.narrowExpanded : panels.sidebar === 0)
  // Grid-track easing reflows the entire conversation on every animation frame.
  // Snap only when the sidebar changes its collapsed state; ordinary details
  // transitions and manual width dragging keep their original behavior.
  const previousSidebarCollapsed = useRef(sidebarCollapsed)
  const sidebarSwitching = previousSidebarCollapsed.current !== sidebarCollapsed
  previousSidebarCollapsed.current = sidebarCollapsed
  // Browser window resizing is also geometry, not an animation: easing
  // successive ResizeObserver widths makes the large chat reflow repeatedly.
  const previousViewport = useRef(viewport)
  const viewportResizing = previousViewport.current !== viewport
  previousViewport.current = viewport
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const solvedCols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  // Ordinary collapse keeps a 72px column aligned to the compact header. Left Cordis borrows that
  // physical edge too, so make it a true 0px track and return the rail width
  // to center instead of overlaying the conversation.
  const cols = cordisOnLeft
    ? { ...solvedCols, sidebar: 0, center: solvedCols.center + solvedCols.sidebar }
    : solvedCols
  // KIRA Teams floats above the conversation and must never create a structural
  // rail. Expanding the sidebar would still move a centered chat to the right
  // by half the sidebar delta, though, so publish the exact paint-only
  // counter-offset needed to keep the same viewport axis as the collapsed rail.
  const overlayStableChatAxisOffset = sidebarCollapsed
    ? 0
    : Math.max(0, (cols.sidebar - SIDEBAR_COLLAPSED) / 2)
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`,
        '--phoenix-shell-bar-size': `${SIDEBAR_COLLAPSED}px`,
        '--dsh-overlay-stable-chat-axis-offset': `${overlayStableChatAxisOffset}px`,
      } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-sidebar-switching={sidebarSwitching || undefined}
      data-viewport-resizing={viewportResizing || undefined}
      data-cordis-side={panels.workspaceCordis ? panels.workspaceCordisSide ?? 'right' : undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <div className={css.sidebarCol}>
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      <>
        <CenterColumn>
          <div className={css.appLauncher}>
            <button type="button" className={css.appLauncherButton} aria-label="Aplicaciones PHOENIX" aria-expanded={appMenuOpen} onClick={() => setAppMenuOpen(open => !open)}>
              <span aria-hidden="true">▦</span> {adaptiveApp === 'healthia' ? 'Healthia' : 'Apps'}
            </button>
            {appMenuOpen && <div className={css.appLauncherMenu} role="menu" aria-label="Aplicaciones instaladas">
              <button type="button" role="menuitem" onClick={() => { setAdaptiveApp('general'); setAppMenuOpen(false) }}>PHOENIX · General</button>
              <button type="button" role="menuitem" onClick={() => { setAdaptiveApp('healthia'); setHealthiaRole('doctor'); setHealthiaSection('overview'); setAppMenuOpen(false) }}>Healthia · Médico</button>
              <button type="button" role="menuitem" onClick={() => { setAdaptiveApp('healthia'); setHealthiaRole('patient'); setHealthiaSection('overview'); setAppMenuOpen(false) }}>Healthia · Paciente (vista preliminar)</button>
              {ADAPTIVE_APP_PRESETS.filter(app => app.readiness === 'preview-only').map(app => (
                <button key={app.id} type="button" role="menuitem" disabled title="Plantilla disponible en el catálogo; no es una aplicación conectada">{app.label} · Sin conectar</button>
              ))}
              {customApps.map(app => <button key={app.id} type="button" role="menuitem" onClick={() => {
                setAdaptiveApp(app.id); setCustomSection(app.sections[0].id); setAppMenuOpen(false)
              }}>{app.title} · Borrador</button>)}
              <button type="button" role="menuitem" onClick={() => { setAppBuilderOpen(value => !value); setAppError('') }}>+ Crear aplicación</button>
              {appBuilderOpen && <form className={css.appLauncherForm} onSubmit={createApp}>
                <input aria-label="Nombre de nueva aplicación" value={appTitle} onChange={event => setAppTitle(event.currentTarget.value)} maxLength={60} placeholder="Nombre de la aplicación"/>
                <input aria-label="Secciones de nueva aplicación" value={appSectionsText} onChange={event => setAppSectionsText(event.currentTarget.value)} placeholder="Inicio, Productos, Reportes"/>
                <button type="submit">Crear vista adaptable</button>
                <small>Vista temporal sin permisos, almacenamiento ni conectores.</small>
                {appError && <span role="alert">{appError}</span>}
              </form>}
            </div>}
          </div>
          <SurfaceBoundary name="adaptive" resetKey={adaptiveApp}>
            {activeBlueprint && (
              <AdaptiveAppPreview key={activeBlueprint.id} app={activeBlueprint} section={customSection}
                onSectionChange={setCustomSection} onReturn={() => setAdaptiveApp('general')} />
            )}
            {adaptiveApp === 'healthia' && (
              <HealthiaWorkspace role={healthiaRole} section={healthiaSection}
                onRoleChange={role => { setHealthiaRole(role); setHealthiaSection('overview') }}
                onSectionChange={setHealthiaSection}
                onReturn={() => { setAdaptiveApp('general'); setAppMenuOpen(false) }}
              />
            )}
          </SurfaceBoundary>
          <div data-shell-overlay>{renderSlot('shell.overlay', {})}</div>
          <SurfaceBoundary name="conversation" resetKey={currentSession ?? 'none'}>
            <SurfaceRender render={() => renderSlot('conversation', {})} />
          </SurfaceBoundary>
          <div data-shell-workspace>
            <SurfaceBoundary name="workspace" resetKey={currentSession ?? 'none'}>
              <SurfaceRender render={() => renderSlot('shell.workspace', {})} />
            </SurfaceBoundary>
          </div>
        </CenterColumn>
        <DetailsColumn>
          <SurfaceBoundary name="details" resetKey={detailsSession ?? 'none'}>
            <SurfaceRender render={() => renderSlot('details', {})} />
          </SurfaceBoundary>
        </DetailsColumn>
      </>
      {!sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {cols.details > 0 && <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
    </div>
  )
}
