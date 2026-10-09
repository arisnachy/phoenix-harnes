/**
 * A real Chromium viewport inside the conversation, fed by the same local CDP
 * tab Kira controls. No website iframe, hidden scripts, fake screenshots or
 * model-generated browser states. Fullscreen is a larger view of SAME tab.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import css from './MiniBrowser.module.css'

type Tab = { id: string; title: string; url: string }
type Snapshot = { available: boolean; tabId?: string; url?: string; title?: string; tabs: Tab[] }
type Command = { type: string; url?: string; tabId?: string; x?: number; y?: number; deltaY?: number; key?: string; text?: string; modifiers?: number }
const API = '/phoenix-mini-browser'
const HEADERS = { 'x-phoenix-mini-browser': '1' }
const BLANK: Snapshot = { available: false, tabs: [] }

async function decode<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || 'El navegador no respondió.')
  return data
}
function validSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== 'object') return false
  const x = value as Partial<Snapshot>
  return typeof x.available === 'boolean' && Array.isArray(x.tabs)
}
async function inspect(signal?: AbortSignal): Promise<Snapshot> {
  const response = await fetch(API + '/state', { headers: HEADERS, signal, cache: 'no-store' })
  const data: unknown = await decode<unknown>(response)
  if (!validSnapshot(data)) throw new Error('Estado de Chromium no válido.')
  return data
}
async function command(input: Command): Promise<Snapshot> {
  const response = await fetch(API + '/action', {
    method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(input), cache: 'no-store',
  })
  const data: unknown = await decode<unknown>(response)
  if (!validSnapshot(data)) throw new Error('Respuesta de Chromium no válida.')
  return data
}
/** Translate an image gesture into Chromium's fixed 1280 × 720 viewport. */
function point(element: HTMLImageElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const scale = Math.min(rect.width / 1280, rect.height / 720)
  const shownWidth = scale * 1280
  const shownHeight = scale * 720
  const x = (clientX - rect.left - (rect.width - shownWidth) / 2) / scale
  const y = (clientY - rect.top - (rect.height - shownHeight) / 2) / scale
  if (x < 0 || y < 0 || x > 1280 || y > 720) return null
  return { x, y }
}
/** Human navigation stays in the user-controlled MiniBrowser, never in the model's context. */
export function MiniBrowser() {
  const [snapshot, setSnapshot] = useState<Snapshot>(BLANK)
  const [enabled, setEnabled] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [address, setAddress] = useState('')
  const [typed, setTyped] = useState('')
  const [frame, setFrame] = useState<string>()
  const [error, setError] = useState<string>()
  const [supported, setSupported] = useState(false)
  const focusRef = useRef<HTMLImageElement>(null)
  const currentTab = useRef<string>()
  const busy = useRef(false)
  const mounted = useRef(true)
  const frameRef = useRef<string>()
  const show = !dismissed && (enabled || (snapshot.available && snapshot.url !== undefined && snapshot.url !== 'about:blank'))

  const run = useCallback(async (request: Command): Promise<void> => {
    try {
      setError(undefined)
      const state = await command(request)
      setSnapshot(state)
      if (request.type === 'open' || request.type === 'new-tab') setEnabled(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    let stopped = false
    const first = new AbortController()
    const poll = async (): Promise<void> => {
      try {
        const state = await inspect(first.signal)
        if (stopped) return
        setSupported(true)
        setSnapshot(state)
      } catch { /* Older hosts simply do not expose the browser feature. */ }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1700)
    return () => {
      stopped = true
      mounted.current = false
      first.abort()
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!show || !snapshot.available || collapsed) return
    let stopped = false
    const load = async () => {
      if (busy.current) return
      busy.current = true
      try {
        const response = await fetch(API + '/frame', { headers: HEADERS, cache: 'no-store' })
        if (!response.ok) throw new Error('La imagen de la página no está disponible.')
        const blob = await response.blob()
        if (stopped || !mounted.current) return
        const next = URL.createObjectURL(blob)
        const previous = frameRef.current
        frameRef.current = next
        setFrame(next)
        if (previous) URL.revokeObjectURL(previous)
      } catch { /* Retry after background tabs, navigation, or transient CDP teardown. */ }
      finally { busy.current = false }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 900)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [show, snapshot.available, snapshot.tabId, collapsed])

  useEffect(() => () => {
    if (frameRef.current) URL.revokeObjectURL(frameRef.current)
  }, [])

  useEffect(() => {
    if (snapshot.tabId !== currentTab.current) {
      currentTab.current = snapshot.tabId
      setAddress(snapshot.url || '')
    } else if (snapshot.url && document.activeElement?.getAttribute('data-mini-address') !== 'true') {
      setAddress(snapshot.url)
    }
  }, [snapshot.tabId, snapshot.url])

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement !== focusRef.current) setExpanded(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [expanded])

  const click = (event: MouseEvent<HTMLImageElement>) => {
    const position = point(event.currentTarget, event.clientX, event.clientY)
    event.currentTarget.focus()
    if (position) void run({ type: 'click', ...position })
  }
  const wheel = (event: WheelEvent<HTMLImageElement>) => {
    const position = point(event.currentTarget, event.clientX, event.clientY)
    if (position) void run({ type: 'scroll', ...position, deltaY: event.deltaY })
  }
  const keyboard = (event: KeyboardEvent<HTMLImageElement>) => {
    if (event.key === 'F5') { event.preventDefault(); void run({ type: 'reload' }); return }
    if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') return
    event.preventDefault()
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
    void run({ type: 'key', key: event.key, modifiers })
  }

  if (!supported) return null
  const viewer = (
    <section className={css.browser} data-mini-browser data-expanded={expanded ? 'true' : undefined} aria-label="Navegador de Kira">
      <div className={css.titlebar}>
        <span className={css.brand}>◉ <span>Navegador de Kira</span></span>
        <span className={css.status}>{snapshot.available ? 'Chrome · En vivo' : 'Listo para iniciar'}</span>
        <span className={css.grow} />
        <button type="button" title={expanded ? 'Volver al chat' : 'Ampliar navegador'} onClick={() => { setExpanded(value => !value); setCollapsed(false) }}>
          {expanded ? '↙ Volver al chat' : '⛶ Ampliar'}
        </button>
        {!expanded && <button type="button" title={collapsed ? 'Mostrar navegador' : 'Contraer navegador'} onClick={() => { setCollapsed(value => !value) }}>{collapsed ? '▢' : '−'}</button>}
        <button type="button" title="Ocultar microventana" onClick={() => { setDismissed(true); setEnabled(false); setCollapsed(true); setExpanded(false) }}>×</button>
      </div>
      {!collapsed && <>
        <div className={css.tabs} role="tablist" aria-label="Pestañas">
          {snapshot.tabs.map(tab => (
            <div className={css.tabWrap} key={tab.id}>
              <button type="button" role="tab" aria-selected={tab.id === snapshot.tabId}
                className={tab.id === snapshot.tabId ? css.activeTab : undefined}
                onClick={() => { void run({ type: 'select-tab', tabId: tab.id }) }}>{tab.title || 'Nueva pestaña'}</button>
              <button type="button" aria-label={'Cerrar pestaña ' + (tab.title || tab.id)} className={css.tabClose}
                onClick={() => { void run({ type: 'close-tab', tabId: tab.id }) }}>×</button>
            </div>
          ))}
          <button type="button" title="Nueva pestaña" onClick={() => { void run({ type: 'new-tab', url: 'https://www.google.com' }) }}>+</button>
        </div>
        <form className={css.toolbar} onSubmit={event => { event.preventDefault(); void run({ type: 'open', url: address }) }}>
          <button type="button" aria-label="Atrás" onClick={() => { void run({ type: 'back' }) }}>←</button>
          <button type="button" aria-label="Adelante" onClick={() => { void run({ type: 'forward' }) }}>→</button>
          <button type="button" aria-label="Recargar" onClick={() => { void run({ type: 'reload' }) }}>↻</button>
          <input data-mini-address="true" aria-label="Dirección web" type="text" spellCheck={false}
            placeholder="Buscar o escribir una dirección"
            value={address} onChange={event => { setAddress(event.currentTarget.value) }} />
          <button type="submit">Ir</button>
        </form>
        {snapshot.available ? (
          <div className={css.viewport}>
            {frame ? <img ref={focusRef} src={frame} alt={'Página actual: ' + (snapshot.title || snapshot.url || '')}
              role="button" aria-label="Controlar página con el ratón y el teclado"
              tabIndex={0} draggable={false} onClick={click} onWheel={wheel} onKeyDown={keyboard}
              className={css.screen} /> : <div className={css.loading}>Conectando imagen del navegador…</div>}
          </div>
        ) : (
          <div className={css.empty}>
            <p>Chrome real dentro de la conversación. Kira y tú utilizáis las mismas pestañas.</p>
            <button type="button" onClick={() => { void run({ type: 'open', url: 'https://www.google.com' }) }}>Iniciar navegador</button>
          </div>
        )}
        <form className={css.typeRow} onSubmit={event => { event.preventDefault(); if (typed) { void run({ type: 'text', text: typed }); setTyped(''); focusRef.current?.focus() } }}>
          <input aria-label="Escribir en la página" placeholder="Escribe en el campo seleccionado…" value={typed} onChange={event => { setTyped(event.currentTarget.value) }} />
          <button type="submit" disabled={!snapshot.available || !typed}>Escribir</button>
          <button type="button" disabled={!snapshot.available} onClick={() => { void run({ type: 'key', key: 'Enter' }) }}>Enter</button>
          <button type="button" disabled={!snapshot.available} onClick={() => { void run({ type: 'key', key: 'Tab' }) }}>Tab</button>
        </form>
        {error && <p className={css.error} role="alert">{error}</p>}
        <p className={css.hint}>Haz clic en la imagen para interactuar. «Ampliar» conserva la pestaña y la sesión.</p>
      </>}
    </section>
  )
  return <>
    {!expanded && <div className={css.inline}>{show ? viewer : (
      <button type="button" className={css.launch} onClick={() => { setDismissed(false); setCollapsed(false); setEnabled(true); void run({ type: 'open', url: 'https://www.google.com' }) }}>
        ◉ Abrir navegador
      </button>
    )}</div>}
    {expanded && createPortal(<div className={css.overlay} role="presentation">{viewer}</div>, document.body)}
  </>
}
