/** User-owned portrait. Kira and teammates retain separate agent identities. */
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  activateAvatar, deleteAvatar, editAvatarLocally, normalizeAvatar,
  readAvatar, storeOriginalAvatar, storeStyledAvatar, subscribeAvatar,
  setAvatarReferenceEnabled, probeLocalAvatarEditor,
  type AvatarSnapshot, validatedLocalEditor,
} from './avatar-store.ts'
import css from './UserAvatar.module.css'

/** Small reactive representation used by actual user bubbles and Settings. */
export function UserAvatar({ size = 36, className }: { size?: number; className?: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let alive = true
    let current: string | undefined
    const reload = () => {
      void readAvatar().then(snapshot => {
        if (!alive) return
        const photo = snapshot.mode === 'styled' ? snapshot.styled : snapshot.original
        const next = photo === undefined ? undefined : URL.createObjectURL(photo)
        setUrl(next)
        if (current !== undefined) URL.revokeObjectURL(current)
        current = next
      }).catch(() => { if (alive) setUrl(undefined) })
    }
    reload()
    const unsubscribe = subscribeAvatar(reload)
    return () => {
      alive = false
      unsubscribe()
      if (current !== undefined) URL.revokeObjectURL(current)
    }
  }, [])
  return <span className={[css.avatar, className].filter(Boolean).join(' ')} style={{ width: size, height: size }} data-user-avatar>
    {url === undefined ? <span aria-hidden="true">◉</span> : <img src={url} alt="" />}
  </span>
}
const empty: AvatarSnapshot = { mode: 'original', referenceEnabled: false }
const editorKey = 'phoenix-avatar-local-edit-url'
const modelKey = 'phoenix-avatar-local-edit-model'

