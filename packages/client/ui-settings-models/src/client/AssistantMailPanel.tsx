/** Local email enrollment and secret-free job status in the existing Integrations page. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './ConnectorsSection.module.css'

/** Secret-free mailbox state read from the local host. */
export interface AssistantMailSnapshot {
  readonly account: { readonly state: string
    readonly inboxId?: string
    readonly ownerEmail?: string
    readonly contacts: readonly string[]
    readonly sessionId?: string }
  readonly startup?: { readonly supported: boolean; readonly enabled: boolean }
  readonly connection: string
  readonly jobs: readonly { readonly id: string
    readonly title: string
    readonly state: string
    readonly summary?: string
    readonly error?: string }[]
}
/** Local owner configuration; key inputs never enter the chat. */
export interface AssistantMailClient {
  /** Invoke one local owner operation.
   * @param action Status, signup, connect, verify, configure or refresh.
   * @param input Operation properties; secrets are accepted only by connect.
   * @returns Secret-free account and job status.
   */
  call(action: string, input?: Record<string, unknown>): Promise<AssistantMailSnapshot>
}

/** Keep mail enrollment inside the existing connector layout.
 * @param props Local mailbox client.
 * @returns Setup and status section.
 */
export function AssistantMailPanel({ client }: { readonly client: AssistantMailClient }): ReactNode {
  const [snapshot, setSnapshot] = useState<AssistantMailSnapshot>()
  const [owner, setOwner] = useState('')
  const [inbox, setInbox] = useState('')
  const [key, setKey] = useState('')
  const [code, setCode] = useState('')
  const [contacts, setContacts] = useState('')
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let stopped = false
    void client.call('status').then((value) => { if (!stopped) {
      setSnapshot(value)
      // Initial host hydration must never erase text the owner already entered
      // while the asynchronous status request was in flight.
      setOwner(current => current.trim().length > 0 ? current : value.account.ownerEmail ?? '')
      setContacts(current => current.trim().length > 0 ? current : value.account.contacts.join(', '))
    } }, () => { if (!stopped) setFailure('El correo local no está disponible en este host.') })
    return () => { stopped = true }
  }, [client])
  useEffect(() => {
    let stopped = false
    const timer = globalThis.setInterval(() => {
      void client.call('status').then((value) => {
        if (stopped) return
        setSnapshot(value)
        setOwner(current => current.trim().length > 0 ? current : value.account.ownerEmail ?? '')
        setContacts(current => current.trim().length > 0 ? current : value.account.contacts.join(', '))
      }, () => { /* Background status refresh is best-effort. */ })
    }, 5_000)
    return () => { stopped = true; globalThis.clearInterval(timer) }
  }, [client])
  const operate = async (action: string, input?: Record<string, unknown>): Promise<void> => {
    setBusy(true); setFailure(undefined)
    try { setSnapshot(await client.call(action, input)); setKey(''); setCode('') } catch (error) { setFailure(error instanceof Error ? error.message : 'No se pudo completar la operación de correo.') } finally { setBusy(false) }
  }
  const labels: Readonly<Record<string, string>> = { connected: 'Conectado', connecting: 'Conectando', disconnected: 'Sin conexión', 'not-configured': 'Sin configurar', 'quota-reached': 'Límite gratuito alcanzado', received: 'Recibido', pending: 'Pendiente', running: 'Kira está trabajando', verifying: 'Verificando resultado', 'reply-pending': 'Respuesta pendiente', replied: 'Respuesta enviada', blocked: 'Necesita tu atención' }
  const state = snapshot?.account.state
  return <section className={styles.block} aria-label="Correo propio de Phoenix">
    <div className={styles.heading}><h3>Correo propio de Phoenix</h3></div>
    <p>Recibe encargos y contesta cuando Phoenix está ejecutándose en tu PC. Si la PC está apagada, el proveedor conserva los correos y Phoenix recupera únicamente los nuevos al volver a arrancar.
      Buzón del plan gratuito; los modelos mantienen sus límites y costes habituales.</p>
    {snapshot?.account.inboxId === undefined ? null : <p><span>Correo de Kira: </span><strong>{snapshot.account.inboxId}</strong>{' '}<button type="button" disabled={busy} aria-label="Copiar correo de Kira" onClick={() => { void globalThis.navigator?.clipboard?.writeText(snapshot.account.inboxId!) }}>Copiar</button></p>}
    <p role="status">{state === 'ready' ? 'Correo verificado' : state === 'pending-verification' ? 'Pendiente de verificación' : state === 'signup-ambiguous' ? 'Alta sin confirmar: recupera la clave de la cuenta existente.' : 'Sin configurar'}{state === 'ready' ? ` · ${labels[snapshot?.connection ?? 'disconnected'] ?? 'Sin conexión'}` : ''}</p>
    <label>Correo del propietario <input type="email" value={owner} onChange={(event) => { setOwner(event.target.value) }} disabled={busy || state === 'ready'} /></label>
    {state === 'ready' ? null : <>
      {state === 'not-configured' && <><p>Si hay una cuenta de Google conectada, Kira intenta crear su buzón automáticamente en segundo plano. Este botón queda como respaldo manual.</p><button type="button" disabled={busy || !owner} onClick={() => { void operate('signup', { ownerEmail: owner }) }}>Crear mi correo gratuito</button></>}
      <details><summary>Conectar una cuenta existente</summary>
        <label>Dirección del buzón <input type="email" value={inbox} onChange={(event) => { setInbox(event.target.value) }} disabled={busy} /></label>
        <label>Clave de AgentMail <input type="password" autoComplete="off" value={key} onChange={(event) => { setKey(event.target.value) }} disabled={busy} /></label>
        <button type="button" disabled={busy || !owner || !inbox || !key} onClick={() => { void operate('connect', { ownerEmail: owner, inboxId: inbox, apiKey: key }) }}>Conectar buzón</button>
      </details>
    </>}
    {state !== 'pending-verification' ? null : <>
      {snapshot?.account.inboxId === undefined ? null : <p>Kira ya creó su correo. Revisa {snapshot.account.ownerEmail ?? 'tu correo del propietario'} para el código de verificación.</p>}
      <label>Código de verificación <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => { setCode(event.target.value) }} disabled={busy} /></label>
      <button type="button" disabled={busy || !/^\d{6}$/u.test(code)} onClick={() => { void operate('verify', { code }) }}>Verificar correo</button>
    </>}
    {state !== 'ready' ? null : <>
      <label>Remitentes autorizados <input value={contacts} onChange={(event) => { setContacts(event.target.value) }} disabled={busy} placeholder="correo@ejemplo.com" /></label>
      <button type="button" disabled={busy} onClick={() => { void operate('configure', { contacts: contacts.split(',').map(value => value.trim()).filter(Boolean) }) }}>Guardar contactos</button>
    </>}
    {snapshot?.startup?.supported !== true ? null : <label><input type="checkbox" checked={snapshot.startup.enabled} disabled={busy} onChange={(event) => { void operate('startup', { enabled: event.target.checked }) }} /> Iniciar Phoenix en segundo plano al entrar en Windows</label>}
    <button type="button" disabled={busy} onClick={() => { void operate('refresh') }}>Actualizar correo</button>
    {failure === undefined ? null : <p role="alert">{failure}</p>}
    {snapshot?.jobs.slice(-5).reverse().map(job => <p key={job.id}><strong>{job.title}</strong> · {labels[job.state] ?? 'Necesita tu atención'}{job.error === undefined ? '' : ` · ${job.error}`}</p>)}
  </section>
}
