import type { ReactNode } from 'react'
import css from './PhoenixVisualizer.module.css'

type JsonRecord = Readonly<Record<string, unknown>>

export interface PhoenixVisualizerProps {
  readonly spec: JsonRecord
}

interface VisualSeries {
  readonly key: string
  readonly label: string
}

interface VisualDatum {
  readonly label: string
  readonly values: readonly number[]
}

interface ParsedChart {
  readonly type: 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'donut'
  readonly series: readonly VisualSeries[]
  readonly data: readonly VisualDatum[]
}

const VISUAL_TYPES = new Set(['chart', 'table', 'metrics', 'timeline', 'cards', 'progress', 'visual'])

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function display(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unprintable value]'
  }
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function visualType(spec: JsonRecord): string | undefined {
  const explicit = nonEmpty(spec.visualType)
  if (explicit !== undefined) return explicit.toLowerCase()
  const kind = nonEmpty(spec.kind)
  if (kind !== undefined && VISUAL_TYPES.has(kind.toLowerCase())) return kind.toLowerCase()
  const type = nonEmpty(spec.type)
  if (type !== undefined && VISUAL_TYPES.has(type.toLowerCase())) return type.toLowerCase()
  if (nonEmpty(spec.chartType) !== undefined || Array.isArray(spec.series)) return 'chart'
  if (Array.isArray(spec.columns) && Array.isArray(spec.rows)) return 'table'
  if (Array.isArray(spec.metrics)) return 'metrics'
  if (Array.isArray(spec.timeline)) return 'timeline'
  if (Array.isArray(spec.cards)) return 'cards'
  if (Array.isArray(spec.progress)) return 'progress'
  return undefined
}

/**
 * Check whether a JSON artifact uses the Phoenix rich-visual contract or a compatible legacy shape.
 * @param spec - Structured artifact payload to inspect.
 * @returns Whether the payload can be rendered by the rich visual surface.
 */
export function supportsPhoenixVisual(spec: JsonRecord): boolean {
  return visualType(spec) !== undefined
}

function header(spec: JsonRecord): ReactNode {
  const title = nonEmpty(spec.title)
  const subtitle = nonEmpty(spec.subtitle) ?? nonEmpty(spec.description)
  if (title === undefined && subtitle === undefined) return null
  return (
    <div className={css.heading}>
      {title !== undefined && <strong>{title}</strong>}
      {subtitle !== undefined && <span>{subtitle}</span>}
    </div>
  )
}

function parseSeries(spec: JsonRecord, data: readonly unknown[]): readonly VisualSeries[] {
  if (Array.isArray(spec.series)) {
    const parsed = spec.series
      .filter(isRecord)
      .map((item) => {
        const key = nonEmpty(item.dataKey) ?? nonEmpty(item.key) ?? nonEmpty(item.id)
        if (key === undefined) return undefined
        return { key, label: nonEmpty(item.label) ?? nonEmpty(item.name) ?? key }
      })
      .filter((item): item is VisualSeries => item !== undefined)
      .slice(0, 8)
    if (parsed.length > 0) return parsed
  }
  const first = data.find(isRecord)
  if (first === undefined) return []
  const xKey = nonEmpty(spec.xKey) ?? 'label'
  return Object.entries(first)
    .filter(([key, value]) => key !== xKey && number(value) !== undefined)
    .slice(0, 8)
    .map(([key]) => ({ key, label: key }))
}

function parseChart(spec: JsonRecord): ParsedChart | undefined {
  const raw = Array.isArray(spec.data) ? spec.data : Array.isArray(spec.rows) ? spec.rows : []
  const rows = raw.filter(isRecord)
  if (rows.length === 0) return undefined
  const xKey = nonEmpty(spec.xKey) ?? nonEmpty(spec.categoryKey) ?? 'label'
  const series = parseSeries(spec, rows)
  if (series.length === 0) return undefined
  const data: VisualDatum[] = []
  for (const [index, row] of rows.entries()) {
    const values = series.map(item => number(row[item.key]) ?? 0)
    data.push({ label: display(row[xKey]) || String(index + 1), values })
  }
  const requested = (nonEmpty(spec.chartType) ?? 'bar').toLowerCase()
  const type: ParsedChart['type'] = requested === 'line' || requested === 'area'
    || requested === 'scatter' || requested === 'pie' || requested === 'donut'
    ? requested
    : 'bar'
  return { type, series, data: data.slice(0, 80) }
}

