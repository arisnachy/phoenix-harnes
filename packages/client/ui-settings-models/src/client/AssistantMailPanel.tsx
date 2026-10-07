/** Local email enrollment and secret-free job status in the existing Integrations page. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './AssistantMailPanel.module.css'

/** Secret-free mailbox state read from the local host. */
export interface AssistantMailSnapshot {
  readonly account: {
    readonly state: string
    readonly inboxId?: string
    readonly ownerEmail?: string
    readonly ownerLink?: 'attached' | 'pending' | 'provider-conflict'
    readonly contacts: readonly string[]
    readonly sessionId?: string
  }
  readonly startup?: { readonly supported: boolean; readonly enabled: boolean }
  readonly connection: string
  readonly jobs: readonly {
    readonly id: string
    readonly title: string
    readonly state: string
    readonly summary?: string
    readonly error?: string
  }[]
}

/** Secret-free result of corroborating a candidate AgentMail Console key. */
export interface AssistantMailConsoleKeyCheck {
  readonly valid: true
  readonly organizationId: string
  readonly authenticationType?: string
  readonly inboxCount: number
  readonly inboxLimit?: number
  readonly capacityAvailable: boolean
  readonly inboxRead: boolean
  readonly currentInboxAccess?: boolean
  readonly messageRead?: boolean
}

