/** Setup for a BotFather-issued token, deliberately separate from MCP/OAuth. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface TelegramBotSnapshot {
  configured: boolean
  verified: boolean
  phase: 'unconfigured' | 'verified' | 'invalid-token' | 'unreachable' | 'credentials-unavailable'
  username?: string
  inboxActive: false
}

export interface TelegramBotClient {
  state(): Promise<TelegramBotSnapshot>
  configure(token: string): Promise<TelegramBotSnapshot>
  disconnect(): Promise<TelegramBotSnapshot>
}

const BOTFATHER = 'https://t.me/BotFather'
const GUIDE = 'https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/telegram.md'
const STATUS: Record<TelegramBotSnapshot['phase'], string> = {
  unconfigured: 'Sin configurar',
  verified: 'Bot verificado · receptor pendiente',
  'invalid-token': 'Token guardado no válido',
  unreachable: 'Telegram no respondió · comprueba conexión',
  'credentials-unavailable': 'Vault de Phoenix no disponible',
}

export function TelegramConnectorSetup({ client }: { client?: TelegramBotClient | undefined }): ReactNode {
  const [snapshot, setSnapshot] = useState<TelegramBotSnapshot | undefined>()
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (client === undefined) return
    let cancelled = false
    void client.state().then(
      next => { if (!cancelled) setSnapshot(next) },
      () => { if (!cancelled) setError('No se pudo consultar el estado de Telegram en este Host.') },
    )
    return () => { cancelled = true }
  }, [client])

  const configure = (): void => {
    if (client === undefined || busy || token.trim() === '') return
    setBusy(true)
    setError(undefined)
    void client.configure(token).then(
      next => {
        setSnapshot(next)
        setToken('')
        setOpen(false)
      },
      () => { setError('No se pudo verificar el token con Telegram. Comprueba BotFather y tu conexión; el token anterior no se sustituyó.') },
    ).finally(() => { setBusy(false) })
  }

  const disconnect = (): void => {
    if (client === undefined || busy) return
    setBusy(true)
    setError(undefined)
    void client.disconnect().then(
      next => { setSnapshot(next); setToken('') },
      () => { setError('No se pudo quitar el token del vault local.') },
    ).finally(() => { setBusy(false) })
  }

  const username = snapshot?.username
  const canOpenBot = username !== undefined && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)
  return (
    <div data-telegram-setup="true" style={{ display: 'grid', gap: 9 }}>
      <p role="status" style={{ margin: 0, fontSize: 12 }}>
        {snapshot === undefined ? 'Comprobando configuración…' : STATUS[snapshot.phase]}
        {canOpenBot ? ` · @${username}` : ''}
      </p>
      <p style={{ margin: 0, fontSize: 11 }}>
        La verificación comprueba la identidad del bot; aún no significa que Telegram pueda recibir mensajes o ejecutar tareas en Phoenix.
      </p>
      <details>
        <summary>Instrucciones para configurar Telegram con Kira</summary>
        <ol style={{ fontSize: 12, paddingLeft: 20 }}>
          <li>Abre <a href={BOTFATHER} target="_blank" rel="noreferrer">@BotFather oficial</a> en Telegram.</li>
          <li>Envía <code>/newbot</code> y elige un nombre, por ejemplo Kira Phoenix.</li>
          <li>Elige un usuario terminado en <code>bot</code>, que esté disponible.</li>
          <li>Copia el token entregado por BotFather y pégalo solamente en el campo seguro de Phoenix.</li>
          <li>Pulsa «Guardar y verificar». Si es válido, Phoenix mostrará el usuario real del bot.</li>
          <li>Abre el bot en Telegram y pulsa «Iniciar». La vinculación de tu identidad y el receptor de mensajes se activarán en una siguiente etapa.</li>
        </ol>
        <p style={{ fontSize: 11 }}>No envíes el token por el chat ni lo incluyas en GitHub. El token es distinto de la autenticación de voz Codex.</p>
        <a href={GUIDE} target="_blank" rel="noopener noreferrer">Guía completa de Phoenix</a>
      </details>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => { setOpen(value => !value); setError(undefined) }} disabled={busy}>
          {open ? 'Ocultar configuración' : snapshot?.configured ? 'Cambiar token' : 'Configurar Telegram'}
        </button>
        {canOpenBot ? <a href={`https://t.me/${username}`} target="_blank" rel="noopener noreferrer">Abrir mi bot</a> : null}
        {snapshot?.configured ? <button type="button" disabled={busy} onClick={disconnect}>Desconectar</button> : null}
      </div>
      {open ? (
        <form onSubmit={(event) => { event.preventDefault(); configure() }} style={{ display: 'grid', gap: 7 }}>
          <label htmlFor="phoenix-telegram-token">Token del bot entregado por BotFather</label>
          <input id="phoenix-telegram-token" type="password" autoComplete="new-password"
            placeholder="123456789:AA…" value={token} disabled={busy || client === undefined}
            onChange={(event) => { setToken(event.target.value) }} />
          <button type="submit" disabled={busy || client === undefined || token.trim().length < 32}>
            {busy ? 'Verificando…' : 'Guardar y verificar'}
          </button>
        </form>
      ) : null}
      {error === undefined ? null : <p role="alert" style={{ fontSize: 11, margin: 0 }}>{error}</p>}
    </div>
  )
}