function color(index: number): string {
  const palette = [
    'var(--phoenix-visual-series-1, #2563eb)',
    'var(--phoenix-visual-series-2, #06b6d4)',
    'var(--phoenix-visual-series-3, #8b5cf6)',
    'var(--phoenix-visual-series-4, #10b981)',
    'var(--phoenix-visual-series-5, #f59e0b)',
    'var(--phoenix-visual-series-6, #ef4444)',
    'var(--phoenix-visual-series-7, #ec4899)',
    'var(--phoenix-visual-series-8, #64748b)',
  ]
  return palette[index % palette.length]!
}

function Legend({ series }: { readonly series: readonly VisualSeries[] }) {
  if (series.length <= 1) return null
  return (
    <div className={css.legend} aria-label="Chart legend">
      {series.map((item, index) => (
        <span key={item.key}><i style={{ background: color(index) }} />{item.label}</span>
      ))}
    </div>
  )
}

function cartesianGeometry(chart: ParsedChart) {
  const width = 760
  const height = 320
  const left = 52
  const right = 18
  const top = 22
  const bottom = 54
  const values = chart.data.flatMap(item => item.values)
  const rawMin = Math.min(...values, 0)
  const rawMax = Math.max(...values, 0)
  const span = rawMax - rawMin || 1
  const min = rawMin - span * 0.08
  const max = rawMax + span * 0.08
  const y = (value: number): number => top + (max - value) / (max - min) * (height - top - bottom)
  const x = (index: number): number => chart.data.length <= 1
    ? (left + width - right) / 2
    : left + index * (width - left - right) / (chart.data.length - 1)
  return { width, height, left, right, top, bottom, min, max, y, x }
}

