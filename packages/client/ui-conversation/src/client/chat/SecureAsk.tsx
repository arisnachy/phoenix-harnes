/** Secure Ask is a human-only sidebar form, not ask_user_question or an LLM tool result. */
import { useEffect, useState, type FormEvent } from 'react'
import { secureApi, type SecureLoginTarget, type SecureStatus, type SecureLoginProfile, type SecureProfileInfo } from './MiniBrowser.tsx'
import css from './SecureAsk.module.css'

/** Human-friendly statuses only: no account or password values cross back to chat. */
export function describeLoginResult(status: string): string {
  switch (status) {
    case 'login-form-not-found': return 'No aparece un formulario de ingreso en esta página. Abre la opción Cuenta o Iniciar sesión y vuelve a intentarlo.'
    case 'login-trigger-requires-attention': return 'La página requiere abrir manualmente el acceso o continuar en otra pantalla.'
    case 'additional-login-field-required': return 'La página exige un dato adicional para iniciar sesión.'
    case 'not-authorized': return 'La identidad seleccionada todavía no tiene un acceso autorizado.'
    case 'origin-changed': return 'La página cambió de dominio; comprueba el destino antes de utilizar el acceso.'
    default: return 'El sitio no confirmó el ingreso. Revisa su formulario y vuelve a intentar.'
  }
}
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
  const [editing, setEditing] = useState(!target.saved && !target.relatedOrigin)
  const [profile, setProfile] = useState<SecureLoginProfile>(
    !target.saved && target.relatedOrigin ? (target.relatedProfile ?? target.profile ?? 'personal')
      : (target.profile ?? 'personal'))
  const [profiles, setProfiles] = useState<SecureProfileInfo[]>(target.profiles ?? [
    { id: 'personal', saved: target.saved, automatic: target.automatic, source: target.saved ? 'dpapi' : 'none' },
    { id: 'kira', saved: false, automatic: false, source: 'none' },
  ])
  // Do not keep the previous site's credential form when switching browser tabs.
  useEffect(() => {
    const nextProfile = !target.saved && target.relatedOrigin
      ? (target.relatedProfile ?? target.profile ?? 'personal') : (target.profile ?? 'personal')
    setProfile(nextProfile)
    setProfiles(target.profiles ?? [
      { id: 'personal', saved: target.saved, automatic: target.automatic, source: target.saved ? 'dpapi' : 'none' },
      { id: 'kira', saved: false, automatic: false, source: 'none' },
    ])
    setAutomatic(target.automatic)
    setEditing(!target.saved && !target.relatedOrigin)
    setFeedback('')
    setAccount('')
    setSecret('')
    setExtraValues({})
  }, [target.origin, target.tabId])
  const selectedProfile = profiles.find(item => item.id === profile)
  const selectedSaved = selectedProfile?.saved ?? false
  const relatedOrigin = !selectedSaved && profile === (target.relatedProfile ?? 'personal')
    ? target.relatedOrigin : undefined
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
        const status = await secureApi<{ required: boolean; authenticated?: boolean }>('/detect', {
          origin: target.origin, tabId: target.tabId,
        })
        if (status.authenticated === true) { onSaved(); return }
        if (status.required === false) {
          setFeedback('Credenciales guardadas. El formulario desapareció, pero el sitio aún no confirmó una sesión autenticada.')
          return
        }
      } catch { /* Transient browser transport errors must not imply success. */ }
    }
    setFeedback('El acceso se envió, pero el sitio todavía no confirmó la sesión. Conservé el formulario y el cupón.')
  }
  const save = async (event?: FormEvent<HTMLFormElement>, remember = automatic) => {
    event?.preventDefault()
    if (busy || !account.trim() || !secret || extraFields.some(field => field.required && !extraValues[field.key]?.trim())) return
    setBusy(true)
    try {
      const saved = await secureApi<SecureStatus>('/save', {
        origin: target.origin, tabId: target.tabId, account, secret, automatic: remember, profile,
        ...(extraFields.length ? { extras: Object.fromEntries(extraFields.map(field => [field.key, extraValues[field.key] ?? ''])) } : {}),
      })
      if (!saved.saved) throw new Error('Vault did not confirm saving')
      if (saved.profiles) setProfiles(saved.profiles)
      // A DPAPI write succeeded. This fact MUST survive any later login error.
      setEditing(false)
      setFeedback('Acceso guardado y cifrado correctamente. Comprobando el inicio de sesión…')
      try {
        if (profile === 'kira') {
          await secureApi<SecureStatus>('/select', {
            origin: target.origin, tabId: target.tabId, profile,
          })
        }
        const login = await secureApi<{ status: string }>('/use', {
          origin: target.origin, tabId: target.tabId, manual: true, profile,
        })
        if (login.status === 'submitted') await verifyLogin()
        else setFeedback('Acceso guardado y cifrado. ' + describeLoginResult(login.status))
      } catch {
        setFeedback('Acceso guardado y cifrado. La página aún no permitió iniciar sesión; puedes reintentar sin escribir las credenciales.')
      }
    } catch {
      setFeedback('Vault no confirmó el guardado. Comprueba su estado antes de volver a introducir datos.')
    } finally {
      setSecret('')
      setAccount('')
      setExtraValues({})
      setBusy(false)
    }
  }
  /** Give a previously saved account explicit auto-login consent without re-entry. */
  const rememberSaved = async (): Promise<void> => {
    if (busy || !selectedSaved) return
    setBusy(true)
    try {
      const updated = await secureApi<SecureStatus>('/remember', {
        origin: target.origin, tabId: target.tabId, profile, automatic: true,
      })
      if (!updated.saved) throw new Error('Remember was not confirmed')
      if (updated.profiles) setProfiles(updated.profiles)
      setAutomatic(true)
      setEditing(false)
      setFeedback('Acceso guardado: inicio automático habilitado para este sitio. Comprobando la sesión…')
      try {
        const login = await secureApi<{ status: string }>('/use', {
          origin: target.origin, tabId: target.tabId, manual: true, profile,
        })
        if (login.status === 'submitted') await verifyLogin()
        else setFeedback('Inicio automático habilitado. ' + describeLoginResult(login.status))
      } catch {
        setFeedback('Inicio automático habilitado. La página no permitió iniciar sesión todavía; el acceso permanece guardado.')
      }
    } catch {
      setFeedback('No pude confirmar el inicio automático. La contraseña guardada no se modificó.')
    } finally { setBusy(false) }
  }
  const useSaved = async () => {
    setBusy(true)
    try {
      const result = await secureApi<{ status: string }>('/use', {
        origin: target.origin, tabId: target.tabId, manual: true, profile,
      })
      if (result.status === 'submitted') await verifyLogin()
      else setFeedback('El acceso sigue guardado. ' + describeLoginResult(result.status))
    } catch { setFeedback('No se pudo usar el acceso guardado.') }
    finally { setBusy(false) }
  }
  const adoptRelated = async (): Promise<void> => {
    if (!relatedOrigin || busy) return
    setBusy(true)
    try {
      const accepted = await secureApi<SecureStatus>('/adopt-related', {
        origin: target.origin, tabId: target.tabId, sourceOrigin: relatedOrigin,
        profile, consent: true,
      })
      if (!accepted.saved) throw new Error('Vault did not confirm copying')
      if (accepted.profiles) setProfiles(accepted.profiles)
      setEditing(false)
      setAutomatic(false)
      // Reuse is a ONE-TIME human decision, never silent cross-origin authority.
      setFeedback('Acceso cifrado reutilizado para este sitio con inicio automático desactivado. Comprobando autenticación…')
      try {
        const login = await secureApi<{ status: string }>('/use', {
          origin: target.origin, tabId: target.tabId, manual: true, profile,
        })
        if (login.status === 'submitted') await verifyLogin()
        else setFeedback('Acceso guardado para este sitio. ' + describeLoginResult(login.status))
      } catch {
        setFeedback('Acceso copiado y guardado. El formulario de inicio de sesión sigue pendiente; no se perdieron las credenciales.')
      }
    } catch {
      setFeedback('No se pudo reutilizar ese acceso. Los datos originales permanecen protegidos en Vault.')
    } finally { setBusy(false) }
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
      {relatedOrigin && <div className={css.saved} role="status">
        <span>Ya tienes un acceso cifrado en el módulo relacionado ({relatedOrigin}). Esta página usa otro dominio, por lo que no lo aplicaré automáticamente.</span>
        <button type="button" disabled={busy} onClick={() => { void adoptRelated() }}>
          Reutilizar en este sitio
        </button>
      </div>}
      {selectedSaved && <div className={css.saved}>
        <span>Ya existe un acceso guardado para este sitio. No es necesario escribirlo otra vez.</span>
        <button type="button" disabled={busy} onClick={() => { void useSaved() }}>Usar acceso guardado</button>
        {!selectedProfile?.automatic && <button type="button" disabled={busy}
          onClick={() => { void rememberSaved() }}>No volver a preguntar en este sitio</button>}
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
          {!automatic && <button type="button" disabled={busy || !account.trim() || !secret
            || extraFields.some(field => field.required && !extraValues[field.key]?.trim())}
            onClick={() => { void save(undefined, true) }}>Guardar y no volver a preguntar</button>}
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
