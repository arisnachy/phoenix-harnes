import { useEffect, useRef, useState } from 'react'
import type { ComposerCaptureProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import { capturePresenceFrame } from './presence-capture.ts'
import css from './CaptureTools.module.css'

/** Compact, user-initiated capture tools; never submit or retain a live stream. */
export function CaptureTools({ canAcceptDrop, onAddImages, t }: ComposerCaptureProps) {
  const capture = useRef<AbortController | null>(null)
  const owner = useRef(onAddImages)
  owner.current = onAddImages
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => () => {
    capture.current?.abort()
    capture.current = null
  }, [])
  useEffect(() => {
    if (!canAcceptDrop) capture.current?.abort()
  }, [canAcceptDrop])
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(false), 5000)
    return () => window.clearTimeout(timer)
  }, [error])

  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  const screen = typeof media?.getDisplayMedia === 'function'
  const camera = typeof media?.getUserMedia === 'function'
  if (!screen && !camera) return null

  const start = async (source: 'screen' | 'camera'): Promise<void> => {
    if (!canAcceptDrop || capture.current !== null) return
    const controller = new AbortController()
    const target = onAddImages
    capture.current = controller
    setCapturing(true)
    setError(false)
    try {
      const file = await capturePresenceFrame(controller.signal, source)
      if (!controller.signal.aborted && capture.current === controller && owner.current === target) target([file])
    } catch (cause) {
      if (!controller.signal.aborted && capture.current === controller
        && !(cause instanceof DOMException && cause.name === 'NotAllowedError')) setError(true)
    } finally {
      if (capture.current === controller) {
        capture.current = null
        setCapturing(false)
      }
    }
  }

  return (
    <div className={css.tools} data-phoenix-capture-tools>
      {capturing ? (
        <button type="button" className={css.tool} title={t('image.cancelCapture')}
          aria-label={t('image.cancelCapture')} onClick={() => capture.current?.abort()}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      ) : (
        <>
          {screen && <button type="button" className={css.tool} title={t('image.captureScreen')}
            aria-label={t('image.captureScreen')} disabled={!canAcceptDrop} onClick={() => { void start('screen') }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8m-4-4v4M9 10h6m-3-3v6" />
            </svg>
          </button>}
          {camera && <button type="button" className={css.tool} title={t('image.captureCamera')}
            aria-label={t('image.captureCamera')} disabled={!canAcceptDrop} onClick={() => { void start('camera') }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h4l2-3h4l2 3h4a1 1 0 0 1 1 1v11H3V8a1 1 0 0 1 1-1Z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </button>}
        </>
      )}
      {error && <span className={css.error} role="status">{t('image.captureFailed')}</span>}
    </div>
  )
}