function CartesianChart({ chart }: { readonly chart: ParsedChart }) {
  const g = cartesianGeometry(chart)
  const ticks = Array.from({ length: 5 }, (_, index) => g.min + (g.max - g.min) * index / 4)
  const labelEvery = Math.max(1, Math.ceil(chart.data.length / 8))
  const plotWidth = g.width - g.left - g.right
  const slot = plotWidth / Math.max(chart.data.length, 1)
  const groupWidth = Math.min(slot * 0.72, 48)
  const barWidth = Math.max(2, groupWidth / Math.max(chart.series.length, 1))

  return (
    <div className={css.chartScroller}>
      <svg
        className={css.chart}
        viewBox={'0 0 ' + g.width + ' ' + g.height}
        role="img"
        aria-label={chart.type + ' chart'}
      >
        {ticks.map((tick) => {
          const yy = g.y(tick)
          return (
            <g key={tick}>
              <line className={css.grid} x1={g.left} y1={yy} x2={g.width - g.right} y2={yy} />
              <text className={css.axisLabel} x={g.left - 8} y={yy + 4} textAnchor="end">{formatNumber(tick)}</text>
            </g>
          )
        })}
        <line className={css.axis} x1={g.left} y1={g.top} x2={g.left} y2={g.height - g.bottom} />
        <line className={css.axis} x1={g.left} y1={g.y(0)} x2={g.width - g.right} y2={g.y(0)} />

        {chart.type === 'bar' && chart.data.flatMap((datum, pointIndex) =>
          datum.values.map((value, seriesIndex) => {
            const base = g.y(0)
            const valueY = g.y(value)
            const x = g.left + pointIndex * slot + (slot - groupWidth) / 2 + seriesIndex * barWidth
            return (
              <rect
                key={pointIndex + '-' + seriesIndex}
                className={css.bar}
                x={x}
                y={Math.min(base, valueY)}
                width={Math.max(1, barWidth - 2)}
                height={Math.max(1, Math.abs(base - valueY))}
                rx="3"
                fill={color(seriesIndex)}
              >
                <title>{datum.label + ' · ' + chart.series[seriesIndex]!.label + ': ' + formatNumber(value)}</title>
              </rect>
            )
          }),
        )}

        {(chart.type === 'line' || chart.type === 'area') && chart.series.map((series, seriesIndex) => {
          const points = chart.data.map((datum, pointIndex) => g.x(pointIndex) + ',' + g.y(datum.values[seriesIndex] ?? 0)).join(' ')
          const areaPoints = g.left + ',' + g.y(0) + ' ' + points + ' ' + (g.width - g.right) + ',' + g.y(0)
          return (
            <g key={series.key}>
              {chart.type === 'area' && <polygon points={areaPoints} fill={color(seriesIndex)} opacity="0.12" />}
              <polyline className={css.line} points={points} fill="none" stroke={color(seriesIndex)} />
              {chart.data.map((datum, pointIndex) => (
                <circle
                  key={pointIndex}
                  className={css.point}
                  cx={g.x(pointIndex)}
                  cy={g.y(datum.values[seriesIndex] ?? 0)}
                  r="4"
                  fill={color(seriesIndex)}
                >
                  <title>{datum.label + ' · ' + series.label + ': ' + formatNumber(datum.values[seriesIndex] ?? 0)}</title>
                </circle>
              ))}
            </g>
          )
        })}

        {chart.type === 'scatter' && chart.series.map((series, seriesIndex) =>
          chart.data.map((datum, pointIndex) => (
            <circle
              key={series.key + '-' + pointIndex}
              className={css.point}
              cx={g.x(pointIndex)}
              cy={g.y(datum.values[seriesIndex] ?? 0)}
              r="5"
              fill={color(seriesIndex)}
            >
              <title>{datum.label + ' · ' + series.label + ': ' + formatNumber(datum.values[seriesIndex] ?? 0)}</title>
            </circle>
          )),
        )}

        {chart.data.map((datum, index) => index % labelEvery === 0 || index === chart.data.length - 1
          ? <text key={index} className={css.axisLabel} x={g.x(index)} y={g.height - 24} textAnchor="middle">{datum.label.slice(0, 18)}</text>
          : null)}
      </svg>
    </div>
  )
}

function PolarChart({ chart }: { readonly chart: ParsedChart }) {
  const values = chart.data.map(item => Math.max(0, item.values[0] ?? 0))
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return <div className={css.empty}>No positive values to plot.</div>
  const radius = 72
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className={css.polarWrap}>
      <svg className={css.polar} viewBox="0 0 200 200" role="img" aria-label={chart.type + ' chart'}>
        <g transform="rotate(-90 100 100)">
          {values.map((value, index) => {
            const length = value / total * circumference
            const dashOffset = -offset
            offset += length
            return (
              <circle
                key={index}
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={color(index)}
                strokeWidth={chart.type === 'donut' ? 30 : 72}
                strokeDasharray={length + ' ' + (circumference - length)}
                strokeDashoffset={dashOffset}
              >
                <title>{chart.data[index]!.label + ': ' + formatNumber(value)}</title>
              </circle>
            )
          })}
        </g>
        {chart.type === 'donut' && (
          <g>
            <text className={css.donutValue} x="100" y="96" textAnchor="middle">{formatNumber(total)}</text>
            <text className={css.donutLabel} x="100" y="116" textAnchor="middle">total</text>
          </g>
        )}
      </svg>
      <div className={css.polarLegend}>
        {chart.data.slice(0, 14).map((item, index) => (
          <span key={index}><i style={{ background: color(index) }} />{item.label}<b>{formatNumber(values[index] ?? 0)}</b></span>
        ))}
      </div>
    </div>
  )
}

