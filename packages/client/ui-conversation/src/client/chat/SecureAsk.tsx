/** Secure Ask is a human-only sidebar form, not ask_user_question or an LLM tool result. */
import { useState, type FormEvent } from 'react'
import { secureApi, type SecureLoginTarget, type SecureStatus, type SecureLoginProfile, type SecureProfileInfo } from './MiniBrowser.tsx'
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
  const [editing, setEditing] = useState(!target.saved)
  const [profile, setProfile] = useState<SecureLoginProfile>(target.profile ?? 'personal')
  const [profiles, setProfiles] = useState<SecureProfileInfo[]>(target.profiles ?? [
    { id: 'personal', saved: target.saved, automatic: target.automatic, source: target.saved ? 'dpapi' : 'none' },
    { id: 'kira', saved: false, automatic: false, source: 'none' },
  ])
  const selectedProfile = profiles.find(item => item.id === profile)
  const selectedSaved = selectedProfile?.saved ?? false
  const [extraValues, setExtraValues] = useState<Record<string, string>>({})
  const chooseProfile = async (next: SecureLoginProfile): Promise<void> => {
    if (busy || next === profile) return
    const found = profiles.find(item => item.id === next)
    setProfile(next)
    setAutomatic(found?.automatic ?? false)
    setEditing(!found?.saved)
    setFeedback('')
    setAccount('')
    setSecret('')
    setExtraValues({})
    if (found?.saved) {
      try {
        // Selecting a named identity is an explicit human instruction.
        const status = await secureApi<SecureStatus>('/select', {
          origin: target.origin, tabId: target.tabId, profile: next,
        })
        if (status.profiles) setProfiles(status.profiles)
      } catch { setFeedback('No se pudo seleccionar esa identidad. Conservé ambas credenciales.') }
    }
  }
  const accountField = target.fields?.find(field => field.role === 'account')
  const secretField = target.fields?.find(field => field.role === 'secret')
  const extraFields = target.fields?.filter(field => field.role === 'extra') ?? []
  const verifyLogin = async (): Promise<void> => {
    // The site controls the actual session. Do not close Secure Ask just
    // because CDP dispatched a submit click.
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 600))
      try {
        const status = await secureApi<{ required: boolean }>('/detect', {
          origin: target.origin, tabId: target.tabId,
        })
        if (status.required === false) { onSaved(); return }
      } catch { /* Transient browser transport errors must not imply success. */ }
    }
    setFeedback('El acceso se envió, pero el sitio todavía no confirmó la sesión. Conservé el formulario y el cupón.')
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !account.trim() || !secret || extraFields.some(field => field.required && !extraValues[field.key]?.trim())) return
    setBusy(true)
    try {
      const saved = await secureApi<SecureStatus>('/save', {
        origin: target.origin, tabId: target.tabId, account, secret, automatic, profile,
        ...(extraFields.length ? { extras: Object.fromEntries(extraFields.map(field => [field.key, extraValues[field.key] ?? ''])) } : {}),
      })
      if (saved.profiles) setProfiles(saved.profiles)
      // Once stored securely, do not leave the credential-entry form exposed.
      setEditing(false)
      // The user's explicit submit authorizes *this* initial login. The
      // separate checkbox controls only future unattended logins.
      const login = await secureApi<{ status: string }>('/use', {
        origin: target.origin, tabId: target.tabId, manual: true, profile,
      })
      if (login.status === 'submitted') await verifyLogin()
      else setFeedback('Credenciales guardadas. El formulario del sitio requiere intervención adicional.')
    } catch {
      setFeedback('No se pudo guardar o utilizar el acceso. Verifica el navegador y la bóveda.')
    } finally {
      setSecret('')
      setAccount('')
      setExtraValues({})
      setBusy(false)
    }
  }
  const useSaved = async () => {
    setBusy(true)
    try {
      const result = await secureApi<{ status: string }>('/use', {
        origin: target.origin, tabId: target.tabId, manual: true, profile,
      })
      if (result.status === 'submitted') await verifyLogin()
      else setFeedback('No se confirmó el envío del acceso. Comprueba la página.')
    } catch { setFeedback('No se pudo usar el acceso guardado.') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try {
      const result = await secureApi<SecureStatus>('/delete', { origin: target.origin, profile })
      if (result.profiles) setProfiles(result.profiles)
      setFeedback('Se eliminó únicamente la identidad seleccionada. Las demás se conservaron.')
      setEditing(true)
    } catch { setFeedback('No se pudo eliminar el acceso.') }
    finally { setBusy(false) }
  }
  return (
    <div className={css.root} data-secure-ask="true" role="region" aria-label="Acceso seguro de Kira">
      <p className={css.notice}>Kira comprobará primero los accesos existentes. Si necesitas registrar uno nuevo, los datos se envían directamente a la bóveda local, nunca al modelo.</p>
      <div className={css.origin} title={target.origin}>🔒 {target.origin}</div>
      <div role="group" aria-label="Seleccionar identidad de acceso" className={css.actions}>
        <button type="button" disabled={busy} aria-pressed={profile === 'personal'}
          onClick={() => { void chooseProfile('personal') }}>Cuenta personal</button>
        <button type="button" disabled={busy} aria-pressed={profile === 'kira'}
          onClick={() => { void chooseProfile('kira') }}>Cuenta de Kira</button>
      </div>
      <p className={css.notice}>{selectedSaved
        ? 'La identidad seleccionada tiene un acceso cifrado disponible.'
        : profile === 'kira'
          ? 'Kira aún no tiene acceso guardado a este sitio. Registrar una cuenta requiere autorización y cumplir las reglas del servicio.'
          : 'Aún no hay un acceso personal guardado para este sitio.'}</p>
      {target.diagnostic && <p role="status" className={css.feedback}>{target.diagnostic}</p>}
      {selectedSaved && <div className={css.saved}>
        <span>Ya existe un acceso guardado para este sitio. No es necesario escribirlo otra vez.</span>
        <button type="button" disabled={busy} onClick={() => { void useSaved() }}>Usar acceso guardado</button>
        <button type="button" disabled={busy} onClick={() => setEditing(value => !value)}>
          {editing ? 'Ocultar formulario' : 'Cambiar o completar credenciales'}
        </button>
      </div>}
      {editing && <form onSubmit={event => { void save(event) }} autoComplete="off" className={css.form}>
        <label>{accountField?.label || 'Usuario o correo electrónico'}
          <input value={account} disabled={busy} autoComplete="off" spellCheck={false}
            type={accountField?.inputType === 'email' ? 'email' : accountField?.inputType === 'tel' ? 'tel'
              : accountField?.inputType === 'number' ? 'text' : 'text'}
            onChange={event => setAccount(event.currentTarget.value)}
            placeholder={accountField?.placeholder || 'Escribe o pega tu usuario'} />
        </label>
        <label>{secretField?.label || 'Contraseña'}
          <input type="password" value={secret} disabled={busy} autoComplete="new-password"
            onChange={event => setSecret(event.currentTarget.value)}
            placeholder={secretField?.placeholder || 'Escribe o pega la contraseña'} />
        </label>
        {extraFields.map(field => <label key={field.key}>{field.label}
          <input type={field.inputType === 'email' ? 'email' : field.inputType === 'tel' ? 'tel'
            : field.inputType === 'password' ? 'password' : 'text'}
            disabled={busy} required={field.required} value={extraValues[field.key] ?? ''}
            autoComplete="off" spellCheck={false}
            placeholder={field.placeholder || field.label}
            onChange={event => { const value = event.currentTarget.value; setExtraValues(values => ({ ...values, [field.key]: value })) }} />
        </label>)}
        <label className={css.option}><input type="checkbox" checked={automatic} disabled={busy}
          onChange={event => setAutomatic(event.currentTarget.checked)} />
          Recordar y permitir inicio automático en futuras visitas</label>
        <div className={css.actions}>
          <button type="submit" disabled={busy || !account.trim() || !secret
            || extraFields.some(field => field.required && !extraValues[field.key]?.trim())}>Guardar y continuar</button>
          <button type="button" disabled={busy} onClick={onClose}>Ahora no</button>
          {selectedSaved && <button type="button" disabled={busy} onClick={() => { void remove() }}>Eliminar acceso</button>}
        </div>
      </form>}
      {feedback && <p className={css.feedback} role="status">{feedback}</p>}
      {!editing && <button type="button" disabled={busy} onClick={onClose}>Cerrar acceso seguro</button>}
      <p className={css.foot}>La contraseña no se incorpora a la conversación ni a sus eventos. Puede requerirse MFA, passkey o CAPTCHA.</p>
    </div>
  )
}
