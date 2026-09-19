import { useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from '@phoenix-ai/cordis'
import type { IApiClient, ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import { IconApiOutline14, StateDot } from '@phoenix-ai/dsh-client-ui-primitives'
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
        needs: 'necesita autorización para continuar.',
        connect: 'Conectar',
        reconnect: 'Reconectar',
        connecting: 'Conectando…',
        connected: 'Conectado',
        failed: 'No se pudo conectar',
        cancelled: 'Conexión cancelada',
        missing: 'No hay un flujo de autorización disponible para este conector.',
      }
    : {
        title: 'Connector required',
        needs: 'needs authorization to continue.',
        connect: 'Connect',
        reconnect: 'Reconnect',
        connecting: 'Connecting…',
        connected: 'Connected',
        failed: 'Connection failed',
        cancelled: 'Connection cancelled',
        missing: 'No authorization flow is available for this connector.',
      }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => { window.setTimeout(resolve, ms) })
}

function ConnectorListRow({ block, authorization }: ConnectorListRowProps) {
  const copy = strings()
  const connectors = useMemo(() => actionableConnectors(block), [block])
  const connector = connectors[0]
  const [flowKey, setFlowKey] = useState<string | undefined>()
  const [stored, setStored] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'pending' | 'authorized' | 'cancelled' | 'failed'>('idle')
  const [error, setError] = useState<string | undefined>()
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
      setStored(entry.stored !== undefined)
    })
    return () => { stale = true }
  }, [authorization, connector?.id, connector?.label])

  if (connector === undefined) return null

  const begin = async (): Promise<void> => {
    if (flowKey === undefined || phase === 'pending') return
    setError(undefined)
    setPhase('pending')
    const popup = window.open('', '_blank')
    try {
      const started = await authorization.begin({ key: flowKey, method: 'oauth' })
      if (!started.result.ok) throw new Error(started.result.error.message)
      let after = 0
      while (alive.current) {
        await sleep(500)
        const status = await authorization.status({ attemptId: started.result.value.attemptId, after })
        if (!status.result.ok) throw new Error(status.result.error.message)
        const view = status.result.value
        after = view.nextSeq
        const notice = view.notices.at(-1)?.notice
        if (notice?.url !== undefined) {
          if (popup !== null && !popup.closed) popup.location.replace(notice.url)
          else window.open(notice.url, '_blank')
        }
        if (view.status === 'pending') continue
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
        : `${connector.label} ${copy.needs}`

  return (
    <div className={css.card} data-connector-auth-card>
      <div className={css.icon} aria-hidden="true">
        {phase === 'failed' ? <StateDot state="error" /> : <IconApiOutline14 />}
      </div>
      <div className={css.copy}>
        <strong>{copy.title}</strong>
        <span>{statusText}</span>
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