function ChartView({ spec }: { readonly spec: JsonRecord }) {
  const chart = parseChart(spec)
  if (chart === undefined) return <Fallback spec={spec} />
  return (
    <section className={css.section} data-phoenix-visual-kind="chart">
      {header(spec)}
      <Legend series={chart.series} />
      {chart.type === 'pie' || chart.type === 'donut'
        ? <PolarChart chart={chart} />
        : <CartesianChart chart={chart} />}
    </section>
  )
}

function tableRows(spec: JsonRecord): { readonly columns: readonly string[]; readonly rows: readonly (readonly unknown[])[] } | undefined {
  if (Array.isArray(spec.columns) && spec.columns.every(item => typeof item === 'string') && Array.isArray(spec.rows)) {
    const rows = spec.rows.map(row => Array.isArray(row) ? row : [])
    return { columns: spec.columns as readonly string[], rows }
  }
  if (!Array.isArray(spec.data)) return undefined
  const records = spec.data.filter(isRecord)
  if (records.length === 0) return undefined
  const columns = Array.isArray(spec.columns) && spec.columns.every(item => typeof item === 'string')
    ? spec.columns as readonly string[]
    : Object.keys(records[0]!).slice(0, 12)
  return { columns, rows: records.map(row => columns.map(column => row[column])) }
}

