import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './ModelsSection.module.css'
import connectorStyles from './CodexConnectors.module.css'

const BASE = '/phoenix-trading/paper'

interface TestnetConnection {
  configured: boolean
  connected: boolean
  canTrade?: boolean
  saved?: boolean
  issue?: string
  nextAction?: string
}

interface AgenticConnection {
  configured: boolean
  connected: boolean
  status: string
  toolCount: number
  accountVerified: boolean
  tradeScopeVerified: boolean
  nextAction?: string
}

async function readHostJson<T>(path: string, payload?: Record<string, string>): Promise<T> {
  const response = await fetch(BASE + path, {
    method: payload === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json',
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })
  const result: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    // Never show raw provider errors or request payloads, which may contain keys.
    const error = result && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>).error : undefined
    if (error === 'testnet-automation-account-change-blocked') throw new Error('Detén Testnet y concilia o cierra sus operaciones pendientes antes de cambiar las claves.')
    if (error === 'vault-read-only') throw new Error('La bóveda es de solo lectura; revisa las variables del Host.')
    if (error === 'vault-write-failed') throw new Error('No se pudieron guardar y verificar ambas claves en la bóveda.')
    if (response.status === 404) throw new Error('Actualiza o reinicia el Host de Phoenix para habilitar la conexión Binance.')
    if (response.status === 403) throw new Error('Configura Binance desde Phoenix local en una conexión segura (HTTPS o localhost).')
    throw new Error('La conexión del Host no está disponible; comprueba el servicio antes de reintentar.')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('El Host devolvió un estado de Binance inválido.')
  }
  return result as T
}

/**
 * Standalone, same-origin Binance setup. All secrets go directly from an owner
 * gesture to the Host vault, never to the model, MCP configuration or chat.
 * PAPER remains keyless. Agentic OAuth requires a separate Binance consent.
 */
