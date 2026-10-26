import { useEffect, useState } from 'react'
import { parseTradingDashboard, type TradingDashboardSnapshot } from './trading-tool-cards.ts'
import css from './TradingDashboard.module.css'

type Props = {
  readonly initial: TradingDashboardSnapshot
  readonly onAction: (prompt: string) => void
}
const ENDPOINT = '/phoenix-trading/paper/dashboard'
const REFRESH_MS = 10_000

function amount(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('es-DO', { minimumFractionDigits: 2, maximumFractionDigits }).format(value)
}

function clock(value?: string): string {
  if (value === undefined) return 'Sin registro'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString('es-DO') : 'Sin registro'
}

/** Phoenix in-chat trading visor, synchronized with real local PAPER journal. */
export function TradingDashboard({ initial, onAction }: Props) {
  const [state, setState] = useState<TradingDashboardSnapshot>(initial)
  const [connection, setConnection] = useState<'connected' | 'offline'>('connected')
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
  }, [])

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
        <div className={css.metric}><span>Operaciones virtuales</span><strong>{account.tradeCount}</strong><em>DD máx. {amount(account.maxDrawdownPct)}%</em></div>
      </div>
      <div className={css.toolbar}>
        <div>
          <strong>Estrategias activas</strong>
          <small>{settings.symbols.join(' · ')} · {settings.interval} · Revisión cada {settings.pollMs / 60_000} min</small>
        </div>
        <div className={css.actions}>
          <button type="button" onClick={() => { onAction('Abre el visor de Binance PAPER y actualiza el estado real de operaciones.') }}>Actualizar</button>
          {running
            ? <button type="button" className={css.danger} onClick={() => { onAction('Detén ahora el trading PAPER automático de Binance y muéstrame el visor actualizado.') }}>Detener</button>
            : <button type="button" className={css.primary} onClick={() => { onAction('Inicia trading PAPER automático en Binance con '+ settings.symbols.join(',') + ', intervalo '+settings.interval+', y muéstrame el visor.') }}>Iniciar PAPER</button>}
        </div>
      </div>
      <div className={css.twoColumns}>
        <section className={css.section}>
          <h4>Radar de estrategias</h4>
          {state.signals.length === 0 ? <p className={css.empty}>Todavía no hay un análisis confirmado en esta sesión.</p>
            : <div className={css.rows}>
              {state.signals.map(signal => (
                <div key={signal.symbol} className={css.row}>
                  <div><strong>{signal.symbol}</strong><small>{signal.strategy} · {signal.regime}</small></div>
                  <span data-signal={signal.action}>{signal.action === 'buy' ? 'COMPRAR' : signal.action === 'sell' ? 'VENDER' : 'ESPERAR'}</span>
                  <small>{signal.score}/100</small>
                </div>
              ))}
            </div>}
          <p className={css.footnote}>{state.rationale}</p>
        </section>
        <section className={css.section}>
          <h4>Posiciones virtuales</h4>
          {account.positions.length === 0 ? <p className={css.empty}>Sin posiciones abiertas. No se simulan compras sin señal.</p>
            : <div className={css.rows}>
              {account.positions.map(position => (
                <div key={position.symbol} className={css.row}>
                  <div><strong>{position.symbol}</strong><small>{amount(position.quantity, 7)} unidades</small></div>
                  <div className={css.right}><strong>{amount(position.marketValueUsdt)} USDT</strong>
                    <small data-pnl={position.unrealizedPnlUsdt >= 0 ? 'positive' : 'negative'}>
                      {position.unrealizedPnlUsdt > 0 ? '+' : ''}{amount(position.unrealizedPnlUsdt)} USDT
                    </small>
                  </div>
                </div>
              ))}
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
                <div className={css.right}><strong>{amount(trade.grossUsdt)} USDT</strong><small>Precio {amount(trade.price, 7)}</small></div>
              </div>
            ))}
          </div>}
      </section>
      <div className={css.footer} aria-live="polite">
        <span>Última comprobación: {clock(state.lastAttemptAt)}</span>
        <span>Próximo ciclo: {running ? clock(state.nextCheckAt) : 'Sin programación'}</span>
        {state.lastError ? <strong role="alert">{state.lastError}</strong> : null}
        {connection === 'offline' ? <span>El visor conserva los últimos datos recibidos. No se confirma actividad en vivo.</span> : null}
      </div>
    </section>
  )
}
