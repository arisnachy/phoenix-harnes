/** Explicit, user-initiated browser location authorization and sensor test. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import css from './DiagnosticsRow.module.css'

type Status = 'idle' | 'checking' | 'ready' | 'denied' | 'unavailable' | 'timeout'

export function LocationRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const [status, setStatus] = useState<Status>('idle')
  const check = (): void => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      return
    }
    setStatus('checking')
    let settled = false
    const finish = (next: Status): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      setStatus(next)
    }
    const watchdog = setTimeout(() => finish('timeout'), 9_000)
    try {
      // Only this explicit button may cause a browser permission dialog.
      // No coordinates are kept by the settings component.
      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude, accuracy } = position.coords
          finish(Number.isFinite(latitude) && Math.abs(latitude) <= 90
            && Number.isFinite(longitude) && Math.abs(longitude) <= 180
            && Number.isFinite(accuracy) && accuracy > 0 ? 'ready' : 'unavailable')
        },
        error => finish(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable'),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
      )
    } catch { finish('unavailable') }
  }
  return (
    <div className={css.row} data-phoenix-location="true">
      <div className={css.heading}>
        <div>
          <div className={css.title}>{t('location.title')}</div>
          <div className={css.desc}>{t('location.description')}</div>
        </div>
        <button className={css.refresh} type="button" disabled={status === 'checking'} onClick={check}>
          {t('location.check')}
        </button>
      </div>
      <div className={css.notice} role="status">
        {status === 'checking' ? t('location.checking') : status === 'ready' ? t('location.ready')
          : status === 'denied' ? t('location.denied') : status === 'timeout' ? t('location.timeout')
          : status === 'unavailable' ? t('location.unavailable') : t('location.idle')}
      </div>
    </div>
  )
}
