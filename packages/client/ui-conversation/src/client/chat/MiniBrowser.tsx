/**
 * A real Chromium viewport inside the conversation, fed by the same local CDP
 * tab Kira controls. No website iframe, hidden scripts, fake screenshots or
 * model-generated browser states. Fullscreen is a larger view of SAME tab.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Modal } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './MiniBrowser.module.css'

type Tab = { id: string; title: string; url: string }
type Snapshot = { available: boolean; tabId?: string; url?: string; title?: string; tabs: Tab[] }
type VaultStatus = { supported: boolean; origin?: string; configured: boolean; requiresUser?: boolean }
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
  const response = await fetch(API + '/state', { headers: HEADERS, ...(signal === undefined ? {} : { signal }), cache: 'no-store' })
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
/** Only official YouTube watch URLs qualify for the native video/audio player. */
function youtubeId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
      || url.protocol !== 'https:' || url.pathname !== '/watch') return undefined
    const id = url.searchParams.get('v')
    return id !== null && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined
  } catch { return undefined }
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
  const [playingVideo, setPlayingVideo] = useState(false)
  const [frame, setFrame] = useState<string>()
  const [error, setError] = useState<string>()
  const [supported, setSupported] = useState(false)
  const [vault, setVault] = useState<VaultStatus>()
  const [vaultOpen, setVaultOpen] = useState(false)
  const [vaultPending, setVaultPending] = useState(false)
  const focusRef = useRef<HTMLImageElement>(null)
  const currentTab = useRef<string | undefined>(undefined)
  const lastObservedUrl = useRef<string | undefined>(undefined)
  const busy = useRef(false)
  const mounted = useRef(true)
  const frameRef = useRef<string | undefined>(undefined)
  const show = !dismissed && (enabled || (snapshot.available && snapshot.url !== undefined && snapshot.url !== 'about:blank'))
  const videoId = youtubeId(snapshot.url)

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
    if (!show || !snapshot.available || collapsed || playingVideo) return
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
    const timer = window.setInterval(() => { void load() }, expanded ? 350 : 600)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [show, snapshot.available, snapshot.tabId, collapsed, playingVideo, expanded])

  useEffect(() => () => {
    if (frameRef.current) URL.revokeObjectURL(frameRef.current)
  }, [])

  useEffect(() => {
    if (snapshot.url && snapshot.url !== 'about:blank' && snapshot.url !== lastObservedUrl.current) {
      setDismissed(false)
      setCollapsed(false)
    }
    if (snapshot.url !== lastObservedUrl.current) setPlayingVideo(false)
    lastObservedUrl.current = snapshot.url
  }, [snapshot.url])

  useEffect(() => {
    if (snapshot.tabId !== currentTab.current) {
      currentTab.current = snapshot.tabId
      setAddress(snapshot.url || '')
    } else if (snapshot.url && document.activeElement?.getAttribute('data-mini-address') !== 'true') {
      setAddress(snapshot.url)
    }
  }, [snapshot.tabId, snapshot.url])

  useEffect(() => {
    if (!snapshot.available || !snapshot.url) { setVault(undefined); return }
    let active = true
    void fetch(API + '/vault', { headers: HEADERS, cache: 'no-store' })
      .then(async response => await decode<VaultStatus>(response))
      .then(value => {
        if (!active) return
        setVault(value)
        if (value.requiresUser && value.origin && !vaultOpen) setVaultOpen(true)
      })
      .catch(() => { if (active) setVault(undefined) })
    return () => { active = false }
  }, [snapshot.url, snapshot.available, snapshot.tabId, vaultOpen])

  const submitVault = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (vaultPending || !vault?.origin) return
    setVaultPending(true)
    try {
      const form = event.currentTarget
      const data = new FormData(form)
      const account = String(data.get('account') ?? '')
      const secret = String(data.get('secret') ?? '')
      const remember = data.get('remember') === 'on'
      const response = await fetch(API + '/vault', {
        method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'connect', origin: vault.origin, account, secret, remember }),
        cache: 'no-store',
      })
      form.reset()
      const result = await decode<{ phase: string; configured: boolean }>(response)
      if (result.phase === 'fields-not-found') {
        setError('No se encontraron campos de acceso. Abre primero la página de inicio de sesión.')
      } else {
        setError(undefined)
        setVault(value => value ? { ...value, configured: result.configured } : value)
        setVaultOpen(false)
      }
    } catch {
      setError('No se pudo conectar el sitio. Verifica el dominio y las credenciales.')
    } finally { setVaultPending(false) }
  }

  const dismissVault = (): void => {
    setVaultOpen(false)
    if (!vault?.origin) return
    void fetch(API + '/vault', {
      method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'dismiss', origin: vault.origin }),
    }).catch(() => undefined)
  }

  const forgetVault = async (): Promise<void> => {
    if (!vault?.origin || !window.confirm('¿Olvidar las credenciales de ' + vault.origin + '?')) return
    setVaultPending(true)
    try {
      const response = await fetch(API + '/vault', {
        method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'forget', origin: vault.origin }), cache: 'no-store',
      })
      await decode<{ forgotten: boolean }>(response)
      setVault(value => value ? { ...value, configured: false } : value)
      setVaultOpen(false)
    } catch { setError('No se pudo eliminar el acceso guardado.') }
    finally { setVaultPending(false) }
  }

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
          {vault?.supported && vault.origin && <button type="button" title="Acceso protegido con DPAPI"
            onClick={() => { setVaultOpen(true); setError(undefined) }}>Acceso seguro</button>}
        </form>
        {snapshot.available ? (
          <div className={css.viewport}>
            {playingVideo && videoId ? (
              <iframe className={css.player}
                title="Reproductor YouTube"
                src={'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=1'}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : frame ? <img ref={focusRef} src={frame} alt={'Página actual: ' + (snapshot.title || snapshot.url || '')}
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
        {videoId && <div className={css.mediaBar}>
          <button type="button" onClick={() => { setPlayingVideo(current => !current) }}>
            {playingVideo ? '↩ Volver al navegador' : '▶ Reproducir con audio'}
          </button>
          <span>Reproductor oficial; la pestaña de Kira permanece abierta.</span>
        </div>}
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
    {expanded && <Modal open headless className={css.expandedDialog ?? ''} title="Navegador de Kira" onClose={() => { setExpanded(false) }}>{viewer}</Modal>}
    {vaultOpen && vault?.origin && <Modal open title="Acceso seguro al sitio" onClose={() => { if (!vaultPending) dismissVault() }}>
      <div className={css.vaultBox}>
        <strong>{vault.origin}</strong>
        <p>Solo se guardarán las credenciales de este dominio. Kira no tendrá acceso a tu contraseña.</p>
        <form onSubmit={event => { void submitVault(event) }} autoComplete="off">
          <label>Usuario o correo
            <input name="account" required autoComplete="username" maxLength={4096} />
          </label>
          <label>Contraseña
            <input name="secret" type="password" required autoComplete="current-password" maxLength={16384} />
          </label>
          <label className={css.vaultConsent}>
            <input type="checkbox" name="remember" />
            Cifrar en el vault de Windows y autorizar futuros accesos a este dominio
          </label>
          <div className={css.vaultActions}>
            <button disabled={vaultPending} type="submit">{vaultPending ? 'Conectando…' : 'Conectar'}</button>
            <button disabled={vaultPending} type="button" onClick={dismissVault}>Cancelar</button>
            {vault.configured && <button disabled={vaultPending} type="button" onClick={() => { void forgetVault() }}>Olvidar acceso</button>}
          </div>
        </form>
      </div>
    </Modal>}
  </>
}
