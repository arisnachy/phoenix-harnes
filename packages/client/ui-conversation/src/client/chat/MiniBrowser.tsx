/**
 * A real Chromium viewport inside the conversation, fed by the same local CDP
 * tab Kira controls. No website iframe, hidden scripts, fake screenshots or
 * model-generated browser states. Fullscreen is a larger view of SAME tab.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Modal } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './MiniBrowser.module.css'

type Tab = { id: string; title: string; url: string }
type Snapshot = { available: boolean; tabId?: string; url?: string; title?: string; tabs: Tab[] }
type Command = {
  type: string
  url?: string
  tabId?: string
  x?: number
  y?: number
  deltaY?: number
  key?: string
  text?: string
  modifiers?: number
}
const API = '/phoenix-mini-browser'
const HEADERS = { 'x-phoenix-mini-browser': '1' }
const BLANK: Snapshot = { available: false, tabs: [] }

async function decode<T>(response: Response): Promise<T> {
  // Host restarts, interrupted connections and 204 responses may carry no JSON.
  // Never let Response.json() expose a raw SyntaxError to the MiniBrowser UI.
  const body = await response.text()
  const fallback = response.ok
    ? 'El navegador devolvió una respuesta vacía. Phoenix reintentará la conexión.'
    : 'El servidor del navegador no está disponible (HTTP ' + response.status + '). Phoenix reintentará la conexión.'
  if (!body.trim()) throw new Error(fallback)
  let data: unknown
  try {
    data = JSON.parse(body) as unknown
  } catch {
    throw new Error('Respuesta incompleta del navegador (HTTP ' + response.status + '). Phoenix reintentará la conexión.')
  }
  if (!response.ok) {
    const message = data !== null && typeof data === 'object' && 'error' in data
      && typeof data.error === 'string' ? data.error : fallback
    throw new Error(message)
  }
  return data as T
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
export function MiniBrowser({ requested = false, active = true, onActivate, autoScroll = true, onPageChange }: {
  requested?: boolean
  active?: boolean
  onActivate?: () => void
  autoScroll?: boolean
  onPageChange?: (page: { title: string; url: string } | null) => void
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(BLANK)
  const [enabled, setEnabled] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [address, setAddress] = useState('')
  const [typed, setTyped] = useState('')
  const [playingVideo, setPlayingVideo] = useState(false)
  const [videoSurface, setVideoSurface] = useState(true)
  const [frame, setFrame] = useState<string>()
  const [error, setError] = useState<string>()
  const [connectionError, setConnectionError] = useState<string>()
  const [captureError, setCaptureError] = useState<string>()
  const [mediaCaptureState, setMediaCaptureState] = useState<'idle' | 'recording' | 'uploading' | 'ready'>('idle')
  const [mediaCaptureMessage, setMediaCaptureMessage] = useState<string>()
  const stopMediaCapture = useRef<(() => void) | undefined>(undefined)
  const focusRef = useRef<HTMLImageElement>(null)
  const inlineRef = useRef<HTMLDivElement>(null)
  const currentTab = useRef<string | undefined>(undefined)
  const lastObservedUrl = useRef<string | undefined>(undefined)
  const busy = useRef(false)
  const mounted = useRef(true)
  const frameRef = useRef<string | undefined>(undefined)
  // Each card is bound to the Chromium target it originally displayed.
  // New browser requests never overwrite prior cards with the latest page.
  const cardTabId = useRef<string | undefined>(undefined)
  const previousActive = useRef(active)
  const show = !dismissed && (requested || enabled || (snapshot.available && snapshot.url !== undefined && snapshot.url !== 'about:blank'))
  const videoId = youtubeId(snapshot.url)

  // The card is mounted after the chat flow. A late CDP connection changes
  // its height without changing chat message IDs; bring the result into view
  // once instead of leaving it invisibly below the last Kira bubble.
  useEffect(() => {
    if (!autoScroll || !requested || !show || expanded || !active) return
    const element = inlineRef.current
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  }, [autoScroll, requested, show, expanded, active, snapshot.tabId, snapshot.url])

  useEffect(() => {
    onPageChange?.(snapshot.available && snapshot.url
      ? { title: snapshot.title ?? '', url: snapshot.url } : null)
  }, [snapshot.available, snapshot.url, snapshot.title, onPageChange])

  const run = useCallback(async (request: Command): Promise<void> => {
    try {
      setError(undefined)
      const scoped = request.type === 'new-tab' || request.type === 'start'
        ? request
        : { ...request, ...request.tabId === undefined && cardTabId.current !== undefined
          ? { tabId: cardTabId.current }
          : {} }
      const state = await command(scoped)
      if (state.tabId !== undefined) cardTabId.current = state.tabId
      setSnapshot(state)
      if (request.type === 'open' || request.type === 'new-tab' || request.type === 'start') setEnabled(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    if (!active || dismissed) return
    mounted.current = true
    const first = new AbortController()
    const selection = !previousActive.current && cardTabId.current !== undefined
      // Wait for the old target to become active BEFORE inspecting it; otherwise
      // a race with the newest tab could accidentally overwrite this card.
      ? command({ type: 'select-tab', tabId: cardTabId.current }).then(() => undefined, () => undefined)
      : Promise.resolve()
    previousActive.current = active
    // A requested browser is an instruction to start the embedded Chromium,
    // not merely to show a disconnected card with a manual Connect button.
    // One poll at a time avoids competing CDP sessions during slow Windows boots.
    let polling = false
    let nextStartAt = 0
    const poll = async (): Promise<void> => {
      if (polling) return
      polling = true
      try {
        await selection
        if (first.signal.aborted) return
        let state: Snapshot | undefined
        let inspectError: unknown
        try {
          state = await inspect(first.signal)
        } catch (reason) {
          inspectError = reason
        }
        if (first.signal.aborted) return
        if (requested && (!state || !state.available) && Date.now() >= nextStartAt) {
          // Retry a failed/missing CDP instance without hot-looping, and keep
          // the original card alive across Host restarts.
          nextStartAt = Date.now() + 10_000
          state = await command({ type: 'start' })
        }
        if (first.signal.aborted) return
        if (state === undefined) throw inspectError ?? new Error('Chromium no respondió.')
        setConnectionError(undefined)
        if (state.tabId !== undefined) cardTabId.current = state.tabId
        setSnapshot(state)
      } catch (reason) {
        if (!first.signal.aborted) {
          setConnectionError(reason instanceof Error ? reason.message : String(reason))
        }
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1700)
    return () => {
      mounted.current = false
      previousActive.current = false
      first.abort()
      window.clearInterval(timer)
    }
  }, [active, dismissed, requested])

  useEffect(() => {
    if (!active || !show || !snapshot.available || collapsed || playingVideo) return
    let stopped = false
    const load = async () => {
      // Hidden Phoenix tabs need no expensive Chromium JPEG capture.
      // A visibility event below refreshes the frame when the user returns.
      if (document.visibilityState === 'hidden' || busy.current) return
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
        setCaptureError(undefined)
        if (previous) URL.revokeObjectURL(previous)
      } catch (reason) {
        if (!stopped) setCaptureError(reason instanceof Error ? reason.message : String(reason))
        // A failed screenshot does not discard the last successful frame,
        // the selected Chromium tab, or the user's navigation controls.
      }
      finally { busy.current = false }
    }
    void load()
    // A continuous 350/600 ms JPEG capture loop competed with CDP form
    // filling for browser time. Keep the preview live but substantially
    // reduce screenshot overhead. DOM-driven actions are not polled here.
    const timer = window.setInterval(() => { void load() }, expanded ? 1100 : 1600)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [active, show, dismissed, snapshot.available, snapshot.tabId, collapsed, playingVideo, expanded])

  useEffect(() => () => {
    if (frameRef.current) URL.revokeObjectURL(frameRef.current)
  }, [])

  useEffect(() => {
    if (snapshot.url && snapshot.url !== 'about:blank' && snapshot.url !== lastObservedUrl.current) {
      setDismissed(false)
      setCollapsed(false)
    }
    if (snapshot.url !== lastObservedUrl.current) { setPlayingVideo(false); setVideoSurface(true) }
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
    if (!expanded) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement !== focusRef.current) setExpanded(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [expanded])

  const click = (event: MouseEvent<HTMLImageElement>) => {
    if (!active) { onActivate?.(); return }
    const position = point(event.currentTarget, event.clientX, event.clientY)
    event.currentTarget.focus()
    if (position) void run({ type: 'click', ...position })
  }
  const wheel = (event: WheelEvent<HTMLImageElement>) => {
    if (!active) { onActivate?.(); return }
    const position = point(event.currentTarget, event.clientX, event.clientY)
    if (position) void run({ type: 'scroll', ...position, deltaY: event.deltaY })
  }
  const keyboard = (event: KeyboardEvent<HTMLImageElement>) => {
    if (!active) { onActivate?.(); return }
    if (event.key === 'F5') { event.preventDefault(); void run({ type: 'reload' }); return }
    if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') return
    event.preventDefault()
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
    void run({ type: 'key', key: event.key, modifiers })
  }

  /** Capture only after the user opens Chrome's native sharing prompt.
   * This is independent of Kira's muted headless YouTube player.
   */
  const startMediaCapture = async () => {
    if (stopMediaCapture.current) return
    let stream: MediaStream | undefined
    try {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Chrome no permite compartir pestaña desde esta sesión.')
      }
      // The browser MUST show its native tab chooser; no hidden auto-capture.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 }, audio: true,
      })
      if (stream.getAudioTracks().length === 0) {
        throw new Error('Activa «Compartir audio de la pestaña» en el selector de Chrome.')
      }
      const format = ['video/webm;codecs=vp8,opus', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type))
      if (!format) throw new Error('Este Chrome no puede grabar video WebM.')
      const recorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 1_200_000 })
      const recorded: Blob[] = []
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer)
        stream?.getTracks().forEach(track => track.stop())
        stopMediaCapture.current = undefined
      }
      recorder.ondataavailable = event => { if (event.data.size > 0) recorded.push(event.data) }
      recorder.onerror = () => {
        done = true
        cleanup()
        setMediaCaptureState('idle')
        setMediaCaptureMessage('Falló la grabación. Puedes intentarlo de nuevo.')
      }
      recorder.onstop = () => {
        if (done) return
        done = true
        cleanup()
        const blob = new Blob(recorded, { type: 'video/webm' })
        if (blob.size < 128 || blob.size > 24 * 1024 * 1024) {
          setMediaCaptureState('idle')
          setMediaCaptureMessage('La grabación está vacía o excede 24 MB.')
          return
        }
        setMediaCaptureState('uploading')
        void (async () => {
          try {
            const response = await fetch(API + '/capture', {
              method: 'POST', headers: { ...HEADERS, 'content-type': 'video/webm' },
              body: blob, cache: 'no-store',
            })
            const result = await decode<{ captureId: string }>(response)
            setMediaCaptureState('ready')
            setMediaCaptureMessage('Grabación recibida (' + result.captureId.slice(0, 8)
              + '). Escribe a Kira: «Analiza la grabación compartida con video_media_inspect». Solo el análisis confirma audio e imágenes.')
          } catch (error) {
            setMediaCaptureState('idle')
            setMediaCaptureMessage('No se pudo guardar la grabación: ' + String(error))
          }
        })()
      }
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (recorder.state !== 'inactive') recorder.stop()
        }, {once:true})
      }
      recorder.start(1000)
      stopMediaCapture.current = () => {
        if (recorder.state !== 'inactive') recorder.stop()
      }
      timer = setTimeout(() => { stopMediaCapture.current?.() }, 30_000)
      setMediaCaptureState('recording')
      setMediaCaptureMessage('Grabando hasta 30 segundos. Reproduce el video en la pestaña seleccionada.')
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop())
      setMediaCaptureState('idle')
      setMediaCaptureMessage(error instanceof Error ? error.message : String(error))
    }
  }

  // No browser chrome in ordinary greetings or unrelated conversations.
  // A deliberate request or an existing real Chromium tab is required.
  if (!show) return null
  const viewer = (
    <section className={css.browser} data-mini-browser data-expanded={expanded ? 'true' : undefined} aria-label="Navegador de Kira">
      <div className={css.titlebar}>
        <span className={css.brand}>◉ <span>Navegador de Kira</span></span>
        <span className={css.status}>{!active ? 'Vista conservada' : snapshot.available ? 'Chrome · En vivo' : 'Listo para iniciar'}</span>
        {!active && <button type="button" title="Reactivar esta página" onClick={() => { onActivate?.() }}>↻ Reactivar</button>}
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
        <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void run({ type: 'open', url: address }) }}>
          <button type="button" aria-label="Atrás" onClick={() => { void run({ type: 'back' }) }}>←</button>
          <button type="button" aria-label="Adelante" onClick={() => { void run({ type: 'forward' }) }}>→</button>
          <button type="button" aria-label="Recargar" onClick={() => { void run({ type: 'reload' }) }}>↻</button>
          <input data-mini-address="true" aria-label="Dirección web" type="text" spellCheck={false}
            placeholder="Buscar o escribir una dirección"
            value={address} onChange={(event) => { setAddress(event.currentTarget.value) }} />
          <button type="submit">Ir</button>
        </form>
        {snapshot.available ? (
          <div className={css.viewport}>
            {videoSurface && videoId ? (
              <iframe className={css.player}
                title="Reproductor YouTube"
                src={'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=' + (playingVideo ? '1' : '0') + '&playsinline=1'}
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
            <p>{connectionError
              ? 'Phoenix todavía no ha conectado la vista del navegador. Puedes reintentar sin salir del chat.'
              : 'Chrome real dentro de la conversación. Kira y tú utilizáis las mismas pestañas.'}</p>
            <button type="button" onClick={() => { void run({ type: 'start' }) }}>Conectar navegador</button>
          </div>
        )}
        <div className={css.mediaBar}>
          {videoId && <>
            <button type="button" onClick={() => { setVideoSurface(true); setPlayingVideo(true) }}>
              ▶ Reproducir con audio
            </button>
            <button type="button" onClick={() => { setVideoSurface(false); setPlayingVideo(false) }}>
              ◧ Ver navegador de Kira
            </button>
            <button type="button" onClick={() => { setVideoSurface(true); setPlayingVideo(false) }}>
              ▣ Ver video
            </button>
          </>}
          <button type="button" disabled={!active || mediaCaptureState === 'uploading'}
            aria-label={mediaCaptureState === 'recording' ? 'Detener captura de pestaña' : 'Compartir pestaña para Kira'}
            onClick={() => mediaCaptureState === 'recording'
              ? stopMediaCapture.current?.() : void startMediaCapture()}>
            {mediaCaptureState === 'recording' ? '■ Detener captura' : '◉ Compartir pestaña para Kira'}
          </button>
          <span>Si Kira no puede ver ni escuchar el video, abre el video en Chrome normal y pulsa «Compartir pestaña para Kira». Selecciona Pestaña de Chrome y marca «Compartir audio». Grabación máxima: 30 segundos.</span>
        </div>
        {mediaCaptureMessage && <p className={css.captureStatus} role="status">{mediaCaptureMessage}</p>}
        <form className={css.typeRow} onSubmit={(event) => { event.preventDefault(); if (typed) { void run({ type: 'text', text: typed }); setTyped(''); focusRef.current?.focus() } }}>
          <input aria-label="Escribir en la página" placeholder="Escribe en el campo seleccionado…" value={typed} onChange={(event) => { setTyped(event.currentTarget.value) }} />
          <button type="submit" disabled={!snapshot.available || !typed}>Escribir</button>
          <button type="button" disabled={!snapshot.available} onClick={() => { void run({ type: 'key', key: 'Enter' }) }}>Enter</button>
          <button type="button" disabled={!snapshot.available} onClick={() => { void run({ type: 'key', key: 'Tab' }) }}>Tab</button>
        </form>
        {captureError && active && <p className={css.error} role="status">
          La página está abierta, pero su imagen todavía no está disponible: {captureError}. Phoenix reintentará la captura automáticamente.
        </p>}
        {connectionError && <p className={css.error} role="status">Conexión del navegador: {connectionError}</p>}
        {error && <p className={css.error} role="alert">{error}</p>}
        <p className={css.hint}>Haz clic en la imagen para interactuar. «Ampliar» conserva la pestaña y la sesión.</p>
      </>}
      {snapshot.available && <div className={css.externalActions}>
        <button type="button" title="Abrir esta página en Chrome completo" onClick={() => { void run({ type: 'open-external' }) }}>
          ↗ Abrir navegador completo
        </button>
      </div>}
    </section>
  )
  return <>
    {/* Keep focus signaling in-flow even when the browser is portaled fullscreen. */}
    <span hidden data-mini-browser-focus={expanded || !collapsed ? 'true' : undefined} />
    {!expanded && <div ref={inlineRef} className={css.inline}>{viewer}</div>}
    {expanded && <Modal open headless className={css.expandedDialog ?? ''} title="Navegador de Kira" onClose={() => { setExpanded(false) }}>{viewer}</Modal>}
  </>
}
