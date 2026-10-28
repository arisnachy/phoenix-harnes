import { useEffect, useState } from 'react'
import { parseTradingDashboard, type TradingDashboardSnapshot } from './trading-tool-cards.ts'
import css from './TradingDashboard.module.css'
import { TradingMarketChart } from './TradingMarketChart.tsx'

type Props = {
  readonly initial?: TradingDashboardSnapshot | undefined
}
const ENDPOINT = '/phoenix-trading/paper/dashboard'
const REFRESH_MS = 10_000
type TestnetState = {
  mode: 'testnet'
  configured: boolean
  connected: boolean
  canTrade: boolean
  nextAction: string
}
type McpState = {
  configured: boolean
  connected: boolean
  status: string
  toolCount: number
  tradeScopeVerified: boolean
  accountVerified: boolean
  nextAction: string
}

function amount(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('es-DO', { minimumFractionDigits: Math.min(2, maximumFractionDigits), maximumFractionDigits }).format(value)
}

function quote(value: number): string {
  const digits = value > 0 && value < 0.01 ? 12 : value < 1 ? 8 : 7
  return amount(value, digits)
}

function strategyLabel(id: string): string {
  if (id.includes('mean-reversion')) return 'Reversión a la media'
  if (id.includes('trend-pullback')) return 'Retroceso en tendencia'
  if (id.includes('breakout')) return 'Ruptura de rango'
  if (id.includes('defensive')) return 'Salida defensiva'
  if (id.includes('manual')) return 'Operación manual'
  return id
}

function targetReturn(price: number, entry: number): string {
  return (price / entry > 1 ? '+' : '') + amount((price / entry - 1) * 100, 2) + '%'
}

function clock(value?: string): string {
  if (value === undefined) return 'Sin registro'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('es-DO') : 'Sin registro'
}

/**
 * Phoenix in-chat trading visor, synchronized with the local PAPER journal.
 * @param props - Initial verified account and user-action bridge.
 * @returns A native, read-only market monitoring card with chat-mediated controls.
 */
