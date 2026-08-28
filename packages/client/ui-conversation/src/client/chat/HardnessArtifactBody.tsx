import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { HardnessArtifactValue } from '../conversation-nodes/hardness-artifact.ts'
import styles from './HardnessArtifactNodeView.module.css'

interface ArtifactBodyProps {
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly expanded: boolean
  readonly title: string
}

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
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

function safeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  if (candidate === '') return undefined
  if (/^(https?:|blob:|data:image\/|data:application\/pdf)/i.test(candidate)) return candidate
  if (candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../')) return candidate
  return undefined
}

function autoLoadable(value: string): boolean {
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../')
    || value.startsWith('blob:') || value.startsWith('data:')
}

function TablePreview({ record }: { readonly record: JsonRecord }) {
  const columns = Array.isArray(record.columns) && record.columns.every(item => typeof item === 'string')
    ? record.columns as readonly string[]
    : undefined
  const rows = Array.isArray(record.rows) && record.rows.every(Array.isArray)
    ? record.rows as readonly (readonly unknown[])[]
    : undefined
  if (columns === undefined || rows === undefined) return null
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column, cell) => <td key={`${column}-${cell}`}>{display(row[cell])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ChartPoint {
  readonly label: string
  readonly value: number
}

function firstSeries(record: JsonRecord): { readonly dataKey: string; readonly label: string } | undefined {
  if (!Array.isArray(record.series)) return undefined
  const candidate = record.series.find(isRecord)
  if (candidate === undefined || typeof candidate.dataKey !== 'string') return undefined
  return {
    dataKey: candidate.dataKey,
    label: typeof candidate.label === 'string' ? candidate.label : candidate.dataKey,
  }
}

function chartPoints(record: JsonRecord): { readonly points: readonly ChartPoint[]; readonly seriesLabel: string } | undefined {
  const series = firstSeries(record)
  if (series === undefined || !Array.isArray(record.data)) return undefined
  const xKey = typeof record.xKey === 'string' ? record.xKey : 'label'
  const points: ChartPoint[] = []
  for (const item of record.data) {
    if (!isRecord(item)) continue
    const raw = item[series.dataKey]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    points.push({ label: display(item[xKey]) || String(points.length + 1), value: raw })
  }
  return points.length === 0 ? undefined : { points, seriesLabel: series.label }
}

function BarChart({ points }: { readonly points: readonly ChartPoint[] }) {
  const max = Math.max(...points.map(point => Math.abs(point.value)), 1)
  return (
    <div className={styles.barRows} role="img" aria-label="Bar chart">
      {points.slice(0, 40).map((point, index) => (
        <div className={styles.barRow} key={`${point.label}-${index}`}>
          <span title={point.label}>{point.label}</span>
          <span className={styles.barTrack} aria-hidden="true">
            <span className={styles.barFill} style={{ width: `${Math.max(1, Math.abs(point.value) / max * 100)}%` }} />
          </span>
          <span>{point.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function LineChart({ points }: { readonly points: readonly ChartPoint[] }) {
  const width = 640
  const height = 220
  const pad = 24
  const values = points.map(point => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const plot = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : pad + index * (width - pad * 2) / (points.length - 1)
    const y = height - pad - (point.value - min) / span * (height - pad * 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg className={styles.chartSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Line chart">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" opacity="0.18" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" opacity="0.18" />
      <polyline points={plot} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" opacity="0.72" />
      {plot.split(' ').map((pair, index) => {
        const [x, y] = pair.split(',').map(Number)
        return <circle key={index} cx={x} cy={y} r="3.5" fill="currentColor"><title>{`${points[index]?.label}: ${points[index]?.value}`}</title></circle>
      })}
      <text x={pad} y={height - 6} fontSize="10" fill="currentColor" opacity="0.62">{points[0]?.label}</text>
      <text x={width - pad} y={height - 6} textAnchor="end" fontSize="10" fill="currentColor" opacity="0.62">{points.at(-1)?.label}</text>
    </svg>
  )
}

function ChartPreview({ record }: { readonly record: JsonRecord }) {
  const parsed = chartPoints(record)
  if (parsed === undefined) return <pre className={styles.code}>{JSON.stringify(record, null, 2)}</pre>
  const kind = typeof record.chartType === 'string' ? record.chartType : 'bar'
  return (
    <div className={styles.stack}>
      <strong>{parsed.seriesLabel}</strong>
      {kind === 'line' ? <LineChart points={parsed.points} /> : <BarChart points={parsed.points} />}
    </div>
  )
}

interface UiNode {
  readonly type: string
  readonly id?: string
  readonly label?: string
  readonly text?: string
  readonly value?: unknown
  readonly action?: string
  readonly children?: readonly unknown[]
}

function asUiNode(value: unknown): UiNode | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  return value as unknown as UiNode
}

function UiNodeView({ node, values, setValue }: {
  readonly node: UiNode
  readonly values: Readonly<Record<string, string>>
  readonly setValue: (id: string, value: string) => void
}): ReactNode {
  if (node.type === 'stack') {
    const children = Array.isArray(node.children)
      ? node.children.map(asUiNode).filter((item): item is UiNode => item !== undefined)
      : []
    return (
      <div className={styles.stack}>
        {children.map((child, index) => (
          <UiNodeView key={child.id ?? index} node={child} values={values} setValue={setValue} />
        ))}
      </div>
    )
  }
  if (node.type === 'input') {
    const id = node.id ?? node.label ?? 'input'
    return (
      <label className={styles.formLabel}>
        {node.label ?? id}
        <input
          className={styles.input}
          value={values[id] ?? display(node.value)}
          onChange={(event) => { setValue(id, event.currentTarget.value) }}
        />
      </label>
    )
  }
  if (node.type === 'button') {
    const hasAction = typeof node.action === 'string' && node.action.trim() !== ''
    return <button className={styles.uiButton} type="button" disabled={hasAction} title={hasAction ? 'External actions require the Phoenix approval bridge.' : undefined}>{node.label ?? 'Button'}</button>
  }
  if (node.type === 'result') return <output>{node.label ?? node.text ?? display(node.value)}</output>
  return <div>{node.text ?? node.label ?? display(node.value)}</div>
}

function DeclarativeUi({ record }: { readonly record: JsonRecord }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const root = asUiNode(record.root)
  if (root === undefined) return <pre className={styles.code}>{JSON.stringify(record, null, 2)}</pre>
  return (
    <div className={styles.form}>
      <UiNodeView
        node={root}
        values={values}
        setValue={(id, value) => { setValues(current => ({ ...current, [id]: value })) }}
      />
    </div>
  )
}

function sandboxDocument(html: string): string {
  const csp = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}">${head}<style>html,body{margin:0;padding:0;min-height:0;height:auto;font-family:system-ui,sans-serif}body{padding:16px;box-sizing:border-box}</style></head><body>${body}</body></html>`
}

function MiniApp({ html, expanded, title }: { readonly html: string; readonly expanded: boolean; readonly title: string }) {
  const [interactive, setInteractive] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const srcDoc = useMemo(() => sandboxDocument(html), [html])
  const reloadPreview = (): void => {
    setPreviewReady(false)
    setReloadToken(value => value + 1)
  }
  return (
    <div className={styles.stack}>
      <div className={styles.previewToolbar} role="status" aria-live="polite">
        <span className={styles.previewState}>{previewReady ? 'Preview ready' : 'Loading preview'}</span>
        <button className={styles.uiButton} type="button" onClick={reloadPreview}>Reload preview</button>
      </div>
      <iframe
        key={reloadToken}
        ref={frameRef}
        className={`${styles.frame} ${expanded ? styles.frameExpanded : ''}`}
        title={title}
        srcDoc={srcDoc}
        sandbox={interactive ? 'allow-scripts' : ''}
        onLoad={() => { setPreviewReady(true) }}
      />
      <div>
        <button className={styles.uiButton} type="button" onClick={() => { setInteractive(value => !value); setPreviewReady(false) }}>
          {interactive ? 'Disable interaction' : 'Enable sandboxed interaction'}
        </button>
      </div>
      <p className={styles.note}>
        Mini-app scripts run only inside a unique-origin sandbox with network, forms,
        popups and parent access blocked.
      </p>
    </div>
  )
}

function DocumentPreview({ mime, url, textContent, expanded, title }: {
  readonly mime: string
  readonly url?: string
  readonly textContent?: string
  readonly expanded: boolean
  readonly title: string
}) {
  if (textContent !== undefined) return <pre className={styles.text}>{textContent}</pre>
  if (url === undefined) return <p className={styles.note}>Document metadata is available, but no previewable content was provided.</p>
  if (mime === 'application/pdf' && expanded && autoLoadable(url)) {
    return <iframe className={`${styles.frame} ${styles.frameExpanded}`} title={title} src={url} sandbox="" />
  }
  return <a className={styles.link} href={url} target="_blank" rel="noreferrer">Open document</a>
}

function renderBlock(block: JsonRecord, index: number, expanded: boolean): ReactNode {
  const type = text(block.type) ?? 'unknown'
  if (type === 'markdown' || type === 'text') return <p className={styles.text} key={index}>{display(block.text)}</p>
  if (type === 'code') return <pre className={styles.code} key={index}>{display(block.text)}</pre>
  if (type === 'table') return <TablePreview key={index} record={block} />
  if (type === 'chart') return <ChartPreview key={index} record={isRecord(block.spec) ? block.spec : block} />
  if (type === 'ui' || type === 'form') return <DeclarativeUi key={index} record={isRecord(block.schema) ? block.schema : block} />
  if (type === 'image') {
    const src = safeHref(block.src)
    if (src === undefined) return <p className={styles.note} key={index}>Image source was rejected.</p>
    return autoLoadable(src)
      ? <img className={styles.image} key={index} src={src} alt={text(block.alt) ?? 'Artifact image'} />
      : <a className={styles.link} key={index} href={src} target="_blank" rel="noreferrer">Open image</a>
  }
  if (type === 'document' || type === 'file') {
    const url = safeHref(block.url)
    const textContent = text(block.text)
    const mime = text(block.mime) ?? 'application/octet-stream'
    return <DocumentPreview
      key={index}
      mime={mime}
      {...url === undefined ? {} : { url }}
      {...textContent === undefined ? {} : { textContent }}
      expanded={expanded}
      title={text(block.filename) ?? 'Document'}
    />
  }
  if (type === 'app') {
    const entry = text(block.entry)
    const files = isRecord(block.files) ? block.files : undefined
    const entryFile = entry === undefined || files === undefined ? undefined : files[entry]
    const html = typeof entryFile === 'string' ? entryFile : text(block.html)
    return html === undefined
      ? <pre className={styles.code} key={index}>{JSON.stringify(block, null, 2)}</pre>
      : <MiniApp key={index} html={html} expanded={expanded} title="HARDNESS mini-app" />
  }
  return <pre className={styles.code} key={index}>{JSON.stringify(block, null, 2)}</pre>
}

function RecordPreview({ record, mime, expanded, title }: {
  readonly record: JsonRecord
  readonly mime: string
  readonly expanded: boolean
  readonly title: string
}) {
  if (Array.isArray(record.blocks)) {
    return (
      <div className={styles.stack}>
        {record.blocks.map((block, index) => (
          isRecord(block)
            ? renderBlock(block, index, expanded)
            : <pre className={styles.code} key={index}>{display(block)}</pre>
        ))}
      </div>
    )
  }
  if (mime === 'application/vnd.hardness.ui+json' || isRecord(record.root)) return <DeclarativeUi record={record} />
  if (mime === 'application/vnd.hardness.chart+json' || typeof record.chartType === 'string') return <ChartPreview record={record} />
  if (Array.isArray(record.columns) && Array.isArray(record.rows)) return <TablePreview record={record} />
  if (typeof record.entry === 'string' && isRecord(record.files)) {
    const html = typeof record.files[record.entry] === 'string' ? record.files[record.entry] as string : undefined
    if (html !== undefined) return <MiniApp html={html} expanded={expanded} title={title} />
  }
  return <pre className={styles.code}>{JSON.stringify(record, null, 2)}</pre>
}

export function HardnessArtifactBody({ mime, data, expanded, title }: ArtifactBodyProps) {
  if (typeof data === 'string') {
    if (mime === 'text/html' || mime === 'application/vnd.hardness.app+html') return <MiniApp html={data} expanded={expanded} title={title} />
    if (mime.startsWith('image/')) {
      const src = safeHref(data)
      if (src === undefined) return <p className={styles.note}>Image source was rejected.</p>
      return autoLoadable(src)
        ? <img className={styles.image} src={src} alt={title} />
        : <a className={styles.link} href={src} target="_blank" rel="noreferrer">Open image</a>
    }
    if (mime === 'application/pdf') {
      const url = safeHref(data)
      return <DocumentPreview mime={mime} {...url === undefined ? {} : { url }} expanded={expanded} title={title} />
    }
    return <pre className={mime.includes('json') ? styles.code : styles.text}>{data}</pre>
  }
  return <RecordPreview record={data} mime={mime} expanded={expanded} title={title} />
}
