/** Local email enrollment and secret-free job status in the existing Integrations page. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './AssistantMailPanel.module.css'

/** Secret-free mailbox state read from the local host. */
export interface AssistantMailSnapshot {
  readonly account: {
    readonly state: string
    readonly inboxId?: string
    readonly ownerEmail?: string
    readonly contacts: readonly string[]
    readonly sessionId?: string
  }
  readonly startup?: { readonly supported: boolean; readonly enabled: boolean }
  readonly connection: string
  readonly quota?: {
    readonly plan: 'free'
    readonly limits: { readonly inboxes: number; readonly monthlyEmails: number; readonly storageBytes: number }
    readonly used: { readonly inboxes: number; readonly monthlyEmails: number; readonly storageBytes: number; readonly storedMessages: number; readonly threads: number }
    readonly remaining: { readonly inboxes: number; readonly monthlyEmails: number; readonly storageBytes: number }
    readonly utilization: { readonly inboxes: number; readonly monthlyEmails: number; readonly storage: number }
    readonly level: 'ok' | 'watch' | 'high' | 'critical'
    readonly measuredAt: string
    readonly resetsAt: string
  }
  readonly cleanup?: {
    readonly mode: string
    readonly candidateCount: number
    readonly deleted?: number
    readonly failed?: readonly string[]
  }
  readonly jobs: readonly {
    readonly id: string
    readonly title: string
    readonly state: string
    readonly summary?: string
    readonly error?: string
  }[]
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

const JOB_LABELS: Readonly<Record<string, string>> = {
  received: 'Recibido',
  pending: 'Pendiente',
  running: 'Kira está trabajando',
  verifying: 'Verificando resultado',
  'reply-pending': 'Respuesta pendiente',
  replied: 'Respuesta enviada',
  blocked: 'Necesita tu atención',
}

/** Keep Kira mailbox enrollment clear inside the existing connector layout.
 * @param props Local mailbox client.
 * @returns Setup and status card.
 */
export function AssistantMailPanel({ client }: { readonly client: AssistantMailClient }): ReactNode {
  const [snapshot, setSnapshot] = useState<AssistantMailSnapshot>()
  const [owner, setOwner] = useState('')
  const [inbox, setInbox] = useState('')
  const [key, setKey] = useState('')
  const [code, setCode] = useState('')
  const [contacts, setContacts] = useState('')
  const [failure, setFailure] = useState<string>()
  const [cleanup, setCleanup] = useState<AssistantMailSnapshot['cleanup']>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stopped = false
    void client.call('status').then((value) => {
      if (stopped) return
      setSnapshot(value)
      setOwner(current => current.trim().length > 0 ? current : value.account.ownerEmail ?? '')
      setContacts(current => current.trim().length > 0 ? current : value.account.contacts.join(', '))
    }, () => {
      if (!stopped) setFailure('El correo de Kira no está disponible en este host.')
    })
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
    return () => {
      stopped = true
      globalThis.clearInterval(timer)
    }
  }, [client])

  const operate = async (action: string, input?: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const next = await client.call(action, input)
      setSnapshot(next)
      if (next.cleanup !== undefined) setCleanup(next.cleanup)
      setKey('')
      setCode('')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'No se pudo completar la operación de correo.')
    } finally {
      setBusy(false)
    }
  }

  const state = snapshot?.account.state
  const kiraInbox = snapshot?.account.inboxId
  const ready = state === 'ready'
  const pendingVerification = state === 'pending-verification'
  const ambiguous = state === 'signup-ambiguous'
  const connection = snapshot?.connection ?? 'disconnected'
  const statusText = ready
    ? connection === 'connected'
      ? 'Correo verificado · Activo'
      : connection === 'connecting'
        ? 'Correo verificado · Conectando'
        : 'Correo verificado'
    : pendingVerification ? 'Verifica una vez'
      : ambiguous ? 'Necesita recuperación'
        : 'Aún sin correo'
  const statusClass = ready
    ? `${styles.status} ${styles.statusReady}`
    : pendingVerification || ambiguous
      ? `${styles.status} ${styles.statusWarn}`
      : styles.status

  const copyKiraInbox = (): void => {
    if (kiraInbox === undefined) return
    void globalThis.navigator.clipboard.writeText(kiraInbox)
  }
  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB'
    return `${(bytes / (1024 ** 3)).toFixed(bytes >= 1024 ** 3 ? 2 : 3)} GB`
  }
  const quota = snapshot?.quota
  const quotaTone = quota?.level === 'critical' ? 'Crítico'
    : quota?.level === 'high' ? 'Alto'
      : quota?.level === 'watch' ? 'Vigilar' : 'Normal'

  return <section className={styles.mailCard} aria-label="Correo de Kira">
    <div className={styles.hero}>
      <div className={styles.avatar} aria-hidden="true">K</div>
      <div className={styles.heroCopy}>
        <h3>Correo de Kira</h3>
        <p>Su buzón propio para recibir encargos y enviarte resultados.</p>
      </div>
      <span className={statusClass} role="status">{statusText}</span>
    </div>

    {kiraInbox === undefined ? null : <div className={styles.identity}>
      <span className={styles.identityLabel}>Dirección de Kira</span>
      <div className={styles.addressRow}>
        <strong className={styles.address}>{kiraInbox}</strong>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy}
          aria-label="Copiar correo de Kira"
          onClick={copyKiraInbox}
        >
          Copiar
        </button>
      </div>
    </div>}

    {state === 'not-configured' || state === undefined ? <div className={styles.setup}>
      <p className={styles.note}>
        Kira puede crear su buzón gratuito automáticamente. No necesitas abrir AgentMail
        ni generar una clave API.
      </p>
      <label>
        <span className={styles.fieldLabel}>Tu correo para recibir el código de verificación</span>
        <input
          className={styles.field}
          type="email"
          value={owner}
          onChange={(event) => { setOwner(event.target.value) }}
          disabled={busy}
          placeholder="tu@correo.com"
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          disabled={busy || owner.trim().length === 0}
          onClick={() => { void operate('signup', { ownerEmail: owner }) }}
        >
          Configurar correo de Kira
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy}
          onClick={() => { void operate('refresh') }}
        >
          Comprobar estado
        </button>
      </div>
    </div> : null}

    {pendingVerification ? <div className={styles.setup}>
      <p className={styles.note}>
        El buzón ya existe. Revisa {snapshot?.account.ownerEmail ?? 'tu correo'} e introduce
        el código de seis dígitos. No se creará otro buzón.
      </p>
      <label>
        <span className={styles.fieldLabel}>Código de verificación</span>
        <input
          className={styles.field}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => { setCode(event.target.value) }}
          disabled={busy}
          placeholder="123456"
        />
      </label>
      <button
        type="button"
        className={styles.button}
        disabled={busy || !/^\d{6}$/u.test(code)}
        onClick={() => { void operate('verify', { code }) }}
      >
        Verificar y activar
      </button>
    </div> : null}

    {ready ? <>
      {quota === undefined ? null : <section className={styles.quotaPanel} aria-label="Uso del plan AgentMail Free">
        <div className={styles.quotaHeader}>
          <div>
            <strong>AgentMail Free</strong>
            <p>Control automático para mantener a Kira dentro del plan gratuito.</p>
          </div>
          <span className={quota.level === 'ok' ? styles.quotaOk : styles.quotaWarn}>{quotaTone}</span>
        </div>
        <div className={styles.quotaGrid}>
          <div className={styles.quotaMetric}>
            <div className={styles.quotaRow}><span>Buzones</span><strong>{quota.used.inboxes}/{quota.limits.inboxes}</strong></div>
            <progress max={1} value={Math.min(1, quota.utilization.inboxes)} aria-label="Uso de buzones" />
            <small>Quedan {quota.remaining.inboxes}</small>
          </div>
          <div className={styles.quotaMetric}>
            <div className={styles.quotaRow}><span>Emails este mes</span><strong>{quota.used.monthlyEmails}/{quota.limits.monthlyEmails}</strong></div>
            <progress max={1} value={Math.min(1, quota.utilization.monthlyEmails)} aria-label="Uso mensual de emails" />
            <small>Quedan {quota.remaining.monthlyEmails} · reinicia {new Date(quota.resetsAt).toLocaleDateString()}</small>
          </div>
          <div className={styles.quotaMetric}>
            <div className={styles.quotaRow}><span>Almacenamiento</span><strong>{formatBytes(quota.used.storageBytes)}/3.00 GB</strong></div>
            <progress max={1} value={Math.min(1, quota.utilization.storage)} aria-label="Uso de almacenamiento" />
            <small>Quedan {formatBytes(quota.remaining.storageBytes)} · {quota.used.storedMessages} mensajes</small>
          </div>
        </div>
        <p className={styles.help}>
          Phoenix reserva 100 emails de margen para entradas nuevas antes de pausar envíos salientes.
          La limpieza recupera almacenamiento; el contador mensual solo baja cuando reinicia el período.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => { void operate('cleanup-preview', { older_than_days: 7, max_delete: 100 }) }}
          >
            Revisar papelera antigua
          </button>
          {(cleanup?.candidateCount ?? 0) > 0 ? <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => { void operate('cleanup-trash', { older_than_days: 7, max_delete: 100 }) }}
          >
            Eliminar {cleanup?.candidateCount ?? 0} de papelera
          </button> : null}
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => { void operate('refresh') }}
          >
            Actualizar telemetría
          </button>
        </div>
        {cleanup === undefined ? null : <p className={styles.help} role="status">
          {cleanup.mode === 'execute'
            ? `Limpieza: ${cleanup.deleted ?? 0} eliminados${(cleanup.failed?.length ?? 0) > 0 ? ` · ${cleanup.failed?.length ?? 0} no pudieron eliminarse` : ''}.`
            : `Papelera de más de 7 días: ${cleanup.candidateCount} mensaje(s) candidatos.`}
        </p>}
      </section>}
      <p className={styles.help}>
        Si la PC está apagada, el proveedor conserva los mensajes. Al volver a encender Phoenix,
        Kira recupera los nuevos y evita volver a ejecutar los ya procesados.
      </p>
      <details className={styles.advanced}>
        <summary>Opciones</summary>
        <div className={styles.advancedBody}>
          <label>
            <span className={styles.fieldLabel}>Remitentes autorizados</span>
            <input
              className={styles.field}
              value={contacts}
              onChange={(event) => { setContacts(event.target.value) }}
              disabled={busy}
              placeholder="correo@ejemplo.com"
            />
          </label>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => {
              void operate('configure', {
                contacts: contacts.split(',').map(value => value.trim()).filter(Boolean),
              })
            }}
          >
            Guardar remitentes
          </button>
          {snapshot?.startup?.supported === true ? <label className={styles.help}>
            <input
              type="checkbox"
              checked={snapshot.startup.enabled}
              disabled={busy}
              onChange={(event) => {
                void operate('startup', { enabled: event.target.checked })
              }}
            />{' '}
            Iniciar Phoenix en segundo plano con Windows
          </label> : null}
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => { void operate('refresh') }}
          >
            Actualizar estado
          </button>
        </div>
      </details>
    </> : null}

    {ambiguous ? <div className={styles.setup}>
      <p className={styles.failure}>
        El alta pudo haberse completado, pero Phoenix no recibió la confirmación. Por seguridad
        no la repetirá y no creará otro buzón.
      </p>
      <details className={styles.advanced}>
        <summary>Recuperación avanzada</summary>
        <div className={styles.advancedBody}>
          <label>
            <span className={styles.fieldLabel}>Correo del propietario</span>
            <input
              className={styles.field}
              type="email"
              value={owner}
              onChange={(event) => { setOwner(event.target.value) }}
              disabled={busy}
            />
          </label>
          <label>
            <span className={styles.fieldLabel}>Dirección existente de Kira</span>
            <input
              className={styles.field}
              type="email"
              value={inbox}
              onChange={(event) => { setInbox(event.target.value) }}
              disabled={busy}
            />
          </label>
          <label>
            <span className={styles.fieldLabel}>Clave de recuperación de AgentMail</span>
            <input
              className={styles.field}
              type="password"
              autoComplete="off"
              value={key}
              onChange={(event) => { setKey(event.target.value) }}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy || !owner || !inbox || !key}
            onClick={() => {
              void operate('connect', { ownerEmail: owner, inboxId: inbox, apiKey: key })
            }}
          >
            Recuperar buzón existente
          </button>
        </div>
      </details>
    </div> : null}

    {failure === undefined ? null : <p className={styles.failure} role="alert">{failure}</p>}

    {snapshot?.jobs.length === 0 ? null : <details className={styles.advanced}>
      <summary>Actividad reciente</summary>
      <div className={styles.jobs}>
        {snapshot?.jobs.slice(-5).reverse().map(job => <p className={styles.job} key={job.id}>
          <strong>{job.title}</strong> · {JOB_LABELS[job.state] ?? 'Necesita tu atención'}
          {job.error === undefined ? '' : ` · ${job.error}`}
        </p>)}
      </div>
    </details>}
  </section>
}
