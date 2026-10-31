/** Session-scoped native screenshots and an opt-in browser window video preview. */
import { useCallback, useEffect, useRef, useState } from 'react'
import css from './DesktopLive.module.css'

interface DesktopState { available: boolean; paused: boolean; title: string; reason: string; source?: 'native' | 'observation' }
const HEADERS = { 'x-phoenix-mini-browser': '1' }
const EMPTY: DesktopState = { available: false, paused: false, title: '', reason: 'Conectando con Desktop Live…' }

/** Whether a browser capture is pinned to one app rather than recording the desktop or chat.
 * @param track - User-authorized media capture track.
 * @returns True only for a browser-reported single application window.
 */
export function isWindowCapture(track: MediaStreamTrack): boolean {
  return track.getSettings().displaySurface === 'window'
}

export function DesktopLive({ sessionId, active }: { sessionId: string; active: boolean }) {
  const [status, setStatus] = useState<DesktopState>(EMPTY)
  const [image, setImage] = useState<string>()
  const [collapsed, setCollapsed] = useState(false)
  const [live, setLive] = useState<MediaStream | null>(null)
  const [liveOwner, setLiveOwner] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState('')
  const imageRef = useRef<string>()
  const imageOwnerRef = useRef(sessionId)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const owningSessionRef = useRef(sessionId)
  const activeRef = useRef(active)
  const mountedRef = useRef(false)
  activeRef.current = active

  const stopSharing = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) =>{  track.stop() })
    setLive(null)
    setLiveOwner(null)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopSharing() }
  }, [stopSharing])

  useEffect(() => {
    owningSessionRef.current = sessionId
    setCaptureError('')
    setStatus(EMPTY)
    setImage(undefined)
    // Sharing is a per-conversation, user-authorized session, not a global desktop feed.
    return () => { stopSharing() }
  }, [sessionId, stopSharing])

  useEffect(() => {
    if (!active) stopSharing()
  }, [active, stopSharing])

  useEffect(() => {
    if (videoRef.current === null) return
    videoRef.current.srcObject = live
    if (live !== null) void videoRef.current.play().catch(() => {
      setCaptureError('El navegador no pudo reproducir la ventana compartida.')
    })
    return () => {
      if (videoRef.current !== null) videoRef.current.srcObject = null
    }
  }, [live, collapsed])

  const startSharing = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError('Este navegador no permite compartir una ventana en directo.')
      return
    }
    const owner = sessionId
    setCaptureError('')
    try {
      // A deliberate user gesture is required by Chrome. Never capture a desktop silently.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: 15 },
        audio: false,
      })
      const track = stream.getVideoTracks()[0]
      if (!track || !isWindowCapture(track)) {
        stream.getTracks().forEach((item) =>{  item.stop() })
        setCaptureError('Selecciona una ventana de aplicación (no pantalla completa ni pestaña).')
        return
      }
      if (owner !== owningSessionRef.current || !activeRef.current || !mountedRef.current) {
        stream.getTracks().forEach((item) =>{  item.stop() })
        return
      }
      stopSharing()
      track.addEventListener('ended', () => {
        if (streamRef.current === stream) stopSharing()
      }, { once: true })
      streamRef.current = stream
      setLiveOwner(owner)
      setLive(stream)
    } catch (error) {
      setCaptureError(error instanceof Error && error.name === 'NotAllowedError'
        ? 'No se autorizó compartir la ventana.'
        : error instanceof Error ? error.message : 'No se pudo iniciar la captura.')
    }
  }

  useEffect(() => {
    if (!active || collapsed || live !== null) return
    let stopped = false
    let busy = false
    const request = new AbortController()
    const url = '/phoenix-desktop-live/'
    const suffix = '?sessionId=' + encodeURIComponent(sessionId)
    const poll = async () => {
      if (busy || stopped) return
      busy = true
      try {
        const stateResponse = await fetch(url + 'state' + suffix, {
          cache: 'no-store', headers: HEADERS, signal: request.signal,
        })
        if (!stateResponse.ok) throw new Error('El servidor de Desktop Live no respondió.')
        const state = await stateResponse.json() as DesktopState
        if (stopped || typeof state.available !== 'boolean') return
        setStatus(state)
        if (!state.available) {
          setImage(undefined)
          if (imageRef.current) URL.revokeObjectURL(imageRef.current)
          imageRef.current = undefined
          return
        }
        const frameResponse = await fetch(url + 'frame' + suffix, {
          cache: 'no-store', headers: HEADERS, signal: request.signal,
        })
        if (!frameResponse.ok) throw new Error('La aplicación no entregó una captura válida.')
        const blob = await frameResponse.blob()
        if (!blob.type.startsWith('image/png') || blob.size < 24) throw new Error('Captura PNG incorrecta.')
        if (stopped) return
        const next = URL.createObjectURL(blob)
        const previous = imageRef.current
        imageRef.current = next
        imageOwnerRef.current = sessionId
        setImage(next)
        if (previous) URL.revokeObjectURL(previous)
      } catch (error) {
        if (!stopped) {
          setStatus({ available: false, paused: false, title: '', reason: error instanceof Error ? error.message : 'Desktop Live no disponible.' })
        }
      } finally { busy = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 650)
    return () => {
      stopped = true
      request.abort()
      window.clearInterval(timer)
    }
  }, [sessionId, active, collapsed, live])

  useEffect(() => () => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current)
  }, [])

  const liveWindow = live !== null && liveOwner === sessionId
  const ownedImage = imageOwnerRef.current === sessionId ? image : undefined
  return (
    <section className={css.root} data-chat-flow-kind="desktop-live" aria-label="Phoenix Desktop Live">
      <header className={css.header}>
        <strong>▣ Desktop Live</strong>
        <span className={css.status}>{liveWindow ? 'Ventana en directo' : status.available
          ? status.paused ? 'Pausado' : status.source === 'observation' ? 'Captura reciente' : 'Captura nativa'
          : 'Sin conexión'}</span>
        <div className={css.actions}>
          <button type="button" onClick={() => { if (liveWindow) stopSharing(); else void startSharing() }}
            disabled={!active}>{liveWindow ? 'Detener directo' : 'Compartir ventana en directo'}</button>
          <button type="button" aria-label={collapsed ? 'Mostrar Desktop Live' : 'Contraer Desktop Live'}
            onClick={() =>{  setCollapsed(value => !value) }}>{collapsed ? 'Mostrar' : 'Contraer'}</button>
        </div>
      </header>
      {captureError && <p className={css.warning} role="alert">{captureError}</p>}
      {!collapsed && (liveWindow
        ? <div className={css.viewport}>
          <video ref={videoRef} className={css.frame} autoPlay muted playsInline aria-label="Ventana Windows compartida en tiempo real" />
          <div className={css.caption}>Vídeo de la ventana que seleccionaste · Cambiar de pestaña no cambia la ventana compartida. La captura no controla la aplicación.</div>
        </div>
        : status.available && ownedImage
          ? <div className={css.viewport}>
            <img className={css.frame} src={ownedImage} alt={'Captura real de ' + (status.title || 'la aplicación Windows')} />
            <div className={css.caption}>{status.title || 'Aplicación Windows'} · {status.source === 'observation'
              ? 'Último paso verificado (no vídeo). Usa «Compartir ventana en directo» para verla sin depender del foco.'
              : 'Capturas periódicas de la ventana seleccionada'}</div>
          </div>
          : <div className={css.empty}>
            <strong>No hay una aplicación verificada en Desktop Live.</strong>
            <p>{status.reason || 'Kira debe iniciar Computer Use y seleccionar una ventana real.'}</p>
            <p>Para ver Paint u otra aplicación continuamente desde Phoenix Web, pulsa «Compartir ventana en directo» y elige solo esa ventana. Tu autorización no se comparte con otras conversaciones.</p>
          </div>)}
    </section>
  )
}