export function TradingDashboard({ initial }: Props) {
  const [state, setState] = useState<TradingDashboardSnapshot | undefined>(initial)
  const [connection, setConnection] = useState<'connected' | 'offline'>('connected')
  const [refreshKey, setRefreshKey] = useState(0)
  const [controlBusy, setControlBusy] = useState(false)
  const [controlError, setControlError] = useState<string | undefined>()
  // A user can configure a multi-asset PAPER watchlist without spending tokens.
  const [watchlistDraft, setWatchlistDraft] = useState<string | undefined>()
  const [testnetState, setTestnetState] = useState<TestnetState | undefined>()
  const [mcpState, setMcpState] = useState<McpState | undefined>()
  const [connectionIssue, setConnectionIssue] = useState<string | undefined>()
  const [credentialOpen, setCredentialOpen] = useState(false)
  const [testingKey, setTestingKey] = useState('')
  const [testingSecret, setTestingSecret] = useState('')
  const [connectionBusy, setConnectionBusy] = useState(false)
  useEffect(() => {
    let mounted = true
    let controller: AbortController | undefined
    async function refresh(): Promise<void> {
      if (document.hidden || controller !== undefined) return
      controller = new AbortController()
      const active = controller
      try {
        const response = await fetch(ENDPOINT, {
          method: 'GET', cache: 'no-store', credentials: 'same-origin',
          signal: active.signal,
        })
        if (!response.ok) throw new Error('Viewer read unavailable')
        const payload: unknown = await response.json()
        const valid = parseTradingDashboard(payload)
        if (valid === undefined) throw new Error('Invalid trading snapshot')
        if (mounted) { setState(valid); setConnection('connected') }
      } catch {
        if (mounted && !active.signal.aborted) setConnection('offline')
      } finally {
        if (controller === active) controller = undefined
      }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, REFRESH_MS)
    return () => { mounted = false; controller?.abort(); clearInterval(timer) }
  }, [refreshKey])

  async function checkConnections(): Promise<void> {
    if (connectionBusy) return
    setConnectionBusy(true)
    setConnectionIssue(undefined)
    try {
      const [testReply, mcpReply] = await Promise.all([
        fetch('/phoenix-trading/paper/testnet-status', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/phoenix-trading/paper/mcp-status', { credentials: 'same-origin', cache: 'no-store' }),
      ])
      if (!testReply.ok || !mcpReply.ok) throw new Error('Host connection status unavailable')
      const testing = await testReply.json() as TestnetState
      const agentic = await mcpReply.json() as McpState
      if (testing.mode !== 'testnet' || typeof testing.connected !== 'boolean'
        || typeof agentic.connected !== 'boolean' || typeof agentic.toolCount !== 'number') {
        throw new Error('Invalid provider status')
      }
      setTestnetState(testing)
      setMcpState(agentic)
    } catch {
      setConnectionIssue('No fue posible verificar Binance desde este Host.')
    } finally {
      setConnectionBusy(false)
    }
  }

  async function reconnectAgentic(): Promise<void> {
    if (connectionBusy) return
    setConnectionBusy(true)
    setConnectionIssue(undefined)
    try {
      const reply = await fetch('/phoenix-trading/paper/mcp-reconnect', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (!reply.ok) throw new Error('MCP reconnect unavailable')
      setMcpState(undefined) // Do not report connected until next live tool inventory.
    } catch {
      setConnectionIssue('No se pudo reconectar Binance MCP. Usa Configuración > Conectores > Binance para OAuth.')
    } finally {
      setConnectionBusy(false)
    }
  }

  async function saveTestnetCredentials(): Promise<void> {
    if (connectionBusy || testingKey.length < 12 || testingSecret.length < 12) {
      setConnectionIssue('Introduce una clave y secreto exclusivos de Spot Testnet.')
      return
    }
    setConnectionBusy(true)
    setConnectionIssue(undefined)
    try {
      const response = await fetch('/phoenix-trading/paper/testnet-connect', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: testingKey, secret: testingSecret }),
      })
      if (!response.ok) throw new Error('Testnet credential verification rejected')
      const value = await response.json() as TestnetState
      if (value.mode !== 'testnet' || value.connected !== true) throw new Error('Testnet not verified')
      setTestnetState(value)
      setCredentialOpen(false)
    } catch {
      setConnectionIssue('Testnet no pudo autenticar o guardar las claves. Revisa la cuenta de prueba y el Host.')
    } finally {
      // Never persist private keys in the browser's chart state or model context.
      setTestingKey('')
      setTestingSecret('')
      setConnectionBusy(false)
    }
  }

  if (state === undefined) {
    return (
      <section className={css.panel} data-trading-mode="paper" aria-label="Visor de trading Binance PAPER">
        <div className={css.heading}>
          <div><p className={css.eyebrow}>PHOENIX / TRADING INTELLIGENCE</p><h3>Binance · Trading PAPER</h3></div>
          <span className={css.status} data-phase={connection === 'offline' ? 'offline' : 'stopped'}>
            {connection === 'offline' ? 'Host sin conexión · sin operaciones confirmadas' : 'Cargando operaciones verificadas…'}
          </span>
        </div>
        <p className={css.empty}>No mostraré balances ni operaciones hasta leer el libro virtual real de Phoenix.</p>
      </section>
    )
  }
  async function control(action: 'start' | 'stop' | 'check-now'): Promise<void> {
    if (state === undefined || controlBusy) return
    setControlBusy(true)
    setControlError(undefined)
    try {
      const watchlist = (watchlistDraft ?? state.settings.symbols.join(','))
        .split(/[,\s]+/u).map(item => item.trim().toUpperCase()).filter(Boolean)
      if (action === 'start' && (watchlist.length < 1 || watchlist.length > 12
        || new Set(watchlist).size !== watchlist.length
        || watchlist.some(item => !/^[A-Z0-9]{3,16}USDT$/u.test(item)))) {
        setControlError('Selecciona entre 1 y 12 pares Spot USDT únicos, separados por coma.')
        return
      }
      const payload = action === 'start'
        ? { action, symbols: watchlist, interval: state.settings.interval,
          pollMinutes: state.settings.pollMs / 60_000 }
        : { action }
      const response = await fetch('/phoenix-trading/paper/control', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error('PAPER control rejected')
      const updated: unknown = await response.json()
      const valid = parseTradingDashboard(updated)
      if (valid === undefined) throw new Error('Invalid PAPER control reply')
      setState(valid)
      if (action === 'start') setWatchlistDraft(undefined)
      setConnection('connected')
      setRefreshKey(current => current + 1)
    } catch {
      setControlError('No se pudo confirmar la acción PAPER desde el Host. No se asume ninguna orden ejecutada.')
    } finally {
      setControlBusy(false)
    }
  }
  const { account, settings } = state
  const running = state.enabled && state.phase === 'running'
  const status = connection === 'offline' ? 'Sin conexión al Host'
    : state.phase === 'error' ? 'Error de ejecución'
      : running ? 'Monitoreando PAPER' : 'Detenido'
  return (
    <section className={css.panel} aria-label="Visor de trading Binance PAPER" data-trading-mode="paper">
      <div className={css.heading}>
        <div>
          <p className={css.eyebrow}>PHOENIX / TRADING INTELLIGENCE</p>
          <h3>Binance · Trading PAPER</h3>
          <p>Capital virtual · sin acceso a dinero real · verificado en el libro local</p>
        </div>
        <span className={css.status} data-phase={connection === 'offline' ? 'offline' : state.phase}>
          <span className={css.dot} aria-hidden="true" />{status}
        </span>
      </div>
      <div className={css.metrics}>
        <div className={css.metric}><span>Patrimonio virtual</span><strong>{amount(account.equityUsdt)} <small>USDT</small></strong></div>
        <div className={css.metric}><span>Ganancia / pérdida neta</span>
          <strong data-pnl={account.totalPnlUsdt > 0 ? 'positive' : account.totalPnlUsdt < 0 ? 'negative' : 'neutral'}>
            {account.totalPnlUsdt > 0 ? '+' : ''}{amount(account.totalPnlUsdt)} <small>USDT</small>
          </strong><em>{account.totalReturnPct > 0 ? '+' : ''}{amount(account.totalReturnPct)}%</em>
        </div>
        <div className={css.metric}><span>Disponible</span><strong>{amount(account.cashUsdt)} <small>USDT</small></strong></div>
        <div className={css.metric}>
          <span>Operaciones virtuales</span><strong>{account.tradeCount}</strong>
          <em>DD máx. {amount(account.maxDrawdownPct)}%</em>
        </div>
      </div>
      <div className={css.toolbar}>
        <div>
          <strong>Escáner multimoneda · {settings.symbols.length} pares configurados</strong>
          <small>{settings.interval} · Revisión cada {settings.pollMs / 60_000} min mientras el Host esté activo</small>
        </div>
        <div className={css.actions}>
          <button type="button" disabled={controlBusy} onClick={() => { setRefreshKey(current => current + 1) }}>Actualizar</button>
          <button type="button" disabled={controlBusy || !running} onClick={() => { void control('check-now') }}>Evaluar ahora</button>
          {running
            ? <button type="button" className={css.danger} disabled={controlBusy} onClick={() => { void control('stop') }}>Detener</button>
            : <button type="button" className={css.primary} disabled={controlBusy}
                onClick={() => { void control('start') }}>Iniciar PAPER</button>}
        </div>
      </div>
      <div className={css.tradingRadarMeta} aria-live="polite">
        <strong>{running ? 'Radar encendido' : 'Radar detenido'}</strong>
        <span>Último análisis: {clock(state.lastSuccessAt)}</span>
        <span>Resultado: {state.lastDecision === 'buy' ? 'Compra PAPER' : state.lastDecision === 'sell' ? 'Venta PAPER' : 'Esperar / sin señal'}</span>
        <span>{state.signals.length} de {settings.symbols.length} pares evaluados</span>
      </div>
      <label className={css.watchlist}>
        <span>Mercados vigilados (1–12 pares USDT, separados por coma)</span>
        <input type="text" spellCheck={false} aria-label="Lista de mercados PAPER"
          disabled={running || controlBusy}
          value={watchlistDraft ?? settings.symbols.join(', ')}
          onChange={event => { setWatchlistDraft(event.currentTarget.value) }}
          placeholder="BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT" />
      </label>
      <TradingMarketChart symbols={settings.symbols} trades={state.recentTrades} />
      <section className={css.connectionPanel} aria-label="Conexiones a Binance">
        <header className={css.connectionHeading}>
          <div><strong>Conexiones Binance</strong>
            <small>PAPER, Spot Testnet y Agentic REAL son cuentas y ejecuciones distintas.</small></div>
          <button type="button" disabled={connectionBusy} onClick={() => { void checkConnections() }}>
            Verificar conexiones
          </button>
        </header>
        <div className={css.connectionGrid}>
          <div className={css.connectionItem}>
            <strong>Spot Testnet · fondos ficticios</strong>
            <span>{testnetState === undefined ? 'Estado pendiente de comprobar'
              : testnetState.connected ? testnetState.canTrade ? 'Autenticado · órdenes de prueba habilitadas' : 'Autenticado · sin permiso de operar'
                : testnetState.configured ? 'Configurado · conexión fallida' : 'Sin credenciales de prueba'}</span>
            <small>{testnetState?.nextAction ?? 'Necesita claves exclusivas de Binance Spot Testnet.'}</small>
            <button type="button" disabled={connectionBusy} onClick={() => { setCredentialOpen(open => !open) }}>
              {credentialOpen ? 'Cerrar configuración' : 'Configurar Testnet'}
            </button>
          </div>
          <div className={css.connectionItem}>
            <strong>Agentic MCP · subcuenta REAL</strong>
            <span>{mcpState === undefined ? 'Estado pendiente de comprobar'
              : mcpState.connected ? 'MCP conectado · permiso de trading aún no verificado'
                : mcpState.status === 'auth-required' ? 'Pendiente OAuth de Binance' : 'MCP sin conexión verificada'}</span>
            <small>{mcpState?.nextAction ?? 'Autorización OAuth desde Configuración > Conectores > Binance.'}</small>
            <button type="button" disabled={connectionBusy || mcpState?.configured !== true}
              onClick={() => { void reconnectAgentic() }}>Reconectar MCP</button>
            <span>Operaciones reales: confirmación individual en Binance.</span>
          </div>
        </div>
        {credentialOpen && <div className={css.credentialForm}>
          <strong>Guardar claves exclusivas de Spot Testnet</strong>
          <small>Solo se envían directamente al Host para verificar la cuenta ficticia y guardarlas en su bóveda. Nunca uses claves reales.</small>
          <input type="password" aria-label="Clave API de Spot Testnet" autoComplete="off"
            placeholder="Testnet API key" value={testingKey} onChange={event => { setTestingKey(event.currentTarget.value) }} />
          <input type="password" aria-label="Secreto API de Spot Testnet" autoComplete="off"
            placeholder="Testnet API secret" value={testingSecret} onChange={event => { setTestingSecret(event.currentTarget.value) }} />
          <button type="button" disabled={connectionBusy} onClick={() => { void saveTestnetCredentials() }}>Verificar y guardar Testnet</button>
        </div>}
        {connectionIssue && <p role="alert" className={css.connectionError}>{connectionIssue}</p>}
      </section>
      <p className={css.markTimestamp} aria-live="polite">
        PnL marcado con cotizaciones públicas de Binance · actualización cada 10 s mientras el visor está abierto ·
        última lectura: {clock(state.markedAt)}.
        Los TP/SL se ejecutan solo cuando el Host evalúa el motor PAPER.
      </p>
      <div className={css.twoColumns}>
        <section className={css.section}>
          <h4>Radar de estrategias</h4>
          {state.signals.length === 0 ? <p className={css.empty}>Todavía no hay un análisis confirmado en esta sesión.</p>
            : <div className={css.rows}>
              {state.signals.map(signal => {
                const evidence = state.execution?.find(item => item.symbol === signal.symbol)
                // A technical BUY is NOT an exchange order or a PAPER fill.
                const status = !running ? 'paused' : evidence?.status ?? 'scan-only'
                const label = status === 'paused' ? 'PAUSADO'
                  : status === 'executed' ? 'OPERACIÓN PAPER'
                    : status === 'blocked' ? 'BLOQUEADA'
                      : status === 'position-open' ? 'POSICIÓN ABIERTA'
                        : status === 'deferred' ? 'EN RADAR'
                          : status === 'watch' ? 'OBSERVAR'
                            : status === 'scan-only' ? 'SEÑAL'
                              : signal.action === 'sell' ? 'SALIDA DEFENSIVA' : 'ESPERAR'
                return <div key={signal.symbol} className={css.row}>
                  <div><strong>{signal.symbol}</strong><small>{strategyLabel(signal.strategy)} · {signal.regime}</small>
                    <span className={css.tradingReason}>{signal.reason}</span>
                    <span className={css.tradingReason}>
                      {status === 'paused'
                        ? 'Motor detenido: no se envían órdenes automáticas'
                        : evidence?.explanation ?? 'Señal técnica sin recibo de ejecución'}
                    </span></div>
                  <span data-signal={status === 'executed' ? 'buy' : status === 'blocked' ? 'sell' : 'hold'}>
                    {label}
                  </span>
                  <small className={css.radarScore}>{signal.score}/100</small>
                </div>
              } )}
            </div>}
          <p className={css.footnote}>{state.rationale}</p>
        </section>
        <section className={css.section}>
          <h4>Posiciones virtuales</h4>
          {account.positions.length === 0
            ? <p className={css.empty}>Sin posiciones abiertas. Esperando una señal de entrada validada.</p>
            : <div className={css.positionCards}>
              {account.positions.map(position => {
                const plan = position.exitPlan
                const lastPrice = position.marketPriceUsdt
                const pnl = position.unrealizedPnlUsdt
                const pct = position.unrealizedReturnPct
                const strategy = plan?.strategyId
                  ?? state.recentTrades.findLast(trade => trade.side === 'buy' && trade.symbol === position.symbol)?.strategyId
                  ?? 'No registrada'
                return <article key={position.symbol} className={css.positionCard} aria-label={position.symbol + ' PnL y salidas PAPER'}>
                  <div className={css.positionHeading}>
                    <div><strong>{position.symbol.replace(/USDT$/u, '/USDT')}</strong>
                      <small>{amount(position.quantity, 7)} unidades · {strategyLabel(strategy)}</small></div>
                    <div className={css.positionPnl} data-pnl={pnl >= 0 ? 'positive' : 'negative'}>
                      <strong>{pnl >= 0 ? '+' : ''}{amount(pnl)} USDT</strong>
                      <span>{pct === undefined ? 'Retorno no disponible'
                        : (pct >= 0 ? '+' : '') + amount(pct) + '%'} · sin realizar</span>
                    </div>
                  </div>
                  <div className={css.positionPrices}>
                    <div><span>Entrada</span><strong>{position.averageEntryUsdt === undefined
                      ? 'Sin dato' : quote(position.averageEntryUsdt)}</strong></div>
                    <div><span>Mercado (USDT)</span><strong>{lastPrice === undefined ? 'Sin dato' : quote(lastPrice)}</strong></div>
                    <div><span>Valor actual</span><strong>{amount(position.marketValueUsdt)} USDT</strong></div>
                  </div>
                  {plan === undefined
                    ? <p className={css.exitMissing}>Sin plan de salida verificado. No se muestran TP/SL ficticios.</p>
                    : <div className={css.exitLevels}>
                        <div className={css.exitLevel} data-level="stop">
                          <span>SL · {targetReturn(plan.stopLossPrice, plan.entryPriceUsdt)}</span><strong>{quote(plan.stopLossPrice)}</strong>
                          <small>{lastPrice === undefined ? 'Sin cotización' : lastPrice <= plan.stopLossPrice ? 'Nivel alcanzado · pendiente de ciclo' : 'Vigilando'}</small>
                        </div>
                        <div className={css.exitLevel} data-level="tp1">
                          <span>TP1 · {targetReturn(plan.tp1Price, plan.entryPriceUsdt)} · venta {amount(plan.tp1Fraction * 100, 0)}%</span>
                          <strong>{quote(plan.tp1Price)}</strong>
                          <small>{plan.tp1Taken ? 'Parcial ejecutado'
                            : lastPrice !== undefined && lastPrice >= plan.tp1Price ? 'Nivel alcanzado · pendiente de ciclo' : 'Pendiente'}</small>
                        </div>
                        <div className={css.exitLevel} data-level="tp2">
                          <span>TP2 · {targetReturn(plan.tp2Price, plan.entryPriceUsdt)} · salida final</span><strong>{quote(plan.tp2Price)}</strong>
                          <small>{lastPrice !== undefined && lastPrice >= plan.tp2Price ? 'Nivel alcanzado · pendiente de ciclo' : 'Pendiente'}</small>
                        </div>
                      </div>}
                  {plan !== undefined && <p className={css.positionFootnote}>
                    Estrategia: {strategyLabel(strategy)} ({strategy}) · {plan.origin === 'legacy-adopted'
                      ? 'Plan adoptado para una posición histórica'
                      : 'Plan persistido en el ledger al ejecutar la compra'}
                    . PnL incluye el coste de entrada, no la comisión de salida. SL/TP virtuales se evalúan en cada ciclo del Host y no son órdenes stop/limit de Binance.
                  </p>}
                </article>
              })}
            </div>}
        </section>
      </div>
      <section className={css.section}>
        <h4>Registro de operaciones ejecutadas (virtuales)</h4>
        {state.recentTrades.length === 0 ? <p className={css.empty}>0 órdenes ejecutadas. Las señales no se cuentan como compras.</p>
          : <div className={css.rows}>
            {[...state.recentTrades].reverse().slice(0, 6).map(trade => (
              <div key={trade.id} className={css.row}>
                <span data-signal={trade.side}>{trade.side === 'buy' ? 'COMPRA' : 'VENTA'}</span>
                <div><strong>{trade.symbol}</strong><small>{trade.strategyId ?? 'Manual'} · {clock(trade.executedAt)}</small></div>
                <div className={css.right}>
                    <strong>{amount(trade.grossUsdt)} USDT</strong>
                    <small>Precio {amount(trade.price, 7)}</small>
                  </div>
              </div>
            ))}
          </div>}
      </section>
      <p className={css.tradingNotice}>
        Kira supervisa cuando recibe un evento o una petición; el escáner PAPER funciona en el Host sin mantener un modelo de IA ejecutándose por cada vela.
        Las señales no son órdenes y nunca se atribuyen a la cuenta real de Binance.
      </p>
      <div className={css.footer} aria-live="polite">
        <span>Última comprobación: {clock(state.lastAttemptAt)}</span>
        <span>Próximo ciclo: {running ? clock(state.nextCheckAt) : 'Sin programación'}</span>
        {state.lastError ? <strong role="alert">{state.lastError}</strong> : null}
        {controlError ? <strong role="alert">{controlError}</strong> : null}
        {connection === 'offline' ? <span>El visor conserva los últimos datos recibidos. No se confirma actividad en vivo.</span> : null}
      </div>
    </section>
  )
}