function TableView({ spec }: { readonly spec: JsonRecord }) {
  const parsed = tableRows(spec)
  if (parsed === undefined) return <Fallback spec={spec} />
  return (
    <section className={css.section} data-phoenix-visual-kind="table">
      {header(spec)}
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead><tr>{parsed.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>{parsed.rows.slice(0, 200).map((row, rowIndex) => (
            <tr key={rowIndex}>{parsed.columns.map((column, cellIndex) => <td key={column + '-' + cellIndex}>{display(row[cellIndex])}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      {parsed.rows.length > 200 && <div className={css.caption}>Showing 200 of {parsed.rows.length} rows.</div>}
    </section>
  )
}

function MetricsView({ spec }: { readonly spec: JsonRecord }) {
  const source = Array.isArray(spec.metrics) ? spec.metrics : Array.isArray(spec.data) ? spec.data : []
  const metrics = source.filter(isRecord).slice(0, 12)
  if (metrics.length === 0) return <Fallback spec={spec} />
  return (
    <section className={css.section} data-phoenix-visual-kind="metrics">
      {header(spec)}
      <div className={css.metrics}>
        {metrics.map((metric, index) => (
          <article className={css.metric} key={index}>
            <span>{nonEmpty(metric.label) ?? nonEmpty(metric.name) ?? 'Metric'}</span>
            <strong>{display(metric.value)}</strong>
            {(metric.delta !== undefined || metric.change !== undefined) && (
              <em data-direction={(number(metric.delta ?? metric.change) ?? 0) >= 0 ? 'up' : 'down'}>
                {display(metric.delta ?? metric.change)}
              </em>
            )}
            {(nonEmpty(metric.detail) ?? nonEmpty(metric.hint)) !== undefined && <small>{nonEmpty(metric.detail) ?? nonEmpty(metric.hint)}</small>}
          </article>
        ))}
      </div>
    </section>
  )
}

function TimelineView({ spec }: { readonly spec: JsonRecord }) {
  const source = Array.isArray(spec.timeline) ? spec.timeline : Array.isArray(spec.items) ? spec.items : Array.isArray(spec.data) ? spec.data : []
  const items = source.filter(isRecord).slice(0, 80)
  if (items.length === 0) return <Fallback spec={spec} />
  return (
    <section className={css.section} data-phoenix-visual-kind="timeline">
      {header(spec)}
      <ol className={css.timeline}>
        {items.map((item, index) => (
          <li key={index} data-status={nonEmpty(item.status) ?? undefined}>
            <span className={css.timelineDot} aria-hidden="true" />
            <div>
              <div className={css.timelineTop}>
                <strong>{nonEmpty(item.title) ?? nonEmpty(item.label) ?? 'Event'}</strong>
                {(nonEmpty(item.time) ?? nonEmpty(item.date)) !== undefined && <time>{nonEmpty(item.time) ?? nonEmpty(item.date)}</time>}
              </div>
              {(nonEmpty(item.detail) ?? nonEmpty(item.description) ?? nonEmpty(item.text)) !== undefined && (
                <p>{nonEmpty(item.detail) ?? nonEmpty(item.description) ?? nonEmpty(item.text)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function CardsView({ spec }: { readonly spec: JsonRecord }) {
  const source = Array.isArray(spec.cards) ? spec.cards : Array.isArray(spec.items) ? spec.items : Array.isArray(spec.data) ? spec.data : []
  const items = source.filter(isRecord).slice(0, 24)
  if (items.length === 0) return <Fallback spec={spec} />
  return (
    <section className={css.section} data-phoenix-visual-kind="cards">
      {header(spec)}
      <div className={css.cards}>
        {items.map((item, index) => (
          <article className={css.infoCard} key={index}>
            {(nonEmpty(item.eyebrow) ?? nonEmpty(item.category)) !== undefined && <span>{nonEmpty(item.eyebrow) ?? nonEmpty(item.category)}</span>}
            <strong>{nonEmpty(item.title) ?? nonEmpty(item.label) ?? 'Item'}</strong>
            {(nonEmpty(item.description) ?? nonEmpty(item.text)) !== undefined && <p>{nonEmpty(item.description) ?? nonEmpty(item.text)}</p>}
            {item.value !== undefined && <b>{display(item.value)}</b>}
          </article>
        ))}
      </div>
    </section>
  )
}

function ProgressView({ spec }: { readonly spec: JsonRecord }) {
  const source = Array.isArray(spec.progress) ? spec.progress : Array.isArray(spec.items) ? spec.items : Array.isArray(spec.data) ? spec.data : []
  const items = source.filter(isRecord).slice(0, 40)
  if (items.length === 0) return <Fallback spec={spec} />
  return (
    <section className={css.section} data-phoenix-visual-kind="progress">
      {header(spec)}
      <div className={css.progressList}>
        {items.map((item, index) => {
          const value = number(item.value) ?? 0
          const max = Math.max(number(item.max) ?? 100, 1)
          const percent = Math.max(0, Math.min(100, value / max * 100))
          return (
            <div className={css.progressItem} key={index}>
              <div><span>{nonEmpty(item.label) ?? nonEmpty(item.title) ?? 'Progress'}</span><b>{formatNumber(value)} / {formatNumber(max)}</b></div>
              <div className={css.progressTrack}><i style={{ width: percent + '%' }} /></div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Fallback({ spec }: { readonly spec: JsonRecord }) {
  return <pre className={css.fallback}>{JSON.stringify(spec, null, 2)}</pre>
}

/**
 * Render a rich, dependency-free Phoenix visual surface for structured artifacts.
 * @param props - Visual specification supplied by a tool or model artifact.
 * @returns The responsive visualization surface or a safe structured fallback.
 */
export function PhoenixVisualizer({ spec }: PhoenixVisualizerProps) {
  const kind = visualType(spec)
  switch (kind) {
    case 'chart':
      return <ChartView spec={spec} />
    case 'table':
      return <TableView spec={spec} />
    case 'metrics':
      return <MetricsView spec={spec} />
    case 'timeline':
      return <TimelineView spec={spec} />
    case 'cards':
      return <CardsView spec={spec} />
    case 'progress':
      return <ProgressView spec={spec} />
    case 'visual': {
      if (Array.isArray(spec.metrics)) return <MetricsView spec={spec} />
      if (Array.isArray(spec.timeline)) return <TimelineView spec={spec} />
      if (Array.isArray(spec.cards)) return <CardsView spec={spec} />
      if (Array.isArray(spec.progress)) return <ProgressView spec={spec} />
      if (nonEmpty(spec.chartType) !== undefined || Array.isArray(spec.series)) return <ChartView spec={spec} />
      if (Array.isArray(spec.columns) && Array.isArray(spec.rows)) return <TableView spec={spec} />
      return <Fallback spec={spec} />
    }
    default:
      return <Fallback spec={spec} />
  }
}
