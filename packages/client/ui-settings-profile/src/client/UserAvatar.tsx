/** User-owned portrait. Kira and teammates retain separate agent identities. */
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  activateAvatar, deleteAvatar, normalizeAvatar,
  readAvatar, storeOriginalAvatar, storeStyledAvatar, subscribeAvatar,
  setAvatarReferenceEnabled, type AvatarSnapshot,
} from './avatar-store.ts'
import css from './UserAvatar.module.css'

/** Small reactive representation used by actual user bubbles and Settings. */
export function UserAvatar({ size = 36, className }: { size?: number; className?: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let alive = true
    let current: string | undefined
    const reload = () => {
      void readAvatar().then((snapshot) => {
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

/** In-profile photo picker, real crop, original/restyle variants and local editing. */
export function AvatarPanel({ transformAvatar }: { transformAvatar: (photo: Blob) => Promise<Blob> }) {
  const [stored, setStored] = useState<AvatarSnapshot>(empty)
  const [selected, setSelected] = useState<File>()
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [zoom, setZoom] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [suggested, setSuggested] = useState<Blob>()
  const [suggestedUrl, setSuggestedUrl] = useState<string>()
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
  useEffect(() => {
    if (suggested === undefined) { setSuggestedUrl(undefined); return }
    const next = URL.createObjectURL(suggested)
    setSuggestedUrl(next)
    return () => { URL.revokeObjectURL(next) }
  }, [suggested])
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
    setSelected(file); setSuggested(undefined); setError(''); setMessage('')
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
  const transform = () => {
    if (stored.original === undefined) return
    void act(async () => {
      const result = await transformAvatar(stored.original as Blob)
      setSuggested(result)
    }, 'Retrato estilo Kira generado. Comprueba que el rostro se reconoce y que el estilo es futurista.')
  }
  const confirm = () => {
    if (suggested === undefined) return
    void act(async () => {
      const latest = await readAvatar()
      if (latest.original === undefined) {
        throw new Error('Guarda primero una fotografía original para activar un retrato.')
      }
      await storeStyledAvatar(suggested)
      setSuggested(undefined)
    }, 'Retrato estilo Kira guardado. Tu foto original sigue disponible.')
  }
  return (
    <section className={css.panel} aria-labelledby="user-avatar-title">
      <h3 className={css.heading} id="user-avatar-title">Mi avatar</h3>
      <p className={css.hint}>
        Tu foto es tuya, no un agente del equipo. Se conserva en este navegador o instalación de PHOENIX,
        no se comparte salvo cuando autorizas expresamente una transformación o una referencia.
      </p>
      <div className={css.top}>
        <UserAvatar size={76} />
        <div className={css.details}>
          <strong>
            {stored.mode === 'styled' ? 'Tu retrato PHOENIX'
              : stored.original === undefined ? 'Sin foto personal' : 'Tu fotografía original'}
          </strong>
          <span>Visible junto a tus mensajes, con tu propia identidad.</span>
        </div>
      </div>
      <label className={css.pick} htmlFor="user-avatar-upload">Subir fotografía</label>
      <input
        className={css.file} id="user-avatar-upload" aria-label="Seleccionar una fotografía"
        type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} disabled={busy}
      />
      {selected !== undefined && preview !== undefined ? (
        <div className={css.editor}>
          <p className={css.hint}>Ajusta el encuadre antes de guardar la imagen. Se eliminan los metadatos personales.</p>
          <div className={css.preview}>
            <img
              src={preview} alt="Vista previa de la fotografía"
              style={{ transform: `scale(${zoom})`, objectPosition: `${50 + offsetX * 50}% ${50 + offsetY * 50}%` }}
            />
          </div>
          <label>
            Acercar
            <input aria-label="Acercar" type="range" min="1" max="3" step=".1" value={zoom}
              onChange={(e) => { setZoom(Number(e.target.value)) }} />
          </label>
          <label>
            Encuadre horizontal
            <input aria-label="Encuadre horizontal" type="range" min="-1" max="1" step=".1" value={offsetX}
              onChange={(e) => { setOffsetX(Number(e.target.value)) }} />
          </label>
          <label>
            Encuadre vertical
            <input aria-label="Encuadre vertical" type="range" min="-1" max="1" step=".1" value={offsetY}
              onChange={(e) => { setOffsetY(Number(e.target.value)) }} />
          </label>
          <div className={css.actions}>
            <button type="button" onClick={save} disabled={busy}>Guardar foto</button>
            <button type="button" onClick={() => { setSelected(undefined) }} disabled={busy}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {stored.original !== undefined ? (
        <div className={css.actions}>
          <button type="button" disabled={busy || stored.mode === 'original'}
            onClick={() => { void act(() => activateAvatar('original'), 'Foto original restaurada.') }}>
            Volver a mi foto real
          </button>
          {stored.styled !== undefined && (
            <button type="button" disabled={busy || stored.mode === 'styled'}
              onClick={() => { void act(() => activateAvatar('styled'), 'Retrato PHOENIX activado.') }}>
              Usar retrato
            </button>
          )}
          <button type="button" className={css.danger} disabled={busy}
            onClick={() => {
              setSuggested(undefined)
              void act(deleteAvatar, 'Avatar eliminado de este dispositivo.')
            }}>
            Eliminar foto
          </button>
        </div>
      ) : null}
      {stored.original !== undefined && (
        <label className={css.referenceOption}>
          <input type="checkbox" checked={stored.referenceEnabled} disabled={busy} onChange={(event) => {
            void act(() => setAvatarReferenceEnabled(event.target.checked), event.target.checked
              ? 'Tu foto original será referencia en peticiones explícitas de imágenes donde aparezcas.'
              : 'La referencia automática está desactivada.')
          }} />
          <span>
            <strong>Usar mi rostro como referencia en nuevas imágenes</strong>
            <small>
              Solo cuando pidas expresamente una imagen en la que aparezcas tú.
              Se adjuntará la foto original a esa solicitud y podrá enviarse al proveedor de IA elegido;
              no se envía en conversaciones ordinarias. Puedes desactivarlo cuando quieras.
            </small>
          </span>
        </label>
      )}
      {stored.original !== undefined && (
        <div className={css.transform}>
          <h4>Transformar al estilo del equipo Kira</h4>
          <p className={css.hint}>
            Codex utiliza tu foto real para crear un personaje cinematográfico del universo Kira:
            ciudad futurista, hologramas azules y violetas, vestuario tecnológico e iluminación dramática.
            No necesitas configurar un servidor local ni una clave API adicional.
            La foto original siempre se conserva.
          </p>
          <div className={css.actions}>
            <button type="button" className={css.primary} disabled={busy} onClick={transform}>
              {busy ? 'Generando retrato…' : 'Transformar con Codex'}
            </button>
          </div>
          {suggested !== undefined && suggestedUrl !== undefined && (
            <div className={css.candidate}>
              <img src={suggestedUrl} alt="Vista previa del retrato generado por Codex" />
              <p className={css.hint}>
                Comprueba que el rostro sea reconocible. Guardar activa el nuevo retrato;
                descartar mantiene intacta tu fotografía actual.
              </p>
              <div className={css.actions}>
                <button type="button" className={css.primary} disabled={busy} onClick={confirm}>
                  Guardar retrato
                </button>
                <button type="button" disabled={busy} onClick={() => { setSuggested(undefined) }}>
                  Descartar
                </button>
              </div>
            </div>
          )}
          <p className={css.hint}>
            La transformación envía la fotografía normalizada al generador Codex/ChatGPT configurado
            en PHOENIX. Si no está disponible, verás el error real sin perder la imagen original.
          </p>
        </div>
      )}
      {error !== '' && <p className={css.error} role="alert">{error}</p>}
      {message !== '' && <p className={css.success} role="status">{message}</p>}
    </section>
  )
}
