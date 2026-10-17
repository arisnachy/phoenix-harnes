/** Secure Ask is a human-only sidebar form, not ask_user_question or an LLM tool result. */
import { useState, type FormEvent } from 'react'
import { secureApi, type SecureLoginTarget, type SecureStatus } from './MiniBrowser.tsx'
import css from './SecureAsk.module.css'

export function SecureAsk({ target, onClose, onSaved }: {
  target: SecureLoginTarget
  onClose: () => void
  onSaved: () => void
}) {
  const [account, setAccount] = useState('')
  const [secret, setSecret] = useState('')
  const [automatic, setAutomatic] = useState(target.automatic)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !account.trim() || !secret) return
    setBusy(true)
    try {
      await secureApi<SecureStatus>('/save', {
        origin: target.origin, tabId: target.tabId, account, secret, automatic,
      })
      // The user's explicit submit authorizes *this* initial login. The
      // separate checkbox controls only future unattended logins.
      const login = await secureApi<{ status: string }>('/use', {
        origin: target.origin, tabId: target.tabId, manual: true,
      })
      if (login.status === 'submitted') onSaved()
      else setFeedback('Credenciales guardadas. El formulario del sitio requiere intervención adicional.')
    } catch {
      setFeedback('No se pudo guardar o utilizar el acceso. Verifica el navegador y la bóveda.')
    } finally {
      setSecret('')
      setAccount('')
      setBusy(false)
    }
  }
  const useSaved = async () => {
    setBusy(true)
    try {
      const result = await secureApi<{ status: string }>('/use', {
        origin: target.origin, tabId: target.tabId, manual: true,
      })
      if (result.status === 'submitted') onSaved()
      else setFeedback('No se confirmó el envío del acceso. Comprueba la página.')
    } catch { setFeedback('No se pudo usar el acceso guardado.') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await secureApi('/delete', { origin: target.origin })
      setFeedback('Acceso anterior eliminado. Puedes registrar uno nuevo.')
    } catch { setFeedback('No se pudo eliminar el acceso.') }
    finally { setBusy(false) }
  }
  return (
    <div className={css.root} data-secure-ask="true" role="region" aria-label="Acceso seguro de Kira">
      <p className={css.notice}>Kira necesita iniciar sesión para continuar. Los datos se envían a la bóveda local, nunca al modelo.</p>
      <div className={css.origin} title={target.origin}>🔒 {target.origin}</div>
      {target.saved && <div className={css.saved}>
        <span>Acceso guardado para este sitio.</span>
        <button type="button" disabled={busy} onClick={() => { void useSaved() }}>Usar acceso guardado</button>
      </div>}
      <form onSubmit={event => { void save(event) }} autoComplete="off" className={css.form}>
        <label>Usuario o correo electrónico
          <input value={account} disabled={busy} autoComplete="off" spellCheck={false}
            onChange={event => setAccount(event.currentTarget.value)} placeholder="Escribe o pega tu usuario" />
        </label>
        <label>Contraseña
          <input type="password" value={secret} disabled={busy} autoComplete="new-password"
            onChange={event => setSecret(event.currentTarget.value)}
            placeholder="Escribe o pega la contraseña" />
        </label>
        <label className={css.option}><input type="checkbox" checked={automatic} disabled={busy}
          onChange={event => setAutomatic(event.currentTarget.checked)} />
          Recordar y permitir inicio automático en futuras visitas</label>
        <div className={css.actions}>
          <button type="submit" disabled={busy || !account.trim() || !secret}>Guardar y continuar</button>
          <button type="button" disabled={busy} onClick={onClose}>Ahora no</button>
          {target.saved && <button type="button" disabled={busy} onClick={() => { void remove() }}>Eliminar acceso</button>}
        </div>
      </form>
      {feedback && <p className={css.feedback} role="status">{feedback}</p>}
      <p className={css.foot}>La contraseña no se incorpora a la conversación ni a sus eventos. Puede requerirse MFA, passkey o CAPTCHA.</p>
    </div>
  )
}
