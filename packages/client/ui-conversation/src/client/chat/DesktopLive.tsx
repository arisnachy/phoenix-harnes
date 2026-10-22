/** Live native Windows application frames from the current conversation only. */
import { useEffect, useRef, useState } from 'react'
import css from './DesktopLive.module.css'

interface DesktopState { available: boolean; paused: boolean; title: string; reason: string }
const HEADERS = { 'x-phoenix-mini-browser': '1' }
const EMPTY: DesktopState = { available: false, paused: false, title: '', reason: 'Conectando con Desktop Live…' }

export function DesktopLive({ sessionId, active }: { sessionId: string; active: boolean }) {
  const [status, setStatus] = useState<DesktopState>(EMPTY)
  const [image, setImage] = useState<string>()
  const [collapsed, setCollapsed] = useState(false)
  const imageRef = useRef<string>()
  useEffect(() => {
    if (!active || collapsed) return
    let stopped = false
    let busy = false
    const request = new AbortController()
    const url = '/phoenix-desktop-live/'
    const suffix = '?sessionId=' + encodeURIComponent(sessionId)
    const poll = async () => {
      if (busy || stopped || document.hidden) return
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
        setImage(next)
        if (previous) URL.revokeObjectURL(previous)
      } catch (error) {
        if (!stopped) {
          setStatus({ available: false, paused: false, title: '', reason: error instanceof Error ? error.message : 'Desktop Live no disponible.' })
        }
      } finally { busy = false }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1250)
    return () => {
      stopped = true
      request.abort()
      window.clearInterval(timer)
    }
  }, [sessionId, active, collapsed])
  useEffect(() => () => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current)
  }, [])

  return (
    <section className={css.root} data-chat-flow-kind="desktop-live" aria-label="Phoenix Desktop Live">
      <header className={css.header}>
        <strong>▣ Desktop Live</strong>
        <span className={css.status}>{status.available
          ? status.paused ? 'Pausado' : 'Ventana real'
          : 'Sin conexión'}</span>
        <button type="button" aria-label={collapsed ? 'Mostrar Desktop Live' : 'Contraer Desktop Live'}
          onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Mostrar' : 'Contraer'}</button>
      </header>
      {!collapsed && (status.available && image
        ? <div className={css.viewport}>
          <img className={css.frame} src={image} alt={'Captura real de ' + (status.title || 'la aplicación Windows')} />
          <div className={css.caption}>{status.title || 'Aplicación Windows'} · Captura de la sesión actual</div>
        </div>
        : <div className={css.empty}>
          <strong>No hay una aplicación verificada en Desktop Live.</strong>
          <p>{status.reason || 'Kira debe iniciar Computer Use y seleccionar una ventana real.'}</p>
          <p>El visor se activa cuando <code>computer</code> controla una ventana desde esta conversación. El navegador web por sí solo no abre Paint.</p>
        </div>)}
    </section>
  )
}