/** Local owner configuration; key inputs never enter the chat. */
export interface AssistantMailClient {
  /** Invoke one local owner operation.
   * @param action Status, signup, recover, claim-status, console-key, owner, create-inbox, replace, discard, verify, configure or refresh.
   * @param input Operation properties; secrets are accepted only by explicit local credential actions.
   * @returns Secret-free account and job status.
   */
  call(action: string, input?: Record<string, unknown>): Promise<AssistantMailSnapshot>
  /** Check a candidate Console key without storing it or changing mail state. */
  checkConsoleKey?(apiKey: string): Promise<AssistantMailConsoleKeyCheck>
  /** Retrieve the original receive-only signup key for an explicit local claim action.
   * The Host copies it directly to the local clipboard; the secret never crosses the browser RPC.
   */
  prepareClaim?(): Promise<{ readonly copied: true; readonly inboxId: string; readonly claimUrl: string }>
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
  const [code, setCode] = useState('')
  const [contacts, setContacts] = useState('')
  const [failure, setFailure] = useState<string>()
  const [claimNotice, setClaimNotice] = useState<string>()
  const [consoleKeyCheck, setConsoleKeyCheck] = useState<AssistantMailConsoleKeyCheck>()
  const consoleKeyRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stopped = false
    const refresh = async (reportFailure: boolean): Promise<void> => {
      try {
        const value = await client.call('status')
        if (stopped) return
        setSnapshot(value)
        setOwner(current => current.trim().length > 0 ? current : value.account.ownerEmail ?? '')
        setContacts(current => current.trim().length > 0 ? current : value.account.contacts.join(', '))
      } catch {
        if (reportFailure && !stopped) {
          setFailure('El correo de Kira no está disponible en este host.')
        }
      }
    }
    void refresh(true)
    const timer = globalThis.setInterval(() => { void refresh(false) }, 5_000)
    return () => {
      stopped = true
      globalThis.clearInterval(timer)
    }
  }, [client])

  const operate = async (action: string, input?: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    setClaimNotice(undefined)
    try {
      const value = await client.call(action, input)
      setSnapshot(value)
      if (value.account.ownerEmail !== undefined) setOwner(value.account.ownerEmail)
      setCode('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar la operación de correo.'
      setFailure(message === 'mail provider request failed (403)'
        ? 'AgentMail rechazó la vinculación del propietario. Phoenix conservará el buzón y evitará repetir el alta.'
        : message.includes('has not exposed Console ownership yet')
          ? 'AgentMail todavía no confirma la reclamación. Termina “Claim inbox” en la otra pestaña y vuelve a comprobar; el cambio puede tardar unos minutos.'
          : message.includes('rejected this API key')
            ? 'AgentMail rechazó esta API key. Crea una nueva en tu Console y vuelve a intentarlo.'
            : message.includes('human-owned AgentMail Console organization')
              ? 'Usa una API key creada dentro de tu cuenta humana de AgentMail Console.'
              : message.includes('inbox_create permission')
                ? 'La API key necesita alcance de organización y permiso inbox_create. Crea otra clave de organización con creación de buzones habilitada.'
                : message.includes('Console-key inbox creation is pending')
                  ? 'La creación del buzón con la nueva API key quedó pendiente de confirmación. Vuelve a pegar la misma clave para que Phoenix la reconcilie sin crear otro buzón.'
                  : message)
    } finally {
      setBusy(false)
    }
  }

  const state = snapshot?.account.state
  const kiraInbox = snapshot?.account.inboxId
  const ready = state === 'ready'
  const pendingVerification = state === 'pending-verification'
  const ambiguous = state === 'signup-ambiguous'
  const persistedOwner = snapshot?.account.ownerEmail?.trim().toLowerCase()
  const requestedOwner = owner.trim()
  const ownerChanged = requestedOwner.length > 0 && requestedOwner.toLowerCase() !== persistedOwner
  const ownerLinkConflict = pendingVerification && snapshot?.account.ownerLink === 'provider-conflict'
  const connection = snapshot?.connection ?? 'disconnected'
  const recoveryRequired = ready && (connection === 'verification-required' || connection === 'recovery-required')
  const providerWarning = recoveryRequired || (ready && ['quota-reached', 'message-rejected'].includes(connection))
  const statusText = ready
    ? connection === 'connected'
      ? 'Correo verificado · Activo'
      : connection === 'connecting'
        ? 'Correo verificado · Conectando'
        : connection === 'verification-required'
          ? 'AgentMail requiere verificación'
          : connection === 'recovery-required'
            ? 'AgentMail requiere recuperar acceso'
            : connection === 'quota-reached'
              ? 'Límite gratuito alcanzado'
              : connection === 'message-rejected'
                ? 'Último envío rechazado'
                : 'Correo verificado · Sin conexión'
    : pendingVerification ? ownerLinkConflict ? 'Vincula propietario' : 'Verifica una vez'
      : ambiguous ? 'Necesita recuperación'
        : 'Aún sin correo'
  const statusClass = ready && !providerWarning
    ? `${styles.status} ${styles.statusReady}`
    : pendingVerification || ambiguous || providerWarning
      ? `${styles.status} ${styles.statusWarn}`
      : styles.status

  const copyKiraInbox = (): void => {
    if (kiraInbox === undefined) return
    void globalThis.navigator.clipboard.writeText(kiraInbox)
  }
  const recoverMailbox = (): void => {
    if (ownerChanged) {
      void operate('owner', { ownerEmail: requestedOwner })
      return
    }
    void operate('recover')
  }
  const replaceMailbox = (): void => {
    const label = kiraInbox ?? 'el buzón guardado'
    if (!globalThis.confirm(`Phoenix dejará de usar ${label}. Si la credencial aún funciona, también intentará borrarlo de AgentMail. ¿Crear un buzón nuevo desde cero?`)) return
    void operate('replace', requestedOwner.length === 0 ? undefined : { ownerEmail: requestedOwner })
  }
  const claimMailbox = (): void => {
    // Open the provider page during the user gesture so popup blockers do not eat it while
    // the loopback Host places the credential directly on the Windows clipboard.
    globalThis.open?.('https://console.agentmail.to/claim', '_blank', 'noopener,noreferrer')
    setBusy(true)
    setFailure(undefined)
    setClaimNotice(undefined)
    void (async () => {
      try {
        if (client.prepareClaim === undefined) throw new Error('Esta versión de Phoenix todavía no puede recuperar la clave guardada para reclamar el buzón.')
        const claim = await client.prepareClaim()
        setClaimNotice(`Clave de ${claim.inboxId} copiada por Phoenix. Pégala en “Agent API key”, termina “Claim inbox” y vuelve a Phoenix para comprobar.`)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo preparar la reclamación del buzón.'
        setFailure(message.includes('no longer has the original AgentMail signup key')
          ? 'Phoenix no conserva la clave original de este buzón. AgentMail no permite recuperarla; usa “La clave se perdió · crear buzón nuevo”.'
          : message.includes('only available for US-region')
            ? 'Este buzón no usa una clave am_us_; AgentMail solo permite reclamar por Console los buzones de la región US.'
            : message)
      } finally {
        setBusy(false)
      }
    })()
  }
  const candidateConsoleKey = (): string => consoleKeyRef.current?.value.trim() ?? ''
  const checkConsoleKey = (): void => {
    const apiKey = candidateConsoleKey()
    if (apiKey.length === 0) {
      setFailure('Pega una API key creada en tu cuenta de AgentMail Console.')
      return
    }
    const checker = client.checkConsoleKey
    if (checker === undefined) {
      setFailure('Esta versión de Phoenix todavía no puede corroborar una API key antes de activarla.')
      return
    }
    setBusy(true)
    setFailure(undefined)
    setClaimNotice(undefined)
    setConsoleKeyCheck(undefined)
    void (async () => {
      try {
        setConsoleKeyCheck(await checker(apiKey))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo corroborar la API key.'
        setFailure(message.includes('not organization-scoped')
          ? 'La clave no tiene alcance de organización. Crea una API key de organización en AgentMail Console.'
          : message.includes('rejected this API key')
            ? 'AgentMail rechazó la API key. Comprueba que esté completa, vigente y no revocada.'
            : message.includes('human-owned AgentMail Console organization')
              ? 'La clave no pertenece a una organización humana de AgentMail Console.'
              : message)
      } finally {
        setBusy(false)
      }
    })()
  }
  const useConsoleKey = (): void => {
    const input = consoleKeyRef.current
    const apiKey = candidateConsoleKey()
    if (apiKey.length === 0 || consoleKeyCheck === undefined) {
      setFailure('Primero pega la API key y pulsa “Corroborar API key”.')
      return
    }
    const readyKeyUsable = ready
      ? consoleKeyCheck.currentInboxAccess === true && consoleKeyCheck.messageRead === true
      : consoleKeyCheck.inboxRead && consoleKeyCheck.capacityAvailable
    if (!readyKeyUsable) {
      setFailure(ready
        ? 'La nueva API key todavía no puede leer el buzón actual de Kira y sus mensajes.'
        : 'La comprobación de AgentMail todavía no permite activar Kira con esta clave.')
      return
    }
    setBusy(true)
    setFailure(undefined)
    setClaimNotice(undefined)
    void (async () => {
      try {
        const value = await client.call('console-key', {
          apiKey,
          ...(!ready && persistedOwner === undefined && requestedOwner.length > 0
            ? { ownerEmail: requestedOwner } : {}),
        })
        setSnapshot(value)
        if (value.account.ownerEmail !== undefined) setOwner(value.account.ownerEmail)
        if (input !== null) input.value = ''
        setConsoleKeyCheck(undefined)
        setClaimNotice(ready
          ? `API actualizada. Phoenix corroboró acceso al buzón ${value.account.inboxId ?? 'de Kira'} y lectura de mensajes.`
          : `API guardada y buzón ${value.account.inboxId ?? 'de Kira'} activado. Phoenix comprobó lectura de mensajes antes de marcarlo listo.`)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo activar la API key.'
        setFailure(message.includes('inbox_create permission')
          ? 'La API key necesita alcance de organización y permiso inbox_create.'
          : message.includes('message_read permission')
            ? 'La API key no tiene message_read. Crea o ajusta una clave con inbox_read, message_read y message_send; si vas a crear otro buzón, añade inbox_create.'
            : message.includes('cannot read the current Kira inbox')
              ? 'La API key es válida, pero no puede acceder al buzón actual de Kira. Usa una clave con inbox_read y alcance sobre ese buzón.'
              : message.includes('confirmation is ambiguous')
              ? 'AgentMail no confirmó la creación. Vuelve a pegar la misma API key: Phoenix reconciliará el mismo buzón sin duplicarlo.'
              : message)
      } finally {
        setBusy(false)
      }
    })()
  }
  const consoleKeyReady = consoleKeyCheck !== undefined
    && consoleKeyCheck.inboxRead
    && (ready
      ? consoleKeyCheck.currentInboxAccess === true && consoleKeyCheck.messageRead === true
      : consoleKeyCheck.capacityAvailable)
    && (ready || persistedOwner !== undefined || requestedOwner.length > 0)
  const consoleKeyFallback = <details className={styles.advanced}>
    <summary>API key de AgentMail · verificar o reemplazar</summary>
    <div className={styles.advancedBody}>
      <p className={styles.help}>
        {ready
          ? 'Pega una API key nueva para rotar la credencial de Kira sin cambiar su dirección. Phoenix la corrobora contra la organización, el buzón actual y la lectura de mensajes antes de guardarla.'
          : state === 'not-configured' || state === undefined
            ? 'Si ya tienes AgentMail, puedes usar una API key de tu organización en vez del alta automática. Escribe arriba tu correo propietario y Phoenix corroborará la clave antes de crear el buzón.'
            : 'Si reclamar el buzón falla porque tu correo ya tiene una cuenta de AgentMail, crea una API key en tu organización. Phoenix la corrobora antes de crear el nuevo buzón de Kira.'}
      </p>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={() => { globalThis.open?.('https://console.agentmail.to', '_blank', 'noopener,noreferrer') }}>
        Abrir AgentMail Console · Settings → API Keys
      </button>
      <label>
        <span className={styles.fieldLabel}>Nueva API key de AgentMail</span>
        <input
          ref={consoleKeyRef}
          className={styles.field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          placeholder="am_..."
          aria-label="Nueva API key de AgentMail"
          onChange={() => {
            setConsoleKeyCheck(undefined)
            setFailure(undefined)
          }}
        />
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} disabled={busy}
          onClick={checkConsoleKey}>
          Corroborar API key
        </button>
        <button type="button" className={styles.button}
          disabled={busy || !consoleKeyReady}
          onClick={useConsoleKey}>
          {ready ? 'Guardar API y verificar acceso' : 'Guardar API y activar Kira'}
        </button>
      </div>
      {consoleKeyCheck === undefined ? null : <div className={styles.keyCheck} aria-label="Comprobación de API key">
        <strong>Comprobación de AgentMail</strong>
        <span>API key <b>✓ válida</b></span>
        <span>Organización <b>✓ Console humana</b></span>
        <span>
          Lectura de buzones <b>{consoleKeyCheck.inboxRead ? '✓ disponible' : '✕ falta inbox_read'}</b>
        </span>
        <span>
          Cupo <b>{consoleKeyCheck.inboxLimit === undefined
            ? `${consoleKeyCheck.inboxCount} usados · límite no informado`
            : `${consoleKeyCheck.inboxCount}/${consoleKeyCheck.inboxLimit}`}</b>
        </span>
        {!ready && persistedOwner === undefined ? <span>
          Correo propietario <b>{requestedOwner.length > 0 ? '✓ definido' : '✕ escríbelo arriba'}</b>
        </span> : null}
        {ready ? <>
          <span>
            Buzón actual <b>{consoleKeyCheck.currentInboxAccess ? '✓ accesible' : '✕ sin acceso'}</b>
          </span>
          <span>
            Lectura de mensajes <b>{consoleKeyCheck.messageRead ? '✓ disponible' : '✕ falta message_read'}</b>
          </span>
        </> : <span>
          Nuevo buzón <b>{consoleKeyCheck.capacityAvailable ? '✓ hay capacidad' : '✕ límite alcanzado'}</b>
        </span>}
        <small>
          {ready
            ? 'Phoenix no reemplaza la clave guardada hasta comprobar el buzón actual y message_read. message_send se confirma cuando Kira realiza un envío.'
            : 'La creación comprueba inbox_create y, antes de marcar Kira como lista, Phoenix comprueba inbox_read y message_read. message_send se confirma cuando Kira realiza un envío.'}
        </small>
      </div>}
      <p className={styles.help}>
        La corroboración no guarda ni cambia nada. {ready
          ? 'Solo al confirmar Phoenix sustituye la credencial guardada, manteniendo el mismo buzón.'
          : 'Solo al confirmar Phoenix crea el nuevo buzón y guarda la clave en Credenciales.'}
        {' '}Para una clave restringida usa inbox_read, message_read y message_send; añade inbox_create cuando Phoenix deba crear el buzón.
      </p>
    </div>
  </details>
  const recoveryOwnerField = <label>
    <span className={styles.fieldLabel}>Correo propietario que recibirá el código</span>
    <input
      className={styles.field}
      type="email"
      value={owner}
      onChange={(event) => { setOwner(event.target.value) }}
      disabled={busy}
      placeholder="tu@correo.com"
    />
  </label>

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

    {recoveryRequired ? <div className={styles.setup}>
      <p className={styles.failure}>
        AgentMail rechazó la credencial actual. Phoenix puede renovar el acceso con el propietario
        ya guardado; no necesitas crear ni pegar una clave API.
      </p>
      <button type="button" className={styles.button} disabled={busy}
        onClick={() => { void operate('recover') }}>
        Recuperar acceso y verificar
      </button>
    </div> : null}

    {ready && connection === 'quota-reached' ? <div className={styles.setup}>
      <p className={styles.failure}>
        AgentMail alcanzó el límite gratuito de buzones o recursos. No se solicitará ningún plan de pago.
        Si quieres sustituir este buzón, elimina el actual antes de crear el nuevo.
      </p>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={replaceMailbox}>
        Sustituir este buzón
      </button>
    </div> : null}

    {ready && connection === 'message-rejected' ? <p className={styles.failure}>
      AgentMail rechazó el último envío. Revisa que el destinatario siga autorizado; si AgentMail pide
      verificación, usa Recuperar acceso.
    </p> : null}

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

    {ownerLinkConflict ? <div className={styles.setup}>
      <p className={styles.note}>
        El buzón ya fue creado y Phoenix conservó su clave, pero AgentMail rechazó asociar este correo
        como propietario. Esto ocurre, entre otros casos, cuando ese correo ya pertenece a una cuenta
        de AgentMail. No introduzcas un código: AgentMail todavía no lo ha enviado.
      </p>
      <button type="button" className={styles.button} disabled={busy}
        onClick={() => { void operate('recover') }}>
        Reintentar vinculación
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={claimMailbox}>
        Copiar clave y abrir AgentMail
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={() => { void operate('claim-status') }}>
        Ya lo reclamé · comprobar
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={replaceMailbox}>
        La clave se perdió · crear buzón nuevo
      </button>
      <p className={styles.help}>
        Phoenix usa la clave original que guardó al crear el buzón; no necesitas haberla recibido por correo.
        No creará buzones adicionales mientras este vínculo siga pendiente.
      </p>
    </div> : null}

    {pendingVerification && !ownerLinkConflict ? <div className={styles.setup}>
      <p className={styles.note}>
        El buzón ya existe. Revisa el correo propietario antes de introducir el código.
        Si estaba mal escrito, corrígelo aquí y Phoenix pedirá un código nuevo sin clave API.
      </p>
      {recoveryOwnerField}
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
      <button type="button" className={styles.secondaryButton}
        disabled={busy || requestedOwner.length === 0}
        onClick={recoverMailbox}>
        {ownerChanged ? 'Corregir correo y reenviar código' : 'Reenviar código / recuperar acceso'}
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={claimMailbox}>
        No llegó el código · reclamar con la clave guardada
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={() => { void operate('claim-status') }}>
        Ya lo reclamé · comprobar
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={replaceMailbox}>
        Eliminar buzón viejo y empezar de nuevo
      </button>
    </div> : null}

    {ready ? <>
      <p className={styles.help}>
        Si la PC está apagada, el proveedor conserva los mensajes. Al volver a encender Phoenix,
        Kira recupera los nuevos y evita volver a ejecutar los ya procesados.
      </p>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={() => { void operate('create-inbox') }}>
        Crear otro buzón
      </button>
      <p className={styles.help}>
        Creará otra dirección en la misma cuenta, si la cuota disponible lo permite. No borra el buzón anterior.
      </p>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={() => { void operate('recover') }}>
        Recuperar acceso
      </button>
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
          <button type="button" className={styles.secondaryButton} disabled={busy}
            onClick={replaceMailbox}>
            Eliminar este buzón y empezar de nuevo
          </button>
        </div>
      </details>
    </> : null}

    {ambiguous ? <div className={styles.setup}>
      <p className={styles.failure}>
        Phoenix no pudo confirmar el alta. Revisa el correo propietario: si tiene un error, corrígelo antes
        de continuar. Phoenix recuperará el buzón existente o iniciará uno nuevo para el correo corregido,
        sin pedir contraseña ni clave API.
      </p>
      {recoveryOwnerField}
      <button type="button" className={styles.button}
        disabled={busy || requestedOwner.length === 0}
        onClick={recoverMailbox}>
        {ownerChanged ? 'Corregir correo y continuar' : 'Recuperar y continuar'}
      </button>
      <button type="button" className={styles.secondaryButton} disabled={busy}
        onClick={replaceMailbox}>
        No se puede recuperar: crear uno nuevo
      </button>
      <p className={styles.help}>
        Phoenix intentará borrar el buzón anterior si conserva acceso. Si la credencial ya no sirve,
        olvidará ese buzón localmente para que no bloquee una configuración nueva.
      </p>
    </div> : null}

    {consoleKeyFallback}

    {claimNotice === undefined ? null : <p className={styles.help} role="status">{claimNotice}</p>}
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
