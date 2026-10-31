/** Native, private user photo and optional real image-edit provider for Profile. */
import { useEffect, useRef, useState } from 'react'
import type { UserProfileRowProps } from './UserProfileRow.tsx'
import {
  clearAvatar, editAvatarWithLocalAI, loadAvatar, prepareAvatar, saveAvatar, selectAvatar,
  type AvatarState,
} from './avatar-store.ts'
import css from './UserProfileRow.module.css'

type Translator = UserProfileRowProps['t']

export function AvatarSettings({ t, disabled }: { t: Translator; disabled: boolean }) {
  const [snapshot, setSnapshot] = useState<AvatarState>({ mode: 'original' })
  const [revision, setRevision] = useState(0)
  const [file, setFile] = useState<File>()
  const [incomingUrl, setIncomingUrl] = useState<string>()
  const [currentUrl, setCurrentUrl] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editorUrl, setEditorUrl] = useState('')
  const [editorModel, setEditorModel] = useState('image-edit')
  const [consentEdit, setConsentEdit] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void loadAvatar().then(value => { if (alive) setSnapshot(value) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [revision])

  useEffect(() => {
    if (file === undefined) { setIncomingUrl(undefined); return }
    const url = URL.createObjectURL(file)
    setIncomingUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [file])

  useEffect(() => {
    const active = snapshot.mode === 'portrait' ? snapshot.portrait : snapshot.original
    if (active === undefined) { setCurrentUrl(undefined); return }
    const url = URL.createObjectURL(active)
    setCurrentUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [snapshot])

  const run = async (action: () => Promise<void>, successful: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(successful)
      setRevision(v => v + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }
  const unavailable = disabled || busy
  return (
    <div className={css.group} data-user-avatar-settings>
      <h3 className={css.groupTitle}>{t('avatarTitle')}</h3>
      <p className={css.hint}>{t('avatarHint')}</p>
      <div className={css.avatarLayout}>
        <span className={css.avatarPreview}>
          {currentUrl === undefined ? <span aria-hidden="true">👤</span>
            : <img src={currentUrl} alt={t('avatarPreview')} />}
        </span>
        <div className={css.avatarInfo}>
          <strong>{snapshot.mode === 'portrait' ? t('avatarModePortrait') : t('avatarModeOriginal')}</strong>
          <p className={css.hint}>{t('avatarPrivacy')}</p>
          <button type="button" className={css.secondary} disabled={unavailable}
            onClick={() => { fileRef.current?.click() }}>{t('avatarUpload')}</button>
          <input ref={fileRef} className={css.hiddenFile} type="file" accept="image/jpeg,image/png,image/webp"
            aria-label={t('avatarUpload')} disabled={unavailable}
            onChange={event => {
              const chosen = event.currentTarget.files?.[0]
              if (chosen !== undefined) { setFile(chosen); setError(''); setNotice('') }
              event.currentTarget.value = ''
            }}/>
        </div>
      </div>
      {file !== undefined && (
        <div className={css.cropPanel}>
          <p className={css.label}>{t('avatarCrop')}</p>
          {incomingUrl !== undefined && <img className={css.cropPreview} src={incomingUrl} alt={t('avatarCrop')}/>}
          <label className={css.label}>{t('avatarZoom')}
            <input type="range" min="1" max="3" step=".1" value={zoom}
              onChange={event => { setZoom(Number(event.target.value)) }} disabled={unavailable}/>
          </label>
          <label className={css.label}>{t('avatarHorizontal')}
            <input type="range" min="0" max="100" value={x}
              onChange={event => { setX(Number(event.target.value)) }} disabled={unavailable}/>
          </label>
          <label className={css.label}>{t('avatarVertical')}
            <input type="range" min="0" max="100" value={y}
              onChange={event => { setY(Number(event.target.value)) }} disabled={unavailable}/>
          </label>
          <div className={css.actions}>
            <button type="button" className={css.primary} disabled={unavailable} onClick={() => {
              void run(async () => {
                const output = await prepareAvatar(file, zoom, x, y)
                await saveAvatar('original', output)
                setFile(undefined)
              }, t('avatarSaved'))
            }}>{t('avatarApplyCrop')}</button>
            <button type="button" className={css.secondary} disabled={unavailable}
              onClick={() => { setFile(undefined) }}>{t('avatarCancel')}</button>
          </div>
        </div>
      )}
      {snapshot.original !== undefined && (
        <div className={css.avatarEditor}>
          <h4 className={css.label}>{t('avatarTransform')}</h4>
          <p className={css.hint}>{t('avatarEditorHint')}</p>
          <label className={css.label} htmlFor="avatar-editor-url">{t('avatarEditorUrl')}</label>
          <input id="avatar-editor-url" className={css.input} placeholder="http://127.0.0.1:7860/v1"
            value={editorUrl} disabled={unavailable}
            onChange={event => { setEditorUrl(event.target.value) }}/>
          <label className={css.label} htmlFor="avatar-editor-model">{t('avatarEditorModel')}</label>
          <input id="avatar-editor-model" className={css.input} value={editorModel} disabled={unavailable}
            onChange={event => { setEditorModel(event.target.value) }}/>
          <label className={css.check}>
            <input type="checkbox" checked={consentEdit} disabled={unavailable}
              onChange={event => { setConsentEdit(event.target.checked) }}/>
            {t('avatarEditorConsent')}
          </label>
          <div className={css.actions}>
            <button type="button" className={css.primary}
              disabled={unavailable || !consentEdit || editorUrl.trim() === ''}
              onClick={() => {
                void run(async () => {
                  const result = await editAvatarWithLocalAI(snapshot.original!, editorUrl, editorModel)
                  await saveAvatar('portrait', result)
                  setConsentEdit(false)
                }, t('avatarPortraitSaved'))
              }}>{t('avatarTransform')}</button>
            {snapshot.portrait !== undefined && snapshot.mode === 'portrait' && (
              <button type="button" className={css.secondary} disabled={unavailable}
                onClick={() => { void run(() => selectAvatar('original'), t('avatarSaved')) }}>
                {t('avatarRestore')}</button>
            )}
            {snapshot.portrait !== undefined && snapshot.mode !== 'portrait' && (
              <button type="button" className={css.secondary} disabled={unavailable}
                onClick={() => { void run(() => selectAvatar('portrait'), t('avatarPortraitSaved')) }}>
                {t('avatarUsePortrait')}</button>
            )}
            <button type="button" className={css.danger} disabled={unavailable}
              onClick={() => { void run(clearAvatar, t('avatarDeleted')) }}>
              {t('avatarDelete')}</button>
          </div>
        </div>
      )}
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
      {notice !== '' && <p className={css.saved} role="status">{notice}</p>}
    </div>
  )
}
