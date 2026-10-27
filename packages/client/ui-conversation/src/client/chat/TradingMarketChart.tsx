import { useEffect, useMemo, useState } from 'react'
import css from './TradingDashboard.module.css'

type Interval = '15m' | '1h' | '4h' | '1d'
type Candle = {
  readonly openTime: number
  readonly closeTime: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}
type TradeMarker = {
  readonly id: string
  readonly symbol: string
  readonly executedAt: string
  readonly side: 'buy' | 'sell'
}
type Props = { readonly symbols: readonly string[]; readonly trades: readonly TradeMarker[] }
const FRAME_WIDTH = 1100
const FRAME_HEIGHT = 440
const LEFT = 18
const RIGHT = 1030
const PRICE_TOP = 18
const PRICE_BOTTOM = 318
const VOLUME_TOP = 344
const VOLUME_BOTTOM = 401
const INTERVALS: readonly Interval[] = ['15m', '1h', '4h', '1d']

function validCandle(value: unknown): value is Candle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return ['openTime', 'closeTime', 'open', 'high', 'low', 'close', 'volume'].every(key =>
    typeof row[key] === 'number' && Number.isFinite(row[key]))
    && (row.open as number) > 0 && (row.high as number) > 0
    && (row.low as number) > 0 && (row.close as number) > 0
    && (row.volume as number) >= 0
    && (row.high as number) >= Math.max(row.open as number, row.close as number)
    && (row.low as number) <= Math.min(row.open as number, row.close as number)
    && (row.closeTime as number) >= (row.openTime as number)
}

function parseCandles(payload: unknown, symbol: string, interval: Interval): Candle[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new Error('Invalid market reply')
  const value = payload as Record<string, unknown>
  if (value.source !== 'binance-spot-public' || value.symbol !== symbol || value.interval !== interval
    || !Array.isArray(value.candles) || value.candles.length > 150
    || !value.candles.every(validCandle)) throw new Error('Invalid market OHLCV')
  const data: Candle[] = value.candles
  if (data.some((bar, i) => i > 0 && bar.openTime <= (data[i - 1]?.openTime ?? 0))) {
    throw new Error('Unordered market OHLCV')
  }
  return data
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value)
}

function movingAverage(data: readonly Candle[], length: number, x: (index: number) => number, y: (price: number) => number): string {
  if (data.length < length) return ''
  let sum = 0
  const path: string[] = []
  for (let i = 0; i < data.length; i++) {
    const candle = data[i]
    if (candle === undefined) continue
    sum += candle.close
    if (i >= length) sum -= data[i - length]?.close ?? 0
    if (i >= length - 1) path.push(`${path.length === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(sum / length).toFixed(2)}`)
  }
  return path.join(' ')
}

