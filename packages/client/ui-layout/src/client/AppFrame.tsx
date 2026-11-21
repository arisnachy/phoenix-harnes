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
import { createPortal } from 'react-dom'
import type { CSSProperties, ErrorInfo, ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@phoenix-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'
import { HealthiaWorkspace, HEALTHIA_NAV, type HealthiaRole } from './HealthiaWorkspace.tsx'
import { ADAPTIVE_APP_PRESETS, createAdaptiveAppBlueprint, type AdaptiveAppBlueprint } from './AdaptiveAppCatalog.ts'
import { appendAdaptiveSection, renameAdaptiveSection, removeAdaptiveSection, restorePreviousAdaptiveApps, installAdaptiveApp, readAdaptiveApps } from './AdaptiveAppRegistry.ts'
import { applyAdaptiveFormFields, restorePreviousAdaptiveForms } from './AdaptiveFormMetadataStore.ts'
import {
  parseAdaptiveControl, preflightAdaptiveControl, findAdaptiveMetadata,
  saveAdaptivePalette, readAdaptivePalette, applyAdaptiveFieldEdit, applyAdaptiveVisualEdit, applyAdaptiveAiFieldEdit,
  type AdaptiveDiscovery,
} from './AdaptiveWorkspaceControl.ts'
import { isVisualOperation, restoreVisualBoard, readVisualBoard } from './AdaptiveVisualKit.ts'
import { AdaptiveAppPreview } from './AdaptiveAppPreview.tsx'
import type { AdaptiveLiveSnapshot } from './AdaptiveLiveSlots.ts'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'shell.workspace'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & { readonly inspectRuntime?: (() => AdaptiveLiveSnapshot) | undefined }

interface SurfaceBoundaryProps {
  readonly name: 'conversation' | 'workspace' | 'details' | 'adaptive'
  readonly resetKey: string
  readonly onRestore?: () => void
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
export class SurfaceBoundary extends Component<SurfaceBoundaryProps, SurfaceBoundaryState> {
  override state: SurfaceBoundaryState = { failed: false, autoRetried: false }

  static getDerivedStateFromError(): Partial<SurfaceBoundaryState> {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Adaptive forms may ultimately handle clinical content: never send exception
    // messages or component props to generic console/telemetry on that surface.
    if (this.props.name === 'adaptive') {
      console.error('PHOENIX adaptive surface render failed (details withheld)')
    } else {
      console.error(`PHOENIX ${this.props.name} surface render failed:`, error, info.componentStack)
    }
    if (this.props.name === 'adaptive' && this.state.autoRetried) {
      // Two consecutive crashes: leave the compromised optional app and
      // restore PHOENIX General. Core conversation stays mounted.
      this.props.onRestore?.()
    }
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
        {this.props.name === 'adaptive' && this.props.onRestore &&
          <button type="button" onClick={this.props.onRestore}>Volver a PHOENIX General</button>}
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
  inspectRuntime,
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
  const [customApps, setCustomApps] = useState<readonly AdaptiveAppBlueprint[]>(readAdaptiveApps)
  const [customSection, setCustomSection] = useState('overview')
  const activeBlueprint = customApps.find(app => app.id === adaptiveApp)
  const [healthiaRole, setHealthiaRole] = useState<HealthiaRole>('doctor')
  const [healthiaSection, setHealthiaSection] = useState('overview')
  const [missionError, setMissionError] = useState(false)
  const [search, setSearch] = useState<{ term: string; results: readonly AdaptiveDiscovery[] } | null>(null)
  const [paletteRevision, setPaletteRevision] = useState(0)
  // Explicit two-stage chat request. The client can only alter local UI
  // metadata; events do not constitute permission for clinical/API actions.
  useEffect(() => {
    const onControl = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return
      const request = detail as Record<string, unknown>
      if (Object.keys(request).some(key => !['requestId','phase','command'].includes(key))
        || typeof request.requestId !== 'string' || request.requestId.length > 90
        || (request.phase !== 'preflight' && request.phase !== 'apply')) return
      const command = parseAdaptiveControl(request.command)
      let ok = false
      let reason = 'INVALID_COMMAND'
      try {
        if (command) {
          const gate = preflightAdaptiveControl(command)
          ok = gate.valid
          reason = gate.reason
          if (gate.valid && request.phase === 'apply') {
            if (command.operation === 'open') {
              if (command.appId === 'general') setAdaptiveApp('general')
              else if (command.appId === 'healthia') {
                setAdaptiveApp('healthia')
                if (command.sectionId && HEALTHIA_NAV[healthiaRole].some(item => item.id === command.sectionId)) {
                  setHealthiaSection(command.sectionId)
                } else setHealthiaSection('overview')
              } else {
                const app = readAdaptiveApps().find(item => item.id === command.appId)
                if (!app) throw new Error('UNKNOWN_APP')
                setAdaptiveApp(app.id)
                setCustomSection(command.sectionId ?? app.sections[0]?.id ?? 'inicio')
              }
              setSearch(null)
            } else if (command.operation === 'find') {
              const matches = findAdaptiveMetadata(command.query!)
              setSearch({ term: command.query!, results: matches })
              reason = matches.length ? `Se encontraron ${matches.length} componentes.` : 'No hay coincidencias en el catálogo de aplicaciones.'
            } else if (command.operation === 'palette') {
              saveAdaptivePalette(command.appId,command.palette!)
              setPaletteRevision(value => value + 1)
              setAdaptiveApp(command.appId)
            } else if (command.operation === 'add-section') {
              const app = appendAdaptiveSection(command.appId,command.label!)
              setCustomApps(readAdaptiveApps())
              setAdaptiveApp(app.id)
              setCustomSection(app.sections[app.sections.length - 1]?.id ?? 'inicio')
              setSearch(null)
            } else if (command.operation === 'rename-section' || command.operation === 'remove-section') {
              const app = command.operation === 'rename-section'
                ? renameAdaptiveSection(command.appId,command.sectionId!,command.label!)
                : removeAdaptiveSection(command.appId,command.sectionId!)
              setCustomApps(readAdaptiveApps())
              setAdaptiveApp(app.id)
              setCustomSection(command.operation === 'remove-section' ? app.sections[0]?.id ?? 'inicio' : command.sectionId!)
              setSearch(null)
            } else if (command.operation === 'set-field-ai') {
              applyAdaptiveAiFieldEdit(command)
              setAdaptiveApp(command.appId)
              setCustomSection(command.sectionId!)
              window.dispatchEvent(new CustomEvent('phoenix:adaptive-ai-field-config-refreshed',{
                detail:{appId:command.appId,sectionId:command.sectionId,fieldId:command.fieldId},
              }))
            } else if (isVisualOperation(command.operation)) {
              applyAdaptiveVisualEdit(command)
              setAdaptiveApp(command.appId)
              setCustomSection(command.sectionId!)
              window.dispatchEvent(new CustomEvent('phoenix:adaptive-visual-refreshed', {
                detail:{appId:command.appId,sectionId:command.sectionId},
              }))
            } else {
              applyAdaptiveFieldEdit(command)
              setAdaptiveApp(command.appId)
              setCustomSection(command.sectionId!)
              window.dispatchEvent(new CustomEvent('phoenix:adaptive-form-refreshed', {
                detail:{appId:command.appId,sectionId:command.sectionId},
              }))
            }
          }
        }
      } catch {
        ok = false
        reason = 'VALIDATION_OR_STORAGE_FAILED'
      }
      window.dispatchEvent(new CustomEvent('phoenix:adaptive-control-result', {
        detail:{requestId:request.requestId,phase:request.phase,ok,reason},
      }))
    }
    window.addEventListener('phoenix:adaptive-control-request',onControl)
    return () => window.removeEventListener('phoenix:adaptive-control-request',onControl)
  }, [healthiaRole])

  // A chat-authored form diff is inert until the user explicitly applies it.
  // The target must be a locally installed generic app, never Healthia EHR.
  useEffect(() => {
    const onFormInstall = (event: Event): void => {
      const value = (event as CustomEvent<unknown>).detail
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      const request = value as Record<string, unknown>
      if (typeof request.requestId !== 'string' || request.requestId.length > 80) return
      let ok = false
      try {
        if (Object.keys(request).some(k => !['requestId','appId','sectionId','fields'].includes(k))
          || typeof request.appId !== 'string' || typeof request.sectionId !== 'string') throw new Error('INVALID_REQUEST')
        const installed = readAdaptiveApps().find(app => app.id === request.appId)
        if (!installed || !installed.sections.some(item => item.id === request.sectionId)) throw new Error('UNKNOWN_APP')
        applyAdaptiveFormFields(installed.id, request.sectionId, request.fields)
        setCustomApps(readAdaptiveApps())
        setAdaptiveApp(installed.id)
        setCustomSection(request.sectionId)
        window.dispatchEvent(new CustomEvent('phoenix:adaptive-form-refreshed', {
          detail: { appId: installed.id, sectionId: request.sectionId },
        }))
        ok = true
      } catch {
        // Invalid, stale or unauthenticated proposals never mutate app views.
      }
      window.dispatchEvent(new CustomEvent('phoenix:adaptive-form-install-result', {
        detail: { requestId: request.requestId, ok },
      }))
    }
    window.addEventListener('phoenix:adaptive-form-install', onFormInstall)
    return () => window.removeEventListener('phoenix:adaptive-form-install', onFormInstall)
  }, [])

  // The model may propose a structure; only a user-clicked, bounded app
  // proposal can reach this configuration-only installation handler.
  useEffect(() => {
    const onInstall = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return
      const proposal = detail as Record<string, unknown>
      if (Object.keys(proposal).some(key => !['requestId','title','sections'].includes(key))
        || typeof proposal.requestId !== 'string' || proposal.requestId.length > 80
        || typeof proposal.title !== 'string' || !Array.isArray(proposal.sections)
        || proposal.sections.some(section => typeof section !== 'string')) return
      let ok = false
      try {
        const blueprint = createAdaptiveAppBlueprint(proposal.title, proposal.sections)
        const installed = installAdaptiveApp(blueprint)
        setCustomApps(installed)
        setAdaptiveApp(blueprint.id)
        setCustomSection(blueprint.sections[0]?.id ?? 'inicio')
        
        ok = true
      } catch {
        // Storage unavailable, duplicate, malicious manifest or invalid name.
        // Never modify the active workspace on failure.
      }
      window.dispatchEvent(new CustomEvent('phoenix:adaptive-app-install-result', {
        detail: { requestId: proposal.requestId, ok },
      }))
    }
    window.addEventListener('phoenix:adaptive-app-install', onInstall)
    return () => window.removeEventListener('phoenix:adaptive-app-install', onInstall)
  }, [])
  useEffect(() => {
    const onFailure = (): void => { setMissionError(true) }
    window.addEventListener('phoenix:adaptive-app-mission-failed', onFailure)
    return () => window.removeEventListener('phoenix:adaptive-app-mission-failed', onFailure)
  }, [])

  // UI state only. This channel cannot grant access to medical records.
  useEffect(() => {
    const onWorkspace = (event: Event): void => {
      const request = (event as CustomEvent<{ app?: string; role?: string; section?: string }>).detail
      if (!request) return
      if (request.app === 'general') { setAdaptiveApp('general'); return }
      if (request.app !== 'healthia') {
        const custom = customApps.find(app => app.id === request.app)
        if (!custom) return
        setAdaptiveApp(custom.id)
        setCustomSection(custom.sections.some(item => item.id === request.section) ? request.section! : custom.sections[0]?.id ?? 'inicio')
        
        return
      }
      setAdaptiveApp('healthia')
      
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
  // The conversation toolbar owns the app launcher. Publish bounded structural
  // metadata only (never clinical values, tokens or connector authorizations).
  useEffect(() => {
    const publish = (): void => {
      window.dispatchEvent(new CustomEvent('phoenix:adaptive-workspace-state', {
        detail: {
          app: adaptiveApp, role: healthiaRole,
          section: activeBlueprint ? customSection : healthiaSection,
          sections: activeBlueprint?.sections ?? undefined,
          title: activeBlueprint?.title ?? undefined,
          palette: activeBlueprint ? readAdaptivePalette(activeBlueprint.id) : 'pearl',
          apps: customApps.slice(0,20).map(app => ({ id:app.id,title:app.title,sections:app.sections.slice(0,12) })),
          presets: ADAPTIVE_APP_PRESETS.map(app => ({ id:app.id,label:app.label,readiness:app.readiness })),
        },
      }))
    }
    window.addEventListener('phoenix:adaptive-workspace-state-request', publish)
    publish()
    return () => window.removeEventListener('phoenix:adaptive-workspace-state-request', publish)
  }, [adaptiveApp,healthiaRole,healthiaSection,customSection,activeBlueprint,paletteRevision,customApps])

  // Inspect only registered UI structure when the user explicitly requests it
  // from the toolbar. AppFrame remains the owner of live slot inspection.
  useEffect(() => {
    const inspect = (): void => {
          // Explicit user action, bounded UI metadata only. Slots describe
          // registrations, not authentication or connector readiness.
          const slots = (() => {
            try { return inspectRuntime?.().slots.map(slot => ({id:slot.id,state:slot.state})) ?? [] }
            catch { return [] }
          })()
          window.dispatchEvent(new CustomEvent('phoenix:adaptive-self-inspect', {detail:{
            activeApp:adaptiveApp,
            apps:customApps.slice(0,12).map(app => ({
              id:app.id,title:app.title,
              sections:app.sections.slice(0,8).map(item => {
                const board=readVisualBoard(app.id,item.id)
                return {id:item.id,label:item.label,visual:{revision:board.revision,total:board.widgets.length,
                  widgets:board.widgets.slice(0,10).map(widget=>({
                    id:widget.id,kind:widget.kind,title:widget.title,span:widget.span,
                  }))}}
              }),
            })),
            declared:ADAPTIVE_APP_PRESETS.map(app => ({
              id:app.id,label:app.label,readiness:app.readiness,
            })),
            slots,
          }}))
    }
    window.addEventListener('phoenix:adaptive-self-inspect-request', inspect)
    return () => window.removeEventListener('phoenix:adaptive-self-inspect-request', inspect)
  }, [adaptiveApp,customApps,inspectRuntime])

  // The adaptable workspace is rendered INTO the conversation scrollport.
  // No reserved rail, fixed overlay or capped-height panel may push the composer.
  const [inlineAppHost, setInlineAppHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const root = frameRef.current
    if (!root) return
    const sync = (): void => {
      const host = root.querySelector<HTMLElement>('[data-adaptive-chat-host]')
      setInlineAppHost(previous => previous === host ? previous : host)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])


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
          {search && (
            <div className={css.adaptiveSearch} aria-label="Búsqueda en aplicaciones">
              <div className={css.adaptiveSearchHeader}>
                <strong>Resultados: {search.term}</strong>
                <button type="button" onClick={() => setSearch(null)} aria-label="Cerrar resultados">×</button>
              </div>
              {search.results.length ? search.results.map((item,index) => (
                <button type="button" key={index} className={css.adaptiveSearchItem}
                  onClick={() => {
                    setAdaptiveApp(item.appId)
                    if (item.sectionId) setCustomSection(item.sectionId)
                    setSearch(null)
                  }}>
                  {item.label} <span>{item.kind} · {item.appId}</span>
                </button>
              )) : <p>No se encontraron componentes en aplicaciones genéricas.</p>}
            </div>
          )}
          {missionError && (
            <div className={css.appMissionError} role="alert">
              No se pudo crear la conversación de App Studio. Comprueba la conexión de PHOENIX y vuelve a intentarlo.
              <button type="button" onClick={() => setMissionError(false)} aria-label="Cerrar aviso de App Studio">×</button>
            </div>
          )}
          {inlineAppHost && (adaptiveApp === 'healthia' || activeBlueprint !== undefined) && createPortal(
          <SurfaceBoundary name="adaptive" resetKey={adaptiveApp}
            onRestore={() => {
              // Only restore local structural manifests. Clinical stores, chat,
              // credentials, model settings and PHOENIX Core are never touched.
              try { restorePreviousAdaptiveApps() } catch { /* General remains available */ }
              try { restorePreviousAdaptiveForms() } catch { /* Schema is quarantined */ }
              if (activeBlueprint) try { restoreVisualBoard(activeBlueprint.id, customSection) } catch { /* Optional UI metadata */ }
              setCustomApps(readAdaptiveApps())
              setAdaptiveApp('general')
              setSearch(null)
              
            }}>
            <div className={css.adaptiveChatCard}>
              <div className={css.adaptiveChatChrome}>
                <span aria-hidden="true" className={css.adaptiveChatSpark}>✦</span>
                <strong>Kira · Espacio interactivo</strong>
                <span className={css.adaptiveChatBadge}>{adaptiveApp === 'healthia' ? 'Healthia' : 'App Studio'}</span>
                <button type="button" aria-label="Cerrar espacio interactivo" onClick={() => setAdaptiveApp('general')}>Cerrar</button>
              </div>
            {activeBlueprint && (
              <AdaptiveAppPreview key={activeBlueprint.id} app={activeBlueprint} section={customSection}
                palette={readAdaptivePalette(activeBlueprint.id)}
                onSectionChange={setCustomSection} onReturn={() => setAdaptiveApp('general')} />
            )}
            {adaptiveApp === 'healthia' && (
              <HealthiaWorkspace role={healthiaRole} section={healthiaSection} inspectRuntime={inspectRuntime}
                onRoleChange={role => { setHealthiaRole(role); setHealthiaSection('overview') }}
                onSectionChange={setHealthiaSection}
                onReturn={() => { setAdaptiveApp('general');  }}
              />
            )}
            </div>
          </SurfaceBoundary>
            , inlineAppHost
          )}
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
