import { useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from '@phoenix-ai/cordis'
import type { IApiClient, ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import { StateDot } from '@phoenix-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { resultText } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './connector-list-row.module.css'

type AuthorizationClient = IApiClient['authorization']
type ConnectorListRowProps = ToolCallViewProps & PropsLocale<'conversation'> & {
  authorization: AuthorizationClient
}

interface ConnectorView {
  id: string
  label: string
  status: string
  recommended_action: string
  relevant: true
}

interface AuthorizationPromptView {
  promptId: string
  kind: 'text' | 'secret' | 'select'
  message: string
  placeholder?: string
  options?: Array<{ id: string; label: string; description?: string }>
}

function actionableConnectors(block: ToolCallViewProps['block']): ConnectorView[] {
  if (!('kind' in block) || block.isError) return []
  try {
    const parsed = JSON.parse(resultText(block)) as { kind?: unknown; connectors?: unknown }
    if (parsed.kind !== 'connector_list' || !Array.isArray(parsed.connectors)) return []
    return parsed.connectors.filter((value): value is ConnectorView => {
      if (typeof value !== 'object' || value === null) return false
      const candidate = value as Partial<ConnectorView>
      return typeof candidate.id === 'string'
        && typeof candidate.label === 'string'
        && typeof candidate.status === 'string'
        && candidate.relevant === true
        && candidate.recommended_action === 'connect-or-reconnect'
    })
  } catch {
    return []
  }
}

function connectorServerName(connector: ConnectorView): string | undefined {
  return connector.id.startsWith('mcp:') ? connector.id.slice(4) : undefined
}

function strings() {
  const spanish = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es')
  return spanish
    ? {
      title: 'Conector requerido',
      needs: 'Necesita autorización para continuar.',
      connect: 'Conectar',
      reconnect: 'Reconectar',
      connecting: 'Conectando…',
      preparing: 'Preparando la autorización…',
      openAuth: 'Abrir autorización',
      code: 'Código',
      connected: 'Conectado',
      failed: 'No se pudo conectar',
      cancelled: 'Conexión cancelada',
      missing: 'No hay un flujo de autorización disponible para este conector.',
      continue: 'Continuar',
    }
    : {
      title: 'Connector required',
      needs: 'Needs authorization to continue.',
      connect: 'Connect',
      reconnect: 'Reconnect',
      connecting: 'Connecting…',
      preparing: 'Preparing authorization…',
      openAuth: 'Open authorization',
      code: 'Code',
      connected: 'Connected',
      failed: 'Connection failed',
      cancelled: 'Connection cancelled',
      missing: 'No authorization flow is available for this connector.',
      continue: 'Continue',
    }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })
}

