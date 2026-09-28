import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import type { HardnessArtifactValue } from '../artifact.ts'
import type { RenderMessageImages } from '../contract/slots.ts'
import styles from './HardnessArtifactNodeView.module.css'
import { PhoenixVisualizer, supportsPhoenixVisual } from './PhoenixVisualizer.tsx'

interface ArtifactBodyProps {
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly expanded: boolean
  readonly title: string
  readonly executable?: boolean
  readonly renderMessageImages?: RenderMessageImages
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

function parseJsonArtifact(value: string): unknown {
  const source = value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
  try {
    return JSON.parse(source) as unknown
  } catch {
    return undefined
  }
}

function isJsonArtifact(mime: string, title: string): boolean {
  return mime.toLowerCase().includes('json') || title.trim().toLowerCase().endsWith('.json')
}

function embeddedVisual(record: JsonRecord): JsonRecord | undefined {
  if (supportsPhoenixVisual(record)) return record
  for (const key of ['visual', 'spec', 'chart'] as const) {
    const nested = record[key]
    if (isRecord(nested) && supportsPhoenixVisual(nested)) return nested
  }

  const chartJsData = isRecord(record.data) ? record.data : undefined
  if (chartJsData !== undefined && Array.isArray(chartJsData.labels) && Array.isArray(chartJsData.datasets)) {
    const datasets = chartJsData.datasets.filter(isRecord)
    const series = datasets.flatMap((dataset, index) => {
      if (!Array.isArray(dataset.data) || !dataset.data.some(item => typeof item === 'number' && Number.isFinite(item))) return []
      return [{ dataKey: `series${index + 1}`, label: text(dataset.label) ?? `Series ${index + 1}` }]
    })
    if (series.length > 0) {
      const rows = chartJsData.labels.map((label, rowIndex) => {
        const row: Record<string, unknown> = { label: display(label) }
        for (let index = 0; index < datasets.length; index += 1) {
          const dataset = datasets[index]
          if (!Array.isArray(dataset?.data)) continue
          const value = dataset.data[rowIndex]
          if (typeof value === 'number' && Number.isFinite(value)) row[`series${index + 1}`] = value
        }
        return row
      })
      const rawType = text(record.type)?.toLowerCase()
      const chartType = rawType === 'line' || rawType === 'pie' || rawType === 'doughnut' || rawType === 'donut'
        ? (rawType === 'doughnut' ? 'donut' : rawType)
        : 'bar'
      return { visualType: 'chart', chartType, xKey: 'label', series, data: rows }
    }
  }

  if (Array.isArray(record.labels) && Array.isArray(record.values)) {
    const values = record.values
    if (values.some(item => typeof item === 'number' && Number.isFinite(item))) {
      const rows = record.labels.map((label, index) => ({
        label: display(label),
        value: typeof values[index] === 'number' && Number.isFinite(values[index]) ? values[index] : 0,
      }))
      return {
        visualType: 'chart',
        chartType: text(record.chartType) ?? 'bar',
        xKey: 'label',
        series: [{ dataKey: 'value', label: text(record.seriesName) ?? text(record.label) ?? 'Value' }],
        data: rows,
      }
    }
  }
  return undefined
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

function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.attachmentId !== 'string' || value.attachmentId.trim() === '') return undefined
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(value.mediaType as string)) return undefined
  if (typeof value.bytes !== 'number' || !Number.isInteger(value.bytes) || value.bytes <= 0) return undefined
  if (typeof value.width !== 'number' || !Number.isInteger(value.width) || value.width <= 0) return undefined
  if (typeof value.height !== 'number' || !Number.isInteger(value.height) || value.height <= 0) return undefined
  return value as unknown as ImageAttachmentRef
}

function ImageAttachmentPreview({ attachment, renderMessageImages }: {
  readonly attachment: ImageAttachmentRef
  readonly renderMessageImages?: RenderMessageImages
}) {
  if (renderMessageImages === undefined) {
    return <p className={styles.note}>Image attachment is available, but no image renderer is configured.</p>
  }
  return renderMessageImages({ images: [{ attachment }], align: 'start' })
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
  const csp = [
    "default-src 'none'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ') + ';'
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  const heightReporter = '<script>(function(){function report(){var root=document.documentElement;parent.postMessage({type:\'phoenix-artifact-height\',height:Math.max(root.scrollHeight,root.offsetHeight)},\'*\')}if(window.ResizeObserver){new ResizeObserver(report).observe(document.documentElement)}new MutationObserver(report).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});window.addEventListener(\'load\',report);report()})()<\/script>'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}">${head}<style>html,body{margin:0;padding:0;min-height:0;height:auto;font-family:system-ui,sans-serif}body{padding:16px;box-sizing:border-box}</style></head><body>${body}${heightReporter}</body></html>`
}

