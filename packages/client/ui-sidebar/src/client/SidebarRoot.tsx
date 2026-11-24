/**
 * Sidebar shell: instant column geometry and compositor-only icon fades.
 * The frame snaps between its wide column and its 56px icon rail, avoiding
 * repeated resizing of the main chat. Expanded-only content unmounts within
 * the same render instead of waiting for a fade/settle timer.
 * The workspace/session browsing region between
 * the New Session button and the foot is the `sidebar.workspaces` registrant's,
 * and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
 * hands them the wide flag (plus an expand request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconFolderOpenOutline16, IconNewChatOutline16,
  IconPanelLeftOutline16, IconPlugOutline16, PhoenixLogo, PhoenixUiIcon, Tooltip,
  PHOENIX_NAVIGATION_ICON_CHOICES, choosePhoenixNavigationIcon,
  phoenixNavigationIconScope, readPhoenixNavigationIcons, writePhoenixNavigationIcon,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import { TaskCenter } from './TaskCenter.tsx'
import { NATIVE_MENU_KEY, readNativeMenu, nativeMenuOperation, type NativeTarget } from './NativeSelfMenu.ts'
import css from './SidebarRoot.module.css'
// Keep runtime navigation local to the sidebar plugin (client bundle purity).
const HEALTHIA_NAV = {
  doctor: [{id:'overview',label:'Inicio clínico'},{id:'patients',label:'Pacientes'},{id:'encounters',label:'Consultas'},{id:'records',label:'Historia clínica'},{id:'prescriptions',label:'Recetas e informes'},{id:'forms',label:'Formularios'},{id:'capabilities',label:'Capacidades'},{id:'exchange',label:'Intercambios'}],
  patient: [{id:'overview',label:'Mi espacio'},{id:'appointments',label:'Citas'},{id:'records',label:'Mi expediente'},{id:'documents',label:'Documentos'},{id:'consent',label:'Autorizaciones'},{id:'capabilities',label:'Capacidades'},{id:'exchange',label:'Compartir con mi médico'}],
} as const

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
  taskConnection,
}: SidebarRootComponentProps) {
  // Match rendered controls to the actual sidebar width immediately.
  // The old 150ms settle timer blocked the rail and retained costly wide rows.
  const wide = !collapsed
  const [tasksOpen, setTasksOpen] = useState(false)
  const [nativeMenu,setNativeMenu]=useState(()=>readNativeMenu(window.localStorage))
  const [adaptive, setAdaptive] = useState<{
    app: string; role: 'doctor' | 'patient'; section: string
    title?: string; palette?: 'pearl'|'ocean'|'sage'|'iris'|'amber'
    sections: readonly { id: string; label: string }[]
  }>({ app: 'general', role: 'doctor', section: 'overview', sections: [] })
  const [iconOverrides, setIconOverrides] = useState(() => readPhoenixNavigationIcons())
  const [customizeIcons, setCustomizeIcons] = useState(false)
  const [iconError, setIconError] = useState('')
  const navigationItems = adaptive.app === 'healthia' ? HEALTHIA_NAV[adaptive.role] : adaptive.sections
  const setSectionIcon = (section: string, selected: string): void => {
    try {
      setIconOverrides(writePhoenixNavigationIcon(
        adaptive.app, adaptive.role, section, selected === 'auto' ? undefined : selected,
      ))
      setIconError('')
    } catch {
      setIconError('No se pudo guardar el icono. La selección anterior permanece intacta.')
    }
  }
  useEffect(() => {
    const onState = (event: Event): void => {
      const detail = (event as CustomEvent<{ app?: string; role?: string; section?: string; title?: string; sections?: unknown; palette?: string }>).detail
      if (!detail || typeof detail.app !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(detail.app)) return
      const sections = Array.isArray(detail.sections) && detail.sections.length <= 12
        && detail.sections.every((v: unknown) => v && typeof v === 'object'
          && typeof (v as { id?: unknown }).id === 'string'
          && typeof (v as { label?: unknown }).label === 'string'
          && (v as { label: string }).label.length <= 60)
        ? detail.sections as { id: string; label: string }[]
        : []
      setAdaptive({
        app: detail.app,
        role: detail.role === 'patient' ? 'patient' : 'doctor',
        section: typeof detail.section === 'string' ? detail.section : 'overview',
        ...(typeof detail.title === 'string' ? {title:detail.title.slice(0,60)} : {}),
        palette: ['pearl','ocean','sage','iris','amber'].includes(detail.palette ?? '')
          ? detail.palette as 'pearl'|'ocean'|'sage'|'iris'|'amber' : 'pearl',
        sections,
      })
    }
    window.addEventListener('phoenix:adaptive-workspace-state', onState)
    return () => window.removeEventListener('phoenix:adaptive-workspace-state', onState)
  }, [])
  const navigateAdaptive = (app: string, role = adaptive.role, section = 'overview'): void => {
    window.dispatchEvent(new CustomEvent('phoenix:adaptive-workspace', { detail: { app, role, section } }))
  }
  // Navigation destinations open an actionable, focused surface — never the Settings menu.
  const closeSpace = (): void => { window.dispatchEvent(new Event('phoenix:close-space')) }
  const openFeature = (destination: 'connectors' | 'team', label: string): void => {
    closeSpace()
    window.dispatchEvent(new CustomEvent('phoenix:open-feature', { detail: { destination, label } }))
  }
  const openLibrary = (): void => {
    window.dispatchEvent(new Event('phoenix:open-space'))
  }

  // Native self commands share the existing explicit chat preflight/apply channel.
  const navigateNative = (target:NativeTarget):void => {
    if(target==='home'){closeSpace();startSession()}
    else if(target==='tasks'){closeSpace();setTasksOpen(true)}
    else if(target==='connectors')openFeature('connectors',t('nav.connectors'))
    else if(target==='team'){closeSpace();window.dispatchEvent(new Event('phoenix:toggle-team-directory'))}
    else if(target==='library')openLibrary()
    else if(target==='healthia'){closeSpace();navigateAdaptive('healthia','doctor')}
  }
  const nativeLabel=(target:NativeTarget):string=>target==='healthia'?'Healthia':t(('nav.'+target) as Parameters<typeof t>[0])
  useEffect(()=>{
    const onControl=(event:Event):void=>{
      const value=(event as CustomEvent<unknown>).detail
      if(!value||typeof value!=='object')return
      const r=value as {requestId?:unknown;phase?:unknown;command?:{operation?:unknown}}
      if(r.command?.operation!=='native-menu'||typeof r.requestId!=='string'||r.requestId.length>90||!['preflight','apply'].includes(String(r.phase)))return
      let ok=false,reason='INVALID_NATIVE_MENU_COMMAND'
      try{
        const result=nativeMenuOperation(window.localStorage,r.command,r.phase==='apply')
        if(r.phase==='apply'){
          setNativeMenu(result.state)
          if(result.opened){
            if(adaptive.app!=='general')navigateAdaptive('general')
            navigateNative(result.opened)
          }
        }
        ok=true
        reason=result.reason+' · '+JSON.stringify({revision:result.state.revision,entries:result.state.entries.map(entry=>({...entry,label:entry.label??nativeLabel(entry.target)}))})
      }catch(error){reason=error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'NATIVE_MENU_STORAGE_FAILED'}
      window.dispatchEvent(new CustomEvent('phoenix:adaptive-control-result',{detail:{requestId:r.requestId,phase:r.phase,ok,reason}}))
    }
    const onStorage=(event:StorageEvent):void=>{if(event.key===NATIVE_MENU_KEY||event.key===null)setNativeMenu(readNativeMenu(window.localStorage))}
    window.addEventListener('phoenix:adaptive-control-request',onControl)
    window.addEventListener('storage',onStorage)
    return ()=>{window.removeEventListener('phoenix:adaptive-control-request',onControl);window.removeEventListener('storage',onStorage)}
  })
  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  // Throttle layout reads to a single rAF instead of EVERY pointer event.
  useEffect(() => {
    if (!pointerInside) return
    let frame: number | null = null
    let x = 0
    let y = 0
    const onMove = (event: PointerEvent): void => {
      x = event.clientX
      y = event.clientY
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const rect = column.current?.getBoundingClientRect()
        if (rect === undefined) return
        const inside = x >= rect.left && x < rect.right
          && y >= rect.top && y < rect.bottom
        if (inside) cancelLinger()
        else armLinger()
      })
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      if (frame !== null) cancelAnimationFrame(frame)
      cancelLinger()
    }
  }, [pointerInside])

  return (
    <div
      ref={column}
      data-app-palette={adaptive.app.startsWith('app-') ? adaptive.palette : undefined}
      className={clsx(
        css.root, collapsed && css.collapsed, collapsed && everWide.current && css.railIn,
        !pointerInside && css.quietBars,
      )}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
    >
      <div className={css.logoRow}>
        {/* Expanded, the brand doubles as a New Session shortcut; the
            collapsed rail's logo is the expand toggle below instead. */}
        {wide && (
          <button
            type="button"
            className={clsx(css.brand, css.wide)}
            aria-label={t('session.new.label')}
            onClick={() => { closeSpace(); startSession() }}
          >
            <span className={css.brandIdentity} aria-hidden="true">
              <span className={css.brandMark}>
                {renderSlot('sidebar.brand.mark', { size: 38 }, { fallback: <PhoenixLogo size={38} /> })}
              </span>
              <span className={css.brandName}>
                {renderSlot('sidebar.brand.name', {}, {
                  fallback: (
                    <>
                      <span className={css.fallbackBrandName}>PHOENIX</span>
                      {process.env.DSH_CLIENT_COMMIT_HASH
                        ? <span className={css.buildRevision}>{process.env.DSH_CLIENT_COMMIT_HASH}</span>
                        : null}
                    </>
                  ),
                })}
              </span>
            </span>
          </button>
        )}
        {/* Rail resting state is the PHOENIX mark; hovering swaps in the panel
            icon (the expand affordance, figma sidebar-hover flow). */}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.toggle)}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            {!wide && (
              <span className={css.railMark} aria-hidden="true">
                {renderSlot('sidebar.brand.mark', { size: 34 }, { fallback: <PhoenixLogo size={34} /> })}
              </span>
            )}
            {/* Rail icons render at 18 (figma rail spec); expanded keeps the glyph-native sizes. */}
            <IconPanelLeftOutline16 className={css.panelIcon} size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {/* Expanded, the button carries its own label — tooltip only on the rail. */}
      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.newSession}
          aria-label={t('session.new.label')}
          onClick={() => { closeSpace(); startSession() }}
        >
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
        </button>
      </Tooltip>

      {/* Healthia replaces only the contextual menu; core actions remain in General. */}
      {adaptive.app !== 'general' ? (
        <nav className={clsx(css.primaryNavigation, css.healthiaNavigation)} aria-label="Navegación Healthia">
          <button type="button" className={css.navLink} onClick={() => navigateAdaptive('general')} aria-label="Volver a PHOENIX General" title={!wide ? 'PHOENIX General' : undefined}>
            <IconPanelLeftOutline16 size={19} />{wide && <span>PHOENIX · General</span>}
          </button>
          {navigationItems.map(item => {
            const icon = choosePhoenixNavigationIcon(adaptive.app, adaptive.role, item.id, item.label, iconOverrides)
            return (
              <button key={item.id} type="button" className={css.navLink}
                data-navigation-icon={icon}
                aria-current={item.id === adaptive.section ? 'page' : undefined}
                aria-label={item.label} title={!wide ? item.label : undefined}
                onClick={() => navigateAdaptive(adaptive.app, adaptive.role, item.id)}>
                <PhoenixUiIcon name={icon} size={19} tone="neutral" label={item.label} />
                {wide && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>
      ) : (
      <nav className={css.primaryNavigation} aria-label="Navegación principal">
        {nativeMenu.entries.map(entry=>{
          const title=entry.label??nativeLabel(entry.target)
          return <button key={entry.id} type="button" className={css.navLink} aria-label={title} title={wide?undefined:title}
            onClick={()=>navigateNative(entry.target)} data-native-menu-id={entry.id}>
            {entry.target==='home'?<svg viewBox="0 0 24 24" width={wide?19:18} height={wide?19:18} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>
              :entry.target==='tasks'?<svg viewBox="0 0 24 24" width={wide?19:18} height={wide?19:18} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>
              :entry.target==='connectors'?<IconPlugOutline16 size={wide?19:18}/>
              :entry.target==='team'?<IconAgentPresetOutline16 size={wide?19:18}/>
              :entry.target==='library'?<IconFolderOpenOutline16 size={wide?19:18}/>
              :<PhoenixLogo size={wide?19:18}/>}
            {wide&&<span>{title}</span>}
          </button>
        })}
      </nav>
      )}

      {/* The browsing region fills the column between the controls and the
          foot in both states; its rail icon column rides the same slot. */}
      <div className={css.regionArea}>
        {adaptive.app !== 'general' ? (
          <div className={css.healthiaRegion}>
            {wide && <><strong>{adaptive.app === 'healthia' ? 'PERFIL HEALTHIA' : (adaptive.title ?? 'APP ADAPTATIVA')}</strong>
              {adaptive.app === 'healthia' && <div className={css.healthiaRoles}>
                <button type="button" aria-pressed={adaptive.role === 'doctor'} onClick={() => navigateAdaptive('healthia', 'doctor')}>Médico</button>
                <button type="button" aria-pressed={adaptive.role === 'patient'} onClick={() => navigateAdaptive('healthia', 'patient')}>Paciente</button>
              </div>}
              <p>{adaptive.app === 'healthia' ? 'Chat con Kira disponible. Los datos clínicos se manejan en el servicio protegido.' : 'Vista temporal de la aplicación. No tiene conectores ni almacenamiento habilitados.'}</p>
              <button type="button" className={css.iconCustomize} aria-pressed={customizeIcons}
                onClick={() => { setCustomizeIcons(value => !value); setIconError('') }}>
                {customizeIcons ? 'Terminar personalización' : 'Personalizar iconos'}
              </button>
              {customizeIcons && (
                <div className={css.iconEditor} aria-label="Personalización de iconos">
                  {navigationItems.map(item => (
                    <label key={item.id} className={css.iconField}>
                      <span>{item.label}</span>
                      <select aria-label={`Icono de ${item.label}`}
                        value={iconOverrides[phoenixNavigationIconScope(adaptive.app, adaptive.role, item.id)] ?? 'auto'}
                        onChange={event => setSectionIcon(item.id, event.target.value)}>
                        <option value="auto">Automático</option>
                        {PHOENIX_NAVIGATION_ICON_CHOICES.map(choice => (
                          <option key={choice.name} value={choice.name}>{choice.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {iconError && <p role="alert">{iconError}</p>}
                </div>
              )}
            </>}
          </div>
        ) : renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Footer actions stack above Settings in both sidebar widths. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
      {tasksOpen && <TaskCenter connection={taskConnection} onClose={() => { setTasksOpen(false) }} />}
    </div>
  )
}