/** Exchange OHLCV, never synthetic candle shapes or model-generated predictions. */
export function TradingMarketChart({ symbols, trades }: Props) {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT')
  const [interval, setTimeframe] = useState<Interval>('1h')
  const [candles, setCandles] = useState<readonly Candle[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [selected, setSelected] = useState<number | undefined>()
  const symbol = symbols.includes(selectedSymbol) ? selectedSymbol : (symbols[0] ?? 'BTCUSDT')
  const key = symbol + ':' + interval

  useEffect(() => {
    let live = true
    let controller: AbortController | undefined
    async function load(): Promise<void> {
      if (document.hidden || controller !== undefined) return
      const current = new AbortController()
      controller = current
      try {
        const params = new URLSearchParams({ symbol, interval })
        const reply = await fetch('/phoenix-trading/paper/candles?' + params, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: current.signal,
        })
        if (!reply.ok) throw new Error('Binance public market unavailable')
        const body: unknown = await reply.json()
        const checked = parseCandles(body, symbol, interval)
        if (live) { setCandles(checked); setLoadedKey(key); setError(undefined) }
      } catch {
        if (live && !current.signal.aborted) setError('No se pudo verificar el historial OHLCV de Binance.')
      } finally {
        if (controller === current) controller = undefined
      }
    }
    setSelected(undefined)
    void load()
    const timer = setInterval(() => { void load() }, 30_000)
    const onVisibility = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      controller?.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [symbol, interval, key])

  const ready = loadedKey === key && candles.length > 0
  const plot = useMemo(() => {
    if (!ready) return undefined
    const lowest = Math.min(...candles.map(bar => bar.low))
    const highest = Math.max(...candles.map(bar => bar.high))
    const spread = Math.max((highest - lowest) * .075, highest * .0001)
    const min = lowest - spread
    const max = highest + spread
    const step = (RIGHT - LEFT) / candles.length
    const x = (index: number) => LEFT + step * (index + .5)
    const y = (price: number) => PRICE_BOTTOM - (price - min) / (max - min) * (PRICE_BOTTOM - PRICE_TOP)
    const maxVolume = Math.max(1, ...candles.map(bar => bar.volume))
    return { min, max, step, x, y, maxVolume,
      ma7: movingAverage(candles, 7, x, y),
      ma25: movingAverage(candles, 25, x, y),
      ma99: movingAverage(candles, 99, x, y) }
  }, [candles, ready])
  const last = ready ? candles.at(-1) : undefined
  const active = plot === undefined ? undefined : candles[selected ?? candles.length - 1]

  return <section className={css.marketChart} aria-label="Gráfico Spot Binance con velas y volumen">
    <header className={css.marketHeading}>
      <div><strong>{symbol.replace(/USDT$/u, '/USDT')}</strong>
        <small>Spot · Binance público · OHLCV verificado</small></div>
      <div className={css.marketControls}>
        <select aria-label="Seleccionar par" value={symbol} onChange={event => { setSelectedSymbol(event.target.value) }}>
          {symbols.map(item => <option key={item} value={item}>{item.replace(/USDT$/u, '/USDT')}</option>)}
        </select>
        <div className={css.marketPeriods} role="group" aria-label="Temporalidad">
          {INTERVALS.map(frame => <button type="button" key={frame}
            aria-pressed={interval === frame} onClick={() => { setTimeframe(frame) }}>{frame}</button>)}
        </div>
      </div>
    </header>
    <div className={css.marketSummary}>
      {last === undefined || !ready ? <span>Esperando cotizaciones comprobadas…</span>
        : <><b>{formatPrice(last.close)} USDT</b><span>A {formatPrice(last.open)}</span>
          <span>H {formatPrice(last.high)}</span><span>L {formatPrice(last.low)}</span>
          <span>V {new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(last.volume)}</span></>}
      {error && <span role="alert">{error} {ready ? 'Se conserva la última lectura.' : ''}</span>}
    </div>
    {plot === undefined
      ? <p className={css.marketEmpty}>El gráfico se mostrará cuando lleguen velas reales. No se generan precios artificiales.</p>
      : <svg className={css.marketSvg} viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
        role="img" aria-label={`Velas ${symbol} en ${interval}, medias móviles 7, 25 y 99, volumen y operaciones PAPER`}
        onMouseMove={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          const index = Math.floor(((event.clientX - rect.left) / rect.width * FRAME_WIDTH - LEFT) / plot.step)
          setSelected(Math.min(candles.length - 1, Math.max(0, index)))
        }}
        onMouseLeave={() => { setSelected(undefined) }}>
        {[0, 1, 2, 3, 4].map(tick => {
          const level = plot.max - (plot.max - plot.min) * tick / 4
          const py = plot.y(level)
          return <g key={tick}><line className={css.marketGrid} x1={LEFT} x2={RIGHT} y1={py} y2={py}/>
            <text className={css.marketAxis} x={RIGHT + 9} y={py + 4}>{formatPrice(level)}</text></g>
        })}
        {candles.map((bar, i) => {
          const px = plot.x(i)
          const positive = bar.close >= bar.open
          const color = positive ? '#189b77' : '#d95361'
          const highY = plot.y(bar.high)
          const lowY = plot.y(bar.low)
          const top = Math.min(plot.y(bar.open), plot.y(bar.close))
          const bodyHeight = Math.max(1.2, Math.abs(plot.y(bar.open) - plot.y(bar.close)))
          const volumeHeight = bar.volume / plot.maxVolume * (VOLUME_BOTTOM - VOLUME_TOP)
          return <g key={bar.openTime}><line x1={px} x2={px} y1={highY} y2={lowY} stroke={color} strokeWidth={1.3}/>
            <rect x={px - Math.max(1.2, plot.step * .33)} y={top}
              width={Math.max(2.4, plot.step * .66)} height={bodyHeight} fill={color}/>
            <rect x={px - Math.max(1.2, plot.step * .33)} y={VOLUME_BOTTOM - volumeHeight}
              width={Math.max(2.4, plot.step * .66)} height={volumeHeight} fill={color} opacity=".65">
              <title>{new Date(bar.openTime).toLocaleString('es-DO')} · {formatPrice(bar.close)} USDT</title>
            </rect>
          </g>
        })}
        {plot.ma7 && <path d={plot.ma7} fill="none" stroke="#e3ac1b" strokeWidth="2"/>}
        {plot.ma25 && <path d={plot.ma25} fill="none" stroke="#d9469b" strokeWidth="2"/>}
        {plot.ma99 && <path d={plot.ma99} fill="none" stroke="#9270d2" strokeWidth="2"/>}
        {trades.filter(trade => trade.symbol === symbol).map(trade => {
          const stamp = Date.parse(trade.executedAt)
          const i = candles.findIndex(bar => stamp >= bar.openTime && stamp <= bar.closeTime)
          const candle = candles[i]
          if (i < 0 || candle === undefined) return null
          const buy = trade.side === 'buy'
          return <g key={trade.id}><circle cx={plot.x(i)}
            cy={buy ? plot.y(candle.low) + 14 : plot.y(candle.high) - 14}
            r="9" fill={buy ? '#168d70' : '#cf4457'} stroke="#fff" strokeWidth="2"/>
            <text x={plot.x(i)} y={(buy ? plot.y(candle.low) + 14 : plot.y(candle.high) - 14) + 3}
              textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">{buy ? 'B' : 'S'}</text>
            <title>Orden PAPER {buy ? 'comprada' : 'vendida'} · {new Date(stamp).toLocaleString('es-DO')}</title></g>
        })}
        {selected !== undefined && active !== undefined && <g>
          <line x1={plot.x(selected)} x2={plot.x(selected)} y1={PRICE_TOP} y2={VOLUME_BOTTOM}
            stroke="#64748b" strokeDasharray="4 4" opacity=".65"/>
          <line x1={LEFT} x2={RIGHT} y1={plot.y(active.close)} y2={plot.y(active.close)}
            stroke="#64748b" strokeDasharray="4 4" opacity=".5"/>
        </g>}
        {[0, .25, .5, .75, 1].map((fraction, index) => {
          const candle = candles[Math.round((candles.length - 1) * fraction)]
          return candle === undefined ? null : <text key={index}
            className={css.marketAxis} x={plot.x(Math.round((candles.length - 1) * fraction))}
            y="426" textAnchor="middle">{new Date(candle.openTime).toLocaleDateString('es-DO',{ day:'2-digit', month:'2-digit' })}</text>
        })}
        <text className={css.marketAxis} x={RIGHT + 9} y={VOLUME_TOP + 5}>VOL</text>
      </svg>}
    <div className={css.marketLegend}>
      <span><i style={{ background: '#e3ac1b' }}/>MA 7</span>
      <span><i style={{ background: '#d9469b' }}/>MA 25</span>
      <span><i style={{ background: '#9270d2' }}/>MA 99</span>
      <span> B / S = ejecuciones PAPER verificadas, no órdenes reales</span>
      {active !== undefined && <strong>{new Date(active.openTime).toLocaleString('es-DO')} · C {formatPrice(active.close)}</strong>}
    </div>
  </section>
}
