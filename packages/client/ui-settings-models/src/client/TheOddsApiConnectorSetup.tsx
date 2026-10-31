/** Trusted Host-backed connector for The Odds API v4 (not TheOddsAPI). */
import { useState } from 'react'
import type { ReactNode } from 'react'

export interface TheOddsApiSnapshot {
  configured: boolean
  verified: boolean
  source: 'vault' | 'environment' | 'none'
  status: 'ready' | 'unconfigured' | 'invalid-key' | 'unreachable' | 'rate-limited' | 'vault-unavailable'
  requestsRemaining?: number
  requestsUsed?: number
  lastRequestCost?: number
}

export interface TheOddsApiClient {
  state(): Promise<TheOddsApiSnapshot>
  configure(key: string): Promise<TheOddsApiSnapshot>
  disconnect(): Promise<TheOddsApiSnapshot>
}

const MESSAGES: Record<TheOddsApiSnapshot['status'], string> = {
  ready: 'Conectada · API key verificada',
  unconfigured: 'Sin configurar',
  'invalid-key': 'Clave rechazada por el proveedor',
  unreachable: 'Clave guardada · sin verificación de red',
  'rate-limited': 'Proveedor limitó temporalmente las solicitudes',
  'vault-unavailable': 'Almacén seguro no disponible en este Host',
}

export function TheOddsApiConnectorSetup({ client, snapshot, onStatus }: {
  client?: TheOddsApiClient | undefined
  snapshot?: TheOddsApiSnapshot | undefined
  onStatus: (state: TheOddsApiSnapshot) => void
}): ReactNode {
  const [input, setInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [feedback, setFeedback] = useState<string | undefined>()

  const save = (): void => {
    if (!client || busy || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.trim())) return
    setBusy(true)
    setError(undefined)
    setFeedback(undefined)
    void client.configure(input.trim()).then((next) => {
      onStatus(next)
      setInput('')
      setEditing(false)
      setFeedback(next.verified
        ? 'Clave guardada en el vault y conexión comprobada.'
        : 'Clave guardada en el vault. No se pudo verificar la conexión; usa Comprobar conexión.')
    }, () => {
      setError('No se pudo guardar la clave o el proveedor la rechazó. La clave anterior permanece intacta.')
    }).finally(() => {
      setBusy(false)
    })
  }

  const refresh = (): void => {
    if (!client || busy) return
    setBusy(true)
    setError(undefined)
    setFeedback(undefined)
    void client.state().then(onStatus, () => {
      setError('No se pudo comprobar la conexión con el Host.')
    }).finally(() => {
      setBusy(false)
    })
  }

  const disconnect = (): void => {
    if (!client || busy || snapshot?.source !== 'vault') return
    setBusy(true)
    setError(undefined)
    setFeedback(undefined)
    void client.disconnect().then((next) => {
      onStatus(next)
      setInput('')
      setEditing(false)
      setFeedback('Clave eliminada del vault de PHOENIX.')
    }, () => {
      setError('No se pudo eliminar la clave guardada.')
    }).finally(() => {
      setBusy(false)
    })
  }

  return <div data-odds-api-setup="v4" style={{ display: 'grid', gap: 9, minWidth: 0 }}>
    <p role="status" style={{ margin: 0, fontSize: 12, fontWeight: 650 }}>
      {snapshot === undefined ? 'Comprobando The Odds API…' : MESSAGES[snapshot.status]}
      {snapshot?.source === 'environment' ? ' · Configurada por variable de entorno' : ''}
    </p>
    {snapshot?.requestsRemaining !== undefined || snapshot?.requestsUsed !== undefined
      ? (
          <p style={{ margin: 0, fontSize: 11 }}>
            Créditos: {snapshot.requestsRemaining === undefined ? 'no informados' : `${snapshot.requestsRemaining} restantes`}
            {snapshot.requestsUsed === undefined ? '' : ` · ${snapshot.requestsUsed} usados`}
            {' · '}Sujeto a tu plan
          </p>
        )
      : null}
    <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55 }}>
      La clave se guarda exclusivamente en el almacén de credenciales del Host.
      Kira podrá usarla en sus consultas deportivas; nunca se expone en el chat.
      Comprobar conexión utiliza el catálogo /v4/sports, sin gastar créditos.
      El plan gratuito tiene límites y los históricos pueden requerir pago.
    </p>
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      <button type="button" disabled={busy || !client} onClick={() => {
        setEditing(!editing)
        setError(undefined)
      }}>
        {editing ? 'Cancelar' : snapshot?.configured ? 'Cambiar API key' : 'Añadir API key'}
      </button>
      <button type="button" disabled={busy || !client} onClick={refresh}>
        {busy ? 'Comprobando…' : 'Comprobar conexión'}
      </button>
      {snapshot?.source === 'vault'
        ? <button type="button" disabled={busy} onClick={disconnect}>Desconectar</button>
        : null}
    </div>
    {editing
      ? <form onSubmit={(event) => {
        event.preventDefault()
        save()
      }} style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="phoenix-the-odds-api-key" style={{ fontSize: 12, fontWeight: 600 }}>API key · The Odds API v4</label>
          <input id="phoenix-the-odds-api-key" type="password" autoComplete="new-password"
            spellCheck={false} placeholder="Pega aquí tu API key"
            value={input} disabled={busy || !client} onChange={(event) => {
              setInput(event.target.value)
            }}
            minLength={16} maxLength={128}/>
          <button type="submit" disabled={busy || !client || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.trim())}>
            {busy ? 'Verificando…' : 'Guardar en el vault y verificar'}
          </button>
        </form>
      : null}
    {feedback ? <p role="status" style={{ fontSize: 11, margin: 0 }}>{feedback}</p> : null}
    {error ? <p role="alert" style={{ fontSize: 11, margin: 0 }}>{error}</p> : null}
    <p style={{ margin: 0, fontSize: 11 }}>
      <a href="https://the-odds-api.com/" target="_blank" rel="noopener noreferrer">Obtener API key</a>
      {' · '}
      <a href="https://the-odds-api.com/liveapi/guides/v4/" target="_blank" rel="noopener noreferrer">Documentación oficial</a>
    </p>
  </div>
}
