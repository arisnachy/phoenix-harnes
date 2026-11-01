/** Setup for a BotFather-issued token, deliberately separate from MCP/OAuth. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface TelegramBotSnapshot {
  configured: boolean
  verified: boolean
  phase: 'unconfigured' | 'verified' | 'invalid-token' | 'unreachable' | 'credentials-unavailable'
  username?: string
  inboxActive: boolean
  paired: boolean
  reason?: string
}

export interface TelegramBotClient {
  state(): Promise<TelegramBotSnapshot>
  configure(token: string): Promise<TelegramBotSnapshot>
  disconnect(): Promise<TelegramBotSnapshot>
  pairing(): Promise<{ code: string; expiresInSeconds: number }>
}

const BOTFATHER = 'https://t.me/BotFather'
const GUIDE = 'https://github.com/arisnachy/phoenix-harnes/blob/stable/docs/connectors/telegram.md'
const STATUS: Record<TelegramBotSnapshot['phase'], string> = {
  unconfigured: 'Sin configurar',
  verified: 'Bot verificado',
  'invalid-token': 'Token guardado no válido',
  unreachable: 'Telegram no respondió · comprueba conexión',
  'credentials-unavailable': 'Vault de Phoenix no disponible',
}

export function TelegramConnectorSetup({ client }: { client?: TelegramBotClient | undefined }): ReactNode {
  const [snapshot, setSnapshot] = useState<TelegramBotSnapshot | undefined>()
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)
  const [pairCode, setPairCode] = useState<string | undefined>()
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

  const refresh = (): void => {
    if (client === undefined) return
    void client.state().then(setSnapshot).catch(() => setError('No se pudo actualizar el estado de Telegram.'))
  }
  const pair = (): void => {
    if (client === undefined) return
    setBusy(true)
    setError(undefined)
    void client.pairing().then(
      response => { setPairCode(response.code) },
      () => { setError('No se pudo generar el código para vincular tu cuenta.') },
    ).finally(() => setBusy(false))
  }
  const username = snapshot?.username
  const canOpenBot = username !== undefined && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)
  return (
    <div data-telegram-setup="true" style={{ display: 'grid', gap: 9 }}>
      <p role="status" style={{ margin: 0, fontSize: 12 }}>
        {snapshot === undefined ? 'Comprobando configuración…' : STATUS[snapshot.phase]}
        {canOpenBot ? ` · @${username}` : ''}
        {snapshot?.inboxActive ? ' · receptor activo' : ' · receptor no confirmado'}
        {snapshot?.paired ? ' · usuario vinculado' : ' · falta vincular usuario'}
      </p>
      {snapshot?.reason ? (
        <p role="alert" style={{ margin: 0, fontSize: 11 }}>
          {snapshot.reason === 'telegram-webhook-active'
            ? 'Hay un webhook activado en Telegram. Desactívalo en el otro servicio.'
            : snapshot.reason === 'telegram-polling-conflict'
              ? 'Otro programa está leyendo este bot. Solo puede funcionar un receptor.'
              : snapshot.reason === 'telegram-unreachable'
                ? 'El receptor no logra consultar Telegram. Revisa Internet, firewall o proxy.'
                : `Receptor: ${snapshot.reason}`}
        </p>
      ) : null}
      {snapshot?.configured && !snapshot.paired ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <button type="button" disabled={busy} onClick={pair}>Generar código de vinculación (15 min)</button>
          {pairCode ? <p style={{ fontSize: 12, margin: 0 }}>En el chat privado de tu bot, envía <code>/start {pairCode}</code>. Luego pulsa «Actualizar estado».</p> : null}
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: 11 }}>
        El bot recibe mensajes solo mientras el Host de Phoenix está en ejecución y tu usuario está vinculado. Las notas de voz y las llamadas de Codex se integrarán aparte; el texto nunca activa el micrófono.
      </p>
      <details>
        <summary>Instrucciones para configurar Telegram con Kira</summary>
        <ol style={{ fontSize: 12, paddingLeft: 20 }}>
          <li>Abre <a href={BOTFATHER} target="_blank" rel="noreferrer">@BotFather oficial</a> en Telegram.</li>
          <li>Envía <code>/newbot</code> y elige un nombre, por ejemplo Kira Phoenix.</li>
          <li>Elige un usuario terminado en <code>bot</code>, que esté disponible.</li>
          <li>Copia el token entregado por BotFather y pégalo solamente en el campo seguro de Phoenix.</li>
          <li>Pulsa «Guardar y verificar». Si es válido, Phoenix mostrará el usuario real del bot.</li>
          <li>Pulsa «Generar código de vinculación», abre tu bot y envía <code>/start CODIGO</code> sustituyendo CODIGO por el número mostrado.</li>
          <li>Tras recibir la confirmación de Kira, envía un mensaje de texto. Phoenix lo procesará a través del Agent real.</li>
        </ol>
        <p style={{ fontSize: 11 }}>No envíes el token por el chat ni lo incluyas en GitHub. El token es distinto de la autenticación de voz Codex.</p>
        <a href={GUIDE} target="_blank" rel="noopener noreferrer">Guía completa de Phoenix</a>
      </details>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => { setOpen(value => !value); setError(undefined) }} disabled={busy}>
          {open ? 'Ocultar configuración' : snapshot?.configured ? 'Cambiar token' : 'Configurar Telegram'}
        </button>
        {canOpenBot ? <a href={`https://t.me/${username}`} target="_blank" rel="noopener noreferrer">Abrir mi bot</a> : null}
        {snapshot?.configured ? <button type="button" disabled={busy} onClick={refresh}>Actualizar estado</button> : null}
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