function ConnectorListRow({ block, authorization }: ConnectorListRowProps) {
  const copy = strings()
  const connectors = useMemo(() => actionableConnectors(block), [block])
  const connector = connectors[0]
  const [flowKey, setFlowKey] = useState<string | undefined>()
  const [flowMethod, setFlowMethod] = useState<string>('oauth')
  const [stored, setStored] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'pending' | 'authorized' | 'cancelled' | 'failed'>('idle')
  const [error, setError] = useState<string | undefined>()
  const [detail, setDetail] = useState<string | undefined>()
  const [authorizationUrl, setAuthorizationUrl] = useState<string | undefined>()
  const [authorizationCode, setAuthorizationCode] = useState<string | undefined>()
  const [prompt, setPrompt] = useState<AuthorizationPromptView | undefined>()
  const [promptAnswer, setPromptAnswer] = useState('')
  const [attemptId, setAttemptId] = useState<string | undefined>()
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (connector === undefined) return
    let stale = false
    void authorization.list({}).then((response) => {
      if (stale || !response.result.ok) return
      const serverName = connectorServerName(connector)?.toLowerCase().replaceAll('_', '-')
      const entry = response.result.value.entries.find(candidate =>
        candidate.label === connector.label
        || (serverName !== undefined && candidate.key.toLowerCase().endsWith(`/${serverName}`)),
      )
      if (entry === undefined) return
      setFlowKey(entry.key)
      setFlowMethod(entry.methods[0]?.id ?? 'oauth')
      setStored(entry.stored !== undefined)
    })
    return () => { stale = true }
  }, [authorization, connector?.id, connector?.label])

  if (connector === undefined) return null

  const begin = async (): Promise<void> => {
    if (flowKey === undefined || phase === 'pending') return
    setError(undefined)
    setDetail(copy.preparing)
    setAuthorizationUrl(undefined)
    setAuthorizationCode(undefined)
    setPrompt(undefined)
    setPromptAnswer('')
    setAttemptId(undefined)
    setPhase('pending')
    const popup = flowMethod === 'oauth' ? window.open('', '_blank') : null
    if (popup !== null) {
      try {
        popup.document.title = `${connector.label} · PHOENIX`
        popup.document.body.textContent = copy.preparing
      } catch {
        // The reserved popup is best-effort. The card exposes a manual link once the Host emits one.
      }
    }
    try {
      const started = await authorization.begin({ key: flowKey, method: flowMethod })
      if (!started.result.ok) throw new Error(started.result.error.message)
      setAttemptId(started.result.value.attemptId)
      let after = 0
      let openedUrl: string | undefined
      while (alive.current) {
        const status = await authorization.status({ attemptId: started.result.value.attemptId, after })
        if (!status.result.ok) throw new Error(status.result.error.message)
        const view = status.result.value
        after = view.nextSeq
        const latest = view.notices.at(-1)?.notice
        const consent = view.notices.findLast(item => item.notice.url !== undefined)?.notice
        const codeNotice = view.notices.findLast(item => item.notice.code !== undefined)?.notice
        if (latest?.message !== undefined) setDetail(latest.message)
        if (consent?.url !== undefined) {
          setAuthorizationUrl(consent.url)
          if (consent.url !== openedUrl) {
            openedUrl = consent.url
            if (popup !== null && !popup.closed) {
              try {
                popup.location.href = consent.url
              } catch {
                // Browser isolation can reject scripted navigation; the visible manual link remains usable.
              }
            }
          }
        }
        if (codeNotice?.code !== undefined) setAuthorizationCode(codeNotice.code)
        if (view.prompt !== undefined) setPrompt(view.prompt)
        if (view.status === 'pending') {
          await sleep(350)
          continue
        }
        if (popup !== null && !popup.closed) popup.close()
        if (view.status === 'authorized') {
          setStored(true)
          setPhase('authorized')
          return
        }
        if (view.status === 'cancelled') {
          setPhase('cancelled')
          return
        }
        setError(view.error)
        setPhase('failed')
        return
      }
    } catch (cause) {
      if (popup !== null && !popup.closed) popup.close()
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setPhase('failed')
      }
    }
  }

  const submitPrompt = async (): Promise<void> => {
    if (attemptId === undefined || prompt === undefined || phase !== 'pending') return
    try {
      const answered = await authorization.answer({
        attemptId,
        promptId: prompt.promptId,
        value: promptAnswer,
      })
      if (!answered.result.ok) throw new Error(answered.result.error.message)
      setPrompt(undefined)
      setPromptAnswer('')
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const displayLabel = connector.label.replace(/^MCP\s+/i, '')
  const actionLabel = phase === 'pending'
    ? copy.connecting
    : phase === 'authorized'
      ? copy.connected
      : stored ? copy.reconnect : copy.connect
  const statusText = phase === 'failed'
    ? copy.failed
    : phase === 'cancelled'
      ? copy.cancelled
      : phase === 'authorized'
        ? copy.connected
        : phase === 'pending' && detail !== undefined
          ? detail
          : copy.needs

  return (
    <div className={css.card} data-connector-auth-card>
      <div className={css.icon} aria-hidden="true">
        {phase === 'failed'
          ? <StateDot state="error" />
          : <span className={css.monogram}>{displayLabel.slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className={css.copy}>
        <strong>{displayLabel}</strong>
        <span>{statusText}</span>
        {authorizationCode === undefined ? null : <span>{`${copy.code}: ${authorizationCode}`}</span>}
        {authorizationUrl === undefined ? null : (
          <a href={authorizationUrl} target="_blank" rel="noreferrer">{copy.openAuth}</a>
        )}
        {prompt === undefined ? null : (
          <div className={css.prompt}>
            <label>
              <span>{prompt.message}</span>
              {prompt.kind === 'select'
                ? (
                  <select value={promptAnswer} onChange={(event) => { setPromptAnswer(event.target.value) }}>
                    <option value="" />
                    {prompt.options?.map(option => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                )
                : (
                  <input
                    type={prompt.kind === 'secret' ? 'password' : 'text'}
                    autoComplete="off"
                    value={promptAnswer}
                    placeholder={prompt.placeholder}
                    onChange={(event) => { setPromptAnswer(event.target.value) }}
                  />
                )}
            </label>
            <button
              type="button"
              className={css.button}
              disabled={promptAnswer.length === 0}
              onClick={() => { void submitPrompt() }}
            >
              {copy.continue}
            </button>
          </div>
        )}
        {error === undefined ? null : <span className={css.error}>{error}</span>}
      </div>
      {phase === 'authorized' ? (
        <span className={css.success} aria-label={copy.connected}>✓</span>
      ) : (
        <button
          type="button"
          className={css.button}
          disabled={flowKey === undefined || phase === 'pending'}
          title={flowKey === undefined ? copy.missing : undefined}
          onClick={() => { void begin() }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export const connectorListToolview = {
  name: 'connector-list-toolview',
  inject: ['slots', 'connection'],
  apply(ctx: Context): void {
    const connection = ctx.get('connection') as ConnectionHandle
    const authorization = connection.api.authorization
    const BoundConnectorListRow = (props: ToolCallViewProps & PropsLocale<'conversation'>) => (
      <ConnectorListRow {...props} authorization={authorization} />
    )
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: 'connector_list',
      locale: NS,
    }, BoundConnectorListRow))
  },
}