export function BinanceConnectorSetup({ onChanged }: { onChanged: () => void }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [testnet, setTestnet] = useState<TestnetConnection>()
  const [agentic, setAgentic] = useState<AgenticConnection>()
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<'status' | 'testnet' | 'agentic' | 'reconnect'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const refresh = async (): Promise<void> => {
    const [testnetStatus, agenticStatus] = await Promise.all([
      readHostJson<TestnetConnection>('/testnet-status'),
      readHostJson<AgenticConnection>('/mcp-status'),
    ])
    setTestnet(testnetStatus)
    setAgentic(agenticStatus)
  }

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setBusy('status')
    void Promise.all([
      readHostJson<TestnetConnection>('/testnet-status'),
      readHostJson<AgenticConnection>('/mcp-status'),
    ]).then(([testnetStatus, agenticStatus]) => {
      if (!cancelled) { setTestnet(testnetStatus); setAgentic(agenticStatus) }
    }, () => {
      if (!cancelled) setError('No se puede consultar el Host de Binance. Comprueba que Phoenix está actualizado y abierto.')
    }).finally(() => { if (!cancelled) setBusy(undefined) })
    return () => { cancelled = true }
  }, [expanded])

  const saveTestnet = async (): Promise<void> => {
    if (busy !== undefined || apiKey.trim().length < 12 || secret.length < 12) return
    setBusy('testnet'); setError(undefined); setNotice(undefined)
    try {
      const result = await readHostJson<TestnetConnection>('/testnet-connect', {
        apiKey: apiKey.trim(), secret,
      })
      // Do not retain raw private values in React state after a successful save.
      if (result.saved !== true) throw new Error('El Host no confirmó el guardado de las claves.')
      setApiKey(''); setSecret('')
      setTestnet(result)
      setNotice(result.connected
        ? 'Claves guardadas y cuenta Spot Testnet autenticada.'
        : 'Claves guardadas de forma persistente. Binance aún no ha confirmado la autenticación.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las claves.')
    } finally {
      setBusy(undefined)
    }
  }

  const activateAgentic = async (reconnect: boolean): Promise<void> => {
    if (busy !== undefined) return
    setBusy(reconnect ? 'reconnect' : 'agentic'); setError(undefined); setNotice(undefined)
    try {
      if (reconnect) {
        await readHostJson<{ reconnectAccepted: boolean }>('/mcp-reconnect', {})
      } else {
        await readHostJson<{ installed: boolean }>('/mcp-activate', {})
      }
      await refresh()
      setNotice('MCP oficial preparado. Pulsa Autorizar en la tarjeta de Binance y completa el consentimiento de Binance; no hay acceso REAL hasta hacerlo.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el MCP de Binance.')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div data-binance-auth="true">
      <button type="button" className={connectorStyles['connectorPrimaryButton']}
        aria-expanded={expanded} onClick={() => { setExpanded(open => !open) }}>
        {expanded ? 'Ocultar configuración Binance' : 'Conectar / autenticar Binance'}
      </button>
      {!expanded ? null : (
        <div className={styles['setupCard']}>
          <p className={styles['advancedHint']}>
            <strong>PAPER:</strong> listo sin credenciales. TESTNET usa claves HMAC exclusivas para fondos ficticios.
            REAL usa el OAuth oficial de Binance Agentic y requiere autorización independiente.
          </p>
          <fieldset disabled={busy !== undefined} className={styles['field']}>
            <legend><strong>Spot Testnet · API HMAC</strong></legend>
            <p role="status" className={styles['advancedHint']}>
              {testnet === undefined ? 'Comprobando la conexión Testnet…'
                : testnet.connected && testnet.canTrade ? 'Testnet autenticado · trading habilitado'
                  : testnet.configured ? 'Claves presentes · conexión o permisos sin verificar'
                    : 'Claves Testnet no configuradas'}
            </p>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>API Key de Spot Testnet</span>
              <input className={styles['input']} type="password" autoComplete="off"
                value={apiKey} onChange={event => { setApiKey(event.target.value) }}
                placeholder="Pega tu clave Testnet, nunca tu clave REAL"/>
            </label>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>API Secret de Spot Testnet</span>
              <input className={styles['input']} type="password" autoComplete="new-password"
                value={secret} onChange={event => { setSecret(event.target.value) }}
                placeholder="El secreto solo se envía a la bóveda del Host"/>
            </label>
            <div className={styles['editorActions']}>
              <button type="button" className={connectorStyles['connectorPrimaryButton']}
                disabled={apiKey.trim().length < 12 || secret.length < 12}
                onClick={() => { void saveTestnet() }}>
                {busy === 'testnet' ? 'Verificando…' : 'Guardar y verificar Testnet'}
              </button>
              <a href="https://testnet.binance.vision/"
                rel="noreferrer" target="_blank">Portal oficial Spot Testnet</a>
            </div>
            {testnet?.nextAction === undefined ? null : (
              <p className={styles['advancedHint']}>{testnet.nextAction}</p>
            )}
          </fieldset>
          <fieldset disabled={busy !== undefined} className={styles['field']}>
            <legend><strong>Binance REAL · Agentic OAuth</strong></legend>
            <p role="status" className={styles['advancedHint']}>
              {agentic?.connected ? 'MCP conectado · cuenta y permisos de trading todavía sin verificar'
                : agentic?.configured ? 'MCP instalado · OAuth o conexión pendiente'
                  : 'MCP oficial pendiente de instalar'}
            </p>
            <p className={styles['advancedHint']}>
              Instala el MCP fijado por Phoenix, autoriza en el navegador con tu cuenta Binance
              y confirma allí los permisos de la subcuenta Agentic. Instalar no habilita órdenes reales.
            </p>
            <div className={styles['editorActions']}>
              <button type="button" className={connectorStyles['connectorPrimaryButton']}
                onClick={() => { void activateAgentic(false) }}>
                {busy === 'agentic' ? 'Instalando…' : agentic?.configured ? 'Revisar / instalar MCP REAL' : 'Preparar OAuth REAL'}
              </button>
              {agentic?.configured ? (
                <button type="button" className={connectorStyles['connectorSecondaryButton']}
                  onClick={() => { void activateAgentic(true) }}>Reconectar MCP</button>
              ) : null}
            </div>
            {agentic?.nextAction === undefined ? null : <p className={styles['advancedHint']}>{agentic.nextAction}</p>}
          </fieldset>
          <div className={styles['editorActions']}>
            <button type="button" disabled={busy !== undefined} className={connectorStyles['connectorSecondaryButton']}
              onClick={() => { setError(undefined); void refresh().catch(() => {
                setError('No se pudo verificar el estado del Host.')
              }) }}>
              Actualizar estado
            </button>
          </div>
          {notice === undefined ? null : <p role="status" className={styles['advancedHint']}>{notice}</p>}
          {error === undefined ? null : <p role="alert" className={styles['error']}>{error}</p>}
        </div>
      )}
    </div>
  )
}