interface MiniAppProps {
  readonly html: string
  readonly title: string
  readonly executable?: boolean
}

function MiniApp({ html, title, executable = false }: MiniAppProps) {
  const [frameHeight, setFrameHeight] = useState(1)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const srcDoc = useMemo(() => sandboxDocument(html), [html])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (typeof event.data !== 'object' || event.data === null) return
      const message = event.data as Record<string, unknown>
      if (message.type !== 'phoenix-artifact-height' || typeof message.height !== 'number' || !Number.isFinite(message.height)) return
      setFrameHeight(Math.max(1, Math.ceil(message.height)))
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  const measureStaticDocument = (): void => {
    if (executable) return
    const frame = frameRef.current
    const documentElement = frame?.contentDocument?.documentElement
    const body = frame?.contentDocument?.body
    if (documentElement === undefined || documentElement === null || body === undefined || body === null) return
    const measure = (): void => {
      setFrameHeight(Math.max(
        1,
        Math.ceil(
          Math.max(
            documentElement.scrollHeight,
            documentElement.offsetHeight,
            body.scrollHeight,
            body.offsetHeight,
          ),
        ),
      ))
    }
    measure()
    requestAnimationFrame(measure)
  }

  return (
    <iframe
      ref={frameRef}
      className={styles.frame}
      title={title}
      srcDoc={srcDoc}
      sandbox={executable ? 'allow-scripts' : 'allow-same-origin'}
      style={{ height: frameHeight }}
      onLoad={measureStaticDocument}
    />
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
  if (type === 'table' || type === 'chart' || type === 'metrics' || type === 'timeline' || type === 'cards' || type === 'progress' || type === 'sports' || type === 'scoreboard' || type === 'standings' || type === 'visual') {
    return <PhoenixVisualizer key={index} spec={isRecord(block.spec) ? block.spec : block} />
  }
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
      : <MiniApp key={index} html={html} title="HARDNESS mini-app" />
  }
  return <pre className={styles.code} key={index}>{JSON.stringify(block, null, 2)}</pre>
}

function RecordPreview({ record, mime, expanded, title, renderMessageImages }: {
  readonly record: JsonRecord
  readonly mime: string
  readonly expanded: boolean
  readonly title: string
  readonly renderMessageImages?: RenderMessageImages
}) {
  const attachment = imageAttachment(record.attachment)
  if (attachment !== undefined) {
    return <ImageAttachmentPreview
      attachment={attachment}
      {...renderMessageImages === undefined ? {} : { renderMessageImages }}
    />
  }
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
  const visual = embeddedVisual(record)
  if (mime === 'application/vnd.phoenix.visual+json'
    || mime === 'application/vnd.hardness.visual+json'
    || mime === 'application/vnd.hardness.chart+json'
    || visual !== undefined) return <PhoenixVisualizer spec={visual ?? record} />
  if (typeof record.entry === 'string' && isRecord(record.files)) {
    const html = typeof record.files[record.entry] === 'string' ? record.files[record.entry] as string : undefined
    if (html !== undefined) return <MiniApp html={html} title={title} />
  }
  return <pre className={styles.code}>{JSON.stringify(record, null, 2)}</pre>
}

export function HardnessArtifactBody({ mime, data, expanded, title, executable = false, renderMessageImages }: ArtifactBodyProps) {
  if (typeof data === 'string') {
    if (mime === 'text/html' || mime === 'application/vnd.hardness.app+html') return <MiniApp html={data} title={title} executable={executable} />
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
    if (isJsonArtifact(mime, title)) {
      const parsed = parseJsonArtifact(data)
      if (isRecord(parsed)) {
        return <RecordPreview
          record={parsed}
          mime={mime}
          expanded={expanded}
          title={title}
          {...renderMessageImages === undefined ? {} : { renderMessageImages }}
        />
      }
      if (parsed !== undefined) return <pre className={styles.code}>{JSON.stringify(parsed, null, 2)}</pre>
    }
    return <pre className={isJsonArtifact(mime, title) ? styles.code : styles.text}>{data}</pre>
  }
  return <RecordPreview
    record={data}
    mime={mime}
    expanded={expanded}
    title={title}
    {...renderMessageImages === undefined ? {} : { renderMessageImages }}
  />
}