/** In-profile photo picker, real crop, original/restyle variants and local editing. */
export function AvatarPanel() {
  const [stored, setStored] = useState<AvatarSnapshot>(empty)
  const [selected, setSelected] = useState<File>()
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [editor, setEditor] = useState(() => {
    try { return localStorage.getItem(editorKey) ?? '' } catch { return '' }
  })
  const [model, setModel] = useState(() => {
    try { return localStorage.getItem(modelKey) ?? 'local-image-edit' } catch { return 'local-image-edit' }
  })
  const refresh = async () => { setStored(await readAvatar()) }
  useEffect(() => {
    void refresh().catch(() => { setError('No se pudo abrir el almacenamiento local de fotos.') })
    return subscribeAvatar(() => { void refresh().catch(() => {}) })
  }, [])
  useEffect(() => {
    if (selected === undefined) { setPreview(undefined); return }
    const url = URL.createObjectURL(selected)
    setPreview(url)
    return () => { URL.revokeObjectURL(url) }
  }, [selected])
  const act = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setError(''); setMessage('')
    try {
      await operation()
      await refresh()
      setMessage(success)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación') }
    finally { setBusy(false) }
  }
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    if (file.size > 8 * 1024 * 1024
      || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Selecciona una imagen PNG, JPEG o WebP de máximo 8 MB.')
      return
    }
    setSelected(file); setError(''); setMessage('')
    setZoom(1); setOffsetX(0); setOffsetY(0)
  }
  const save = () => {
    if (selected === undefined) return
    void act(async () => {
      const prepared = await normalizeAvatar(selected, zoom, offsetX, offsetY)
      await storeOriginalAvatar(prepared)
      setSelected(undefined)
    }, 'Tu fotografía se guardó en este dispositivo.')
  }
  const checkEditor = () => {
    void act(() => probeLocalAvatarEditor(editor), 'El servicio local responde. Puedes intentar la transformación; la edición efectiva depende del modelo instalado.')
  }
  const transform = () => {
    if (stored.original === undefined) return
    void act(async () => {
      if (editor.trim() === '') throw new Error('Configura primero un editor local de imágenes compatible con /v1/images/edits.')
      // Explicit user click consents to sharing the normalized image with THIS local service only.
      const styled = await editAvatarLocally(stored.original as Blob, editor, model)
      await storeStyledAvatar(styled)
    }, '¡Listo! Se guardó el retrato transformado. Tu foto original sigue disponible.')
  }
  const updateEditor = (value: string) => {
    setEditor(value)
    try { localStorage.setItem(editorKey, value) } catch { /* Non-essential convenience. */ }
  }
  const updateModel = (value: string) => {
    setModel(value)
    try { localStorage.setItem(modelKey, value) } catch { /* Non-essential convenience. */ }
  }
  let editorValid = false
  try { if (editor.trim() !== '') { validatedLocalEditor(editor); editorValid = true } } catch { /* Invalid address will be explained. */ }
  return (
    <section className={css.panel} aria-labelledby="user-avatar-title">
      <h3 className={css.heading} id="user-avatar-title">Mi avatar</h3>
      <p className={css.hint}>Tu foto es tuya, no un agente del equipo. Se conserva en este navegador o instalación de PHOENIX, no se agrega a los prompts ni se sube automáticamente.</p>
      <div className={css.top}>
        <UserAvatar size={76} />
        <div className={css.details}>
          <strong>{stored.mode === 'styled' ? 'Tu retrato PHOENIX' : stored.original === undefined ? 'Sin foto personal' : 'Tu fotografía original'}</strong>
          <span>Visible junto a tus mensajes, con tu propia identidad.</span>
        </div>
      </div>
      <label className={css.pick} htmlFor="user-avatar-upload">Subir fotografía</label>
      <input className={css.file} id="user-avatar-upload" aria-label="Seleccionar una fotografía" type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} disabled={busy} />
      {selected !== undefined && preview !== undefined ? (
        <div className={css.editor}>
          <p className={css.hint}>Ajusta el encuadre antes de guardar la imagen. Se eliminan los metadatos personales.</p>
          <div className={css.preview}><img src={preview} alt="Vista previa de la fotografía" style={{ transform: `scale(${zoom})`, objectPosition: `${50 + offsetX * 50}% ${50 + offsetY * 50}%` }} /></div>
          <label>Acercar <input aria-label="Acercar" type="range" min="1" max="3" step=".1" value={zoom} onChange={e => { setZoom(Number(e.target.value)) }} /></label>
          <label>Encuadre horizontal <input aria-label="Encuadre horizontal" type="range" min="-1" max="1" step=".1" value={offsetX} onChange={e => { setOffsetX(Number(e.target.value)) }} /></label>
          <label>Encuadre vertical <input aria-label="Encuadre vertical" type="range" min="-1" max="1" step=".1" value={offsetY} onChange={e => { setOffsetY(Number(e.target.value)) }} /></label>
          <div className={css.actions}>
            <button type="button" onClick={save} disabled={busy}>Guardar foto</button>
            <button type="button" onClick={() => { setSelected(undefined) }} disabled={busy}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {stored.original !== undefined ? (
        <div className={css.actions}>
          <button type="button" disabled={busy || stored.mode === 'original'} onClick={() => { void act(() => activateAvatar('original'), 'Foto original restaurada.') }}>Volver a mi foto real</button>
          {stored.styled !== undefined && <button type="button" disabled={busy || stored.mode === 'styled'} onClick={() => { void act(() => activateAvatar('styled'), 'Retrato PHOENIX activado.') }}>Usar retrato</button>}
          <button type="button" className={css.danger} disabled={busy} onClick={() => { void act(deleteAvatar, 'Avatar eliminado de este dispositivo.') }}>Eliminar foto</button>
        </div>
      ) : null}
      {stored.original !== undefined && (
        <label className={css.referenceOption}>
          <input type="checkbox" checked={stored.referenceEnabled} disabled={busy} onChange={event => {
            void act(() => setAvatarReferenceEnabled(event.target.checked), event.target.checked
              ? 'Tu foto original será referencia en peticiones explícitas de imágenes donde aparezcas.'
              : 'La referencia automática está desactivada.')
          }} />
          <span><strong>Usar mi rostro como referencia en nuevas imágenes</strong><small>Solo cuando pidas expresamente una imagen en la que aparezcas tú. Se adjuntará la foto original a esa solicitud y podrá enviarse al proveedor de IA elegido; no se envía en conversaciones ordinarias. Puedes desactivarlo cuando quieras.</small></span>
        </label>
      )}
      {stored.original !== undefined && (
        <div className={css.transform}>
          <h4>Transformar al estilo del equipo Kira</h4>
          <p className={css.hint}>Convierte tu fotografía en un retrato semirrealista de luz cálida, respetando tu identidad. La versión real queda siempre guardada. Se requiere un editor de imágenes local compatible; no se simula el resultado.</p>
          <label htmlFor="user-avatar-editor">Editor de imágenes local (solo localhost)</label>
          <input id="user-avatar-editor" type="url" className={css.endpoint} value={editor} placeholder="http://127.0.0.1:PORT/v1" onChange={e => { updateEditor(e.target.value) }} disabled={busy} />
          <label htmlFor="user-avatar-model">Modelo de edición instalado</label>
          <input id="user-avatar-model" className={css.endpoint} value={model} placeholder="local-image-edit" onChange={e => { updateModel(e.target.value) }} disabled={busy} />
          <div className={css.actions}>
            <button type="button" disabled={busy || !editorValid} onClick={checkEditor}>Comprobar conexión</button>
            <button type="button" className={css.primary} disabled={busy || !/^[a-zA-Z0-9._/-]{1,120}$/u.test(model)} onClick={transform}>{busy ? 'Procesando…' : 'Transformar con IA'}</button>
          </div>
          <p className={css.hint}>{!editorValid ? 'Primero introduce la URL de un editor real iniciado en tu equipo (por ejemplo, http://127.0.0.1:8188/v1). El botón explicará qué falta si intentas transformar sin conexión.' : 'Al pulsar transformar autorizas enviar tu foto únicamente a ese servicio local. Si falla, la original permanece intacta.'}</p>
        </div>
      )}
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
      {message !== '' && <p className={css.success} role="status">{message}</p>}
    </section>
  )
}
