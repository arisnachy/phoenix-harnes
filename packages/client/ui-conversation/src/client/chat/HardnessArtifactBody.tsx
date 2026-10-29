import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import type { HardnessArtifactValue } from '../artifact.ts'
import type { RenderMessageImages } from '../contract/slots.ts'
import styles from './HardnessArtifactNodeView.module.css'
import { PhoenixVisualizer, supportsPhoenixVisual } from './PhoenixVisualizer.tsx'
import { Scene3DView } from './Scene3DView.tsx'
import { GeoMap, parseGeoMapSpec } from './GeoMap.tsx'
import { SceneMap, parseSceneMapSpec } from './SceneMap.tsx'
import { DiagramSurface, parseDiagramSpec } from './DiagramSurface.tsx'
import { auditGameHtml, readGameManifest } from './game-studio-quality.ts'
import { hasExecutableHtmlBehavior, hasExternalImageReferences, inlineBundledImages, isolatedHtmlPreviewWindow } from './html-preview-assets.ts'
import {
  libraryGameId, listLibraryGames, openGameInWindow, removeLibraryGame, saveLibraryGame,
  type LibraryGame,
} from './game-library.ts'

interface ArtifactBodyProps {
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly expanded: boolean
  readonly title: string
  readonly executable?: boolean
  readonly renderMessageImages?: RenderMessageImages
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
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

function safeWebPreviewUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  if (candidate === '') return undefined
  if (/^https?:\/\//i.test(candidate) || candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../') || candidate.startsWith('blob:')) {
    return candidate
  }
  return undefined
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

function sandboxDocument(html: string, executable: boolean, gameDiagnostics = false, allowExternalImages = false): string {
  // Static HTML previews cannot execute script, so allowing image fetches gives
  // them the same visual fidelity as opening the document directly without
  // granting the document any parent/app authority. Executable mini-apps keep
  // outbound image requests blocked because script-created <img> requests could
  // otherwise become a network exfiltration channel around connect-src 'none'.
  const imageSources = executable && !allowExternalImages
    ? 'img-src data: blob:'
    : 'img-src data: blob: https: http:'
  const csp = [
    "default-src 'none'",
    imageSources,
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
  // External scripts intentionally cannot load inside the isolated srcDoc.
  // Explain this *in the visible artifact* when a chart depends on such a
  // resource; a blank canvas otherwise looks like an apparently successful job.
  const remoteChartDependency = /<script\b[^>]*\bsrc\s*=/iu.test(html)
    && /<canvas\b|chart(?:\.js)?|plotly|echarts|apexcharts|gr[aá]fica/iu.test(html)
  // A generated image filename alone is not an embedded image: when no
  // companion bytes were supplied, surface the missing asset instead of
  // silently reporting a fully rendered page.
  const unresolvedImage = /<img\b[^>]*\bsrc\s*=\s*["'](?!data:|blob:|https?:\/\/|\/\/|\/)[^"']+/iu.test(html)
  const missingImageNotice = unresolvedImage
    ? '<p role="alert" data-phoenix-missing-image="true" style="padding:10px;border:1px solid #d9b886;border-radius:8px;background:#fff8eb;color:#543e24">'
      + 'Esta página contiene imágenes locales sin empaquetar. Adjunta sus bytes en files o usa una URL HTTPS accesible; una ruta exec-*.png no es una imagen publicada.</p>'
    : ''
  const dependencyNotice = remoteChartDependency
    ? '<p role="alert" style="margin:0 0 12px;padding:12px 14px;border:1px solid #dfba7e;'
      + 'border-radius:10px;background:#fff8eb;color:#533e22;line-height:1.45">'
      + 'Esta gráfica HTML utiliza una biblioteca externa bloqueada por seguridad. '
      + 'Para verla en Phoenix, genera una gráfica nativa con phoenix_visualize, '
      + 'o crea una versión HTML completamente autónoma, sin CDN.</p>'
    : ''
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  // Isolated iframe documents cannot inherit Phoenix theme CSS custom properties.
  // Reconcile genuine forms with the Host palette, without touching games or art.
  const themedForm = !gameDiagnostics && /<(?:form|input|select|textarea|fieldset)\b/i.test(html)
  const themeStyle = themedForm
    ? '<style data-phoenix-form-theme="true">'
      + ':root{--phoenix-ui-bg:#faf8f5;--phoenix-ui-surface:#fcfaf7;--phoenix-ui-muted:#f2ede7;'
      + '--phoenix-ui-text:#292420;--phoenix-ui-secondary:#746961;--phoenix-ui-border:#dfd6ce;'
      + '--phoenix-ui-accent:#ea5b22;--phoenix-ui-scheme:light;color-scheme:var(--phoenix-ui-scheme)}'
      + '@media(prefers-color-scheme:dark){:root{--phoenix-ui-bg:#1d1b1a;'
      + '--phoenix-ui-surface:#282523;--phoenix-ui-muted:#332e2b;--phoenix-ui-text:#f4eee8;'
      + '--phoenix-ui-secondary:#c5b7a9;--phoenix-ui-border:#514840;--phoenix-ui-accent:#f39a5c;--phoenix-ui-scheme:dark;color-scheme:var(--phoenix-ui-scheme)}}'
      + 'html,body{background:var(--phoenix-ui-bg)!important;color:var(--phoenix-ui-text)!important}'
      + 'body{padding:clamp(12px,2.2vw,22px)!important;line-height:1.5}'
      + 'body :where(main,article,section,form,header,footer,[class*="card"],[class*="panel"],'
      + '[class*="hero"],[class*="intro"],[class*="container"]){'
      + 'background-color:var(--phoenix-ui-surface)!important;color:var(--phoenix-ui-text)!important;'
      + 'border-color:var(--phoenix-ui-border)!important;box-shadow:none!important}'
      + 'body :where([class*="notice"],[class*="info"],[class*="hint"]){'
      + 'background-color:var(--phoenix-ui-muted)!important;border-color:var(--phoenix-ui-border)!important}'
      + 'body :where(h1,h2,h3,h4,label,legend){color:var(--phoenix-ui-text)!important}'
      + 'body :where(p,small){color:var(--phoenix-ui-secondary)!important}'
      + 'body :where(input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select){'
      + 'box-sizing:border-box;max-width:100%;min-height:40px;border-radius:11px!important;'
      + 'border:1px solid var(--phoenix-ui-border)!important;background:var(--phoenix-ui-surface)!important;'
      + 'color:var(--phoenix-ui-text)!important;padding:9px 12px;font:inherit!important}'
      + 'body :where(input[type=checkbox],input[type=radio],input[type=range]){'
      + 'accent-color:var(--phoenix-ui-accent)!important}'
      + 'body :where(button,[role=button]){border-radius:11px!important;'
      + 'border:1px solid var(--phoenix-ui-border)!important;'
      + 'background:var(--phoenix-ui-muted)!important;color:var(--phoenix-ui-text)!important;'
      + 'font:inherit!important;min-height:38px;cursor:pointer}'
      + 'body :where(button,[role=button]):hover{border-color:var(--phoenix-ui-accent)!important}'
      + 'body :where(button,input,select,textarea,[role=button]):focus-visible{'
      + 'outline:2px solid var(--phoenix-ui-accent)!important;outline-offset:2px!important}'
      + 'body :where(table){width:100%;border-collapse:collapse;color:var(--phoenix-ui-text)}'
      + 'body :where(th,td){border-bottom:1px solid var(--phoenix-ui-border)!important;padding:8px}'
      + 'body :where(th){background:var(--phoenix-ui-muted)!important}'
      + '@media(max-width:600px){body{padding:10px!important}body :where(main,article,section){max-width:100%}}'
      + '</style>'
    : ''
  // Theme updates carry palette values only. The opaque-origin iframe does not
  // acquire access to parent DOM, accounts, tools, cookies or credentials.
  const themeBridge = themedForm
    ? '<script>(function(){var names={bg:1,surface:1,muted:1,text:1,secondary:1,border:1,accent:1,scheme:1};'
      + 'window.addEventListener("message",function(event){if(event.source!==parent)return;'
      + 'var packet=event.data;if(!packet||packet.type!=="phoenix-artifact-theme"||!packet.colors)return;'
      + 'Object.keys(names).forEach(function(name){var color=packet.colors[name];'
      + 'if(typeof color==="string"&&color.length<160&&color.length>0)'
      + 'document.documentElement.style.setProperty("--phoenix-ui-"+name,color)})})})()<\/script>'
    : ''
  const runtimeErrors = gameDiagnostics
    ? '<script>(function(){function alertGame(reason){if(!document.body)return;var p=document.createElement("p");p.setAttribute("role","alert");p.setAttribute("data-phoenix-game-error","true");p.style.cssText="padding:12px;background:#461e26;color:#fff;border:2px solid #eb7688;border-radius:8px";p.textContent="Game Studio: error al ejecutar el juego ("+String(reason).slice(0,180)+"). Revisa el script, los recursos y la consola. El manifiesto JSON no causa por sí solo este error.";document.body.insertBefore(p,document.body.firstChild)}window.addEventListener("error",function(e){alertGame(e.message||"JavaScript error")});window.addEventListener("unhandledrejection",function(e){alertGame(e.reason&&e.reason.message||"unhandled rejection")})})()<\/script>'
    : ''
  const heightReporter = '<script>(function(){function height(){var root=document.documentElement,body=document.body;return Math.max(root?root.scrollHeight:0,root?root.offsetHeight:0,body?body.scrollHeight:0,body?body.offsetHeight:0,1)}function report(){parent.postMessage({type:\'phoenix-artifact-height\',height:height()},\'*\')}if(window.ResizeObserver){var ro=new ResizeObserver(report);ro.observe(document.documentElement);if(document.body)ro.observe(document.body)}new MutationObserver(report).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});window.addEventListener(\'load\',report);window.addEventListener(\'resize\',report);report()})()<\/script>'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}">${head}<style>html,body{margin:0;padding:0;min-height:0;height:auto;font-family:system-ui,sans-serif}body{padding:16px;box-sizing:border-box}</style>${themeStyle}</head><body>${dependencyNotice}${missingImageNotice}${runtimeErrors}${body}${themeBridge}${heightReporter}</body></html>`
}

interface MiniAppProps {
  readonly html: string
  readonly title: string
  readonly executable?: boolean
  readonly minimumHeight?: number
  readonly gameDiagnostics?: boolean
}

function MiniApp({ html, title, executable = false, minimumHeight = 1, gameDiagnostics = false }: MiniAppProps) {
  const [approvedExternalImagesFor, setApprovedExternalImagesFor] = useState<string>()
  // Preserve interactive HTML unless a remote-image page has no authored code.
  const remoteImages = hasExternalImageReferences(html)
  const runScripts = executable && (gameDiagnostics || !remoteImages || hasExecutableHtmlBehavior(html))
  const allowExternalImages = runScripts && approvedExternalImagesFor === html
  const externalImagesAvailable = runScripts && remoteImages
  const [frameHeight, setFrameHeight] = useState(1)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const srcDoc = useMemo(() => sandboxDocument(html, runScripts, gameDiagnostics, allowExternalImages),
    [html, runScripts, gameDiagnostics, allowExternalImages])
  const [standaloneUrl, setStandaloneUrl] = useState<string>()
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    // This URL opens a shell, not the authored HTML at Phoenix's origin.
    // The document executes (if enabled) only in an opaque-origin iframe.
    const url = URL.createObjectURL(new Blob([isolatedHtmlPreviewWindow(srcDoc, title, runScripts)],
      { type: 'text/html;charset=utf-8' }))
    setStandaloneUrl(url)
    return () => { URL.revokeObjectURL(url) }
  }, [srcDoc, title, runScripts])

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

  const syncTheme = (): void => {
    const frame = frameRef.current
    if (frame === null) return
    const source = window.getComputedStyle(frame.closest('[data-universal-artifact]') ?? document.documentElement)
    const root = window.getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string): string =>
      source.getPropertyValue(name).trim() || root.getPropertyValue(name).trim() || fallback
    const colors: Record<string, string> = {
      bg: token('--dsw-alias-bg-layer-1', '#faf8f5'),
      surface: token('--dsw-alias-surface-primary', '#fcfaf7'),
      muted: token('--dsw-alias-interactive-bg-hover', '#f2ede7'),
      text: token('--dsw-alias-label-primary', '#292420'),
      secondary: token('--dsw-alias-label-secondary', '#746961'),
      border: token('--dsw-alias-border-subtle', '#dfd6ce'),
      accent: token('--dsw-alias-state-info-primary', '#ea5b22'),
      scheme: (document.documentElement.getAttribute('data-theme') ?? document.querySelector('body')?.getAttribute('data-theme')
        ?? document.documentElement.getAttribute('data-appearance') ?? '').toLowerCase().includes('dark')
        || root.colorScheme.includes('dark') ? 'dark' : 'light',
    }
    frame.contentWindow?.postMessage({ type: 'phoenix-artifact-theme', colors }, '*')
    // Static previews have no script privileges and are same-origin sandboxed.
    if (!runScripts) {
      const rootElement = frame.contentDocument?.documentElement
      if (rootElement) {
        for (const [name, color] of Object.entries(colors))
          rootElement.style.setProperty('--phoenix-ui-' + name, color)
      }
    }
  }
  useEffect(() => {
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-appearance'],
    })
    const documentBody = document.querySelector('body')
    if (documentBody !== null) observer.observe(documentBody, {
      attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-appearance'],
    })
    return () => { observer.disconnect() }
  }, [runScripts])

  const measureStaticDocument = (): void => {
    if (runScripts) return
    const frame = frameRef.current
    const documentElement = frame?.contentDocument?.documentElement
    const body = frame?.contentDocument?.body
    if (!documentElement || !body) return
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
    <div className={styles.miniAppWrap}>
      {!gameDiagnostics && <div className={styles.pageAddress} data-phoenix-website-url="true">
        <label>URL de la vista completa
          <input type="text" readOnly aria-label="URL temporal de la página"
            value={standaloneUrl ?? ''} onFocus={(event) => { event.currentTarget.select() }} />
        </label>
        {standaloneUrl !== undefined && <>
          <a className={styles.link} href={standaloneUrl}
            target="_blank" rel="noopener noreferrer">Abrir página en otra pestaña</a>
          <a className={styles.link} href={standaloneUrl}
            download={title.replace(/[^a-z0-9._-]+/giu, '-') + '.html'}>Guardar HTML</a>
        </>}
        <small>URL temporal del navegador, no publicación pública. Descarga el HTML para conservarlo.</small>
      </div>}
      {externalImagesAvailable && <button type="button" className={styles.remoteImageToggle}
        aria-pressed={allowExternalImages}
        onClick={() => { setApprovedExternalImagesFor(value => value === html ? undefined : html) }}>
        {allowExternalImages ? 'Bloquear imágenes externas' : 'Cargar imágenes externas'}
      </button>}
      <iframe
        ref={frameRef}
        className={styles.frame}
        title={title}
        srcDoc={srcDoc}
        sandbox={runScripts ? 'allow-scripts' : 'allow-same-origin'}
        referrerPolicy="no-referrer"
        style={{ height: Math.max(frameHeight, minimumHeight) }}
        onLoad={() => { measureStaticDocument(); syncTheme() }}
      />
    </div>
  )
}

function WebPagePreview({ url, title }: { readonly url: string; readonly title: string }) {
  return (
    <div className={styles.stack}>
      <iframe
        className={styles.frame}
        title={title}
        src={url}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{ minHeight: 420, height: 'min(70vh, 720px)' }}
      />
      <div className={styles.pageAddress} data-phoenix-website-url="true">
        <label>URL de la página
          <input type="text" readOnly aria-label="URL de la página" value={url}
            onFocus={(event) => { event.currentTarget.select() }} />
        </label>
        <a className={styles.link} href={url} target="_blank" rel="noopener noreferrer">Abrir página en otra pestaña</a>
      </div>
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
  if (type === 'web-preview' || type === 'page' || type === 'webpage') {
    const url = safeWebPreviewUrl(block.url)
    return url === undefined
      ? <p className={styles.note} key={index}>Page preview URL was rejected.</p>
      : <WebPagePreview key={index} url={url} title={text(block.title) ?? text(block.label) ?? 'Page preview'} />
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
      : <MiniApp key={index} html={files === undefined || entry === undefined ? html : inlineBundledImages(entry, html, files)} title="HARDNESS mini-app" executable />
  }
  return <pre className={styles.code} key={index}>{JSON.stringify(block, null, 2)}</pre>
}

function ComicStudioPreview({ html, title }: { readonly html: string; readonly title: string }) {
  // Comic Studio's print-sized pages remain immutable; scale only the sandboxed chat view.
  const documentHtml = useMemo(() => html.replace(/<\/head>/iu,
    '<style data-phoenix-comic-responsive="true">@media screen{'
    + 'html,body{background:#181b24!important}.edition{box-sizing:border-box;width:100%;padding:8px;gap:16px}'
    + '.comic-cover-page{width:min(100%,1200px)!important;height:auto!important;aspect-ratio:2/3}'
    + '.comic-page{padding:0!important;width:min(100%,1200px)!important;height:auto!important;aspect-ratio:2/3}'
    + '.comic-page .panel-stage{position:absolute;left:2.67%;right:2.67%;top:1.78%;bottom:2.67%;width:auto;height:auto}'
    + '.comic-page{box-sizing:border-box;width:min(100%,1200px);height:auto;aspect-ratio:2/3;'
    + 'padding:clamp(8px,2.67vw,32px) clamp(8px,2.67vw,32px) clamp(18px,4vw,48px);'
    + 'gap:clamp(4px,1vw,13px)}.strip{gap:clamp(4px,1vw,13px)}'
    + '.panel{border-width:clamp(2px,.5vw,6px)}.dialogues{inset:clamp(4px,1vw,13px);'
    + 'gap:clamp(2px,.6vw,8px)}.bubble{font-size:clamp(8px,1.6vw,19px);'
    + 'padding:clamp(3px,.7vw,9px) clamp(4px,1vw,14px);border-width:1px}'
    + '.bubble b{font-size:clamp(7px,1.1vw,13px)}.page-number{font-size:10px}'
    + '}</style></head>'), [html])
  return (
    <section data-phoenix-comic-studio="true" aria-label={'Comic Studio: ' + title}>
      <p className={styles.note}>Comic Studio · Páginas ilustradas · Vista editorial sin navegador</p>
      <MiniApp html={documentHtml} title={title} executable={false} minimumHeight={440} />
    </section>
  )
}

function GameIcon({ kind }: { readonly kind: 'add' | 'library' | 'window' }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'add' && <><path d="M4 5h6v15H4zM14 5h6v15h-6zM10 9h4M10 15h4" /><path d="M7 2v6M4 5h6" /></>}
      {kind === 'library' && <><path d="M3 7h18v13H3z" /><path d="M3 7V4h7l2 3" /></>}
      {kind === 'window' && <><path d="M12 5H5v14h14v-7" /><path d="M13 4h7v7M20 4l-9 9" /></>}
    </svg>
  )
}

/** Godot exports remain multi-file; only scoped, capability-bearing local URLs may load. */
export function godotWebPreviewUrl(value: unknown): string | undefined {
  if (!isRecord(value) || value.engine !== 'godot' || value.structureChecked !== true
    || typeof value.url !== 'string') return undefined
  return /^\/phoenix-games\/godot\/[0-9a-f]{48}\/index\.html$/u.test(value.url) ? value.url : undefined
}

function GodotWebGamePreview({ payload, title }: { readonly payload: HardnessArtifactValue; readonly title: string }) {
  const value = typeof payload === 'string' ? parseJsonArtifact(payload) : payload
  const url = godotWebPreviewUrl(value)
  if (url === undefined) return <p className={styles.gameError} role="alert">El paquete Godot no tiene una dirección válida en Phoenix.</p>
  return (
    <section className={styles.gameStudio} data-phoenix-game-studio="godot" data-game-engine="godot">
      <header className={styles.gameHeader}>
        <h2 className={styles.gameTitle}>{title}</h2>
        <span className={styles.note}>Godot Web · Motor nativo</span>
      </header>
      <div className={styles.gameViewport}>
        <iframe
          className={styles.frame}
          title={title}
          src={url}
          sandbox="allow-scripts allow-pointer-lock"
          allow="autoplay; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
          style={{ width: '100%', minHeight: 480, height: 'min(70vh, 720px)', border: 0 }}
        />
      </div>
      <p className={styles.note}>
        Proyecto Godot original: el paquete se ha comprobado, pero la experiencia de juego,
        los gráficos y el sonido requieren pruebas reales.
      </p>
    </section>
  )
}

function GameStudioPreview({ html, title }: { readonly html: string; readonly title: string }) {
  const audit = useMemo(() => auditGameHtml(html), [html])
  const manifest = useMemo(() => readGameManifest(html), [html])
  const gameTitle = isRecord(manifest) ? text(manifest.title) ?? title : title
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [games, setGames] = useState<LibraryGame[]>([])
  const [saved, setSaved] = useState(false)
  const [libraryError, setLibraryError] = useState<string | undefined>()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    setSaved(false)
    setLibraryError(undefined)
  }, [html, gameTitle])

  useEffect(() => {
    if (!libraryOpen) return
    const dialog = dialogRef.current
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
  }, [libraryOpen])

  const refreshLibrary = async (): Promise<void> => {
    try {
      setGames(await listLibraryGames())
      setLibraryError(undefined)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'No se pudo leer la biblioteca.')
    }
  }
  const addToLibrary = async (): Promise<void> => {
    try {
      await saveLibraryGame(gameTitle, html)
      setSaved(true)
      setLibraryError(undefined)
      if (libraryOpen) await refreshLibrary()
    } catch (error) {
      setSaved(false)
      setLibraryError(error instanceof Error ? error.message : 'No se pudo guardar el juego.')
    }
  }
  const openLibrary = (): void => {
    setLibraryOpen(true)
    void refreshLibrary()
  }
  const closeLibrary = (): void => {
    setLibraryOpen(false)
    const dialog = dialogRef.current
    if (dialog?.open && typeof dialog.close === 'function') dialog.close()
  }
  const removeFromLibrary = async (id: string): Promise<void> => {
    try {
      await removeLibraryGame(id)
      if (id === libraryGameId(gameTitle)) setSaved(false)
      await refreshLibrary()
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'No se pudo eliminar el juego.')
    }
  }
  const playInWindow = (name: string, documentHtml: string): void => {
    openGameInWindow(name, sandboxDocument(documentHtml, true, true))
  }

  return (
    <section className={styles.gameStudio} data-phoenix-game-studio="true"
      data-game-preflight={audit.valid ? 'pass' : 'needs-repair'}>
      <header className={styles.gameHeader}>
        <h2 className={styles.gameTitle}>{gameTitle}</h2>
        <div className={styles.gameActions}>
          <button className={`${styles.gameAction} ${styles.gamePrimary}`} type="button"
            onClick={() => { void addToLibrary() }}>
            <GameIcon kind="add" />{saved ? 'Guardado en biblioteca' : 'Agregar a biblioteca'}
          </button>
          <button className={styles.gameAction} type="button" onClick={openLibrary}>
            <GameIcon kind="library" />Abrir biblioteca
          </button>
          <button className={styles.gameAction} type="button" onClick={() => { playInWindow(gameTitle, html) }}>
            <GameIcon kind="window" />Abrir en otra ventana
          </button>
        </div>
      </header>
      {libraryError !== undefined && <p className={styles.gameError} role="alert">{libraryError}</p>}
      <div className={styles.gameViewport}>
        <MiniApp html={html} title={gameTitle} executable minimumHeight={460} gameDiagnostics />
      </div>
      {libraryOpen && (
        <dialog ref={dialogRef} className={styles.gameLibraryDialog} aria-label="Biblioteca de juegos"
          onCancel={(event) => { event.preventDefault(); closeLibrary() }}
          onClose={() => { setLibraryOpen(false) }}>
          <div className={styles.gameLibraryHeading}>
            <h3>Biblioteca de juegos</h3>
            <button className={styles.gameLibraryClose} type="button" onClick={closeLibrary}
              aria-label="Cerrar biblioteca">Cerrar</button>
          </div>
          {libraryError !== undefined && <p className={styles.gameError} role="alert">{libraryError}</p>}
          {games.length === 0 && libraryError === undefined && (
            <p className={styles.gameLibraryEmpty}>Todavía no hay juegos guardados en este navegador.</p>
          )}
          <ul className={styles.gameLibraryList}>
            {games.map(game => (
              <li className={styles.gameLibraryRow} key={game.id}>
                <strong title={game.title}>{game.title}</strong>
                <div className={styles.gameLibraryRowActions}>
                  <button type="button" onClick={() => { playInWindow(game.title, game.html) }}>Jugar</button>
                  <button type="button" onClick={() => { void removeFromLibrary(game.id) }}
                    aria-label={`Eliminar ${game.title} de la biblioteca`}>Eliminar</button>
                </div>
              </li>
            ))}
          </ul>
        </dialog>
      )}
    </section>
  )
}

/** Resolve image attachment references without making the model reproduce binary bytes. */
function BundledWebsitePreview({ entry, files, title, executable, loadImage }: {
  readonly entry: string
  readonly files: Readonly<Record<string, unknown>>
  readonly title: string
  readonly executable: boolean
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
}) {
  const [resolved, setResolved] = useState<Readonly<Record<string, unknown>>>(files)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setResolved(files)
    setError(undefined)
    const attachments = Object.entries(files).flatMap(([path, value]) => {
      const attachment = imageAttachment(isRecord(value) ? value.attachment ?? value : undefined)
      return attachment === undefined ? [] : [{ path, attachment }]
    })
    if (attachments.length === 0) return
    if (loadImage === undefined) {
      setError('Las imágenes adjuntas requieren el servicio de imágenes autorizado de PHOENIX.')
      return
    }
    let cancelled = false
    const embed = async (): Promise<void> => {
      const next: Record<string, unknown> = { ...files }
      const failures: string[] = []
      await Promise.all(attachments.map(async ({ path, attachment }) => {
        try {
          const source = await loadImage(attachment)
          let dataUri: string
          if (/^data:image\/(?:png|jpeg|webp|gif);base64,/iu.test(source)) {
            dataUri = source
          } else if (source.startsWith('blob:')) {
            const response = await fetch(source)
            if (!response.ok) throw new Error('Image bytes unavailable')
            const blob = await response.blob()
            if (blob.size > 8 * 1024 * 1024) throw new Error('Image exceeds preview limit')
            dataUri = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => {
                if (typeof reader.result === 'string') resolve(reader.result)
                else reject(new Error('Invalid image data'))
              }
              reader.onerror = () => { reject(new Error('Unable to read image')) }
              reader.readAsDataURL(blob)
            })
          } else {
            throw new Error('Unsupported image source')
          }
          if (!dataUri.startsWith('data:' + attachment.mediaType + ';base64,')) throw new Error('MIME mismatch')
          next[path] = { mime: attachment.mediaType, base64: dataUri }
        } catch {
          failures.push(path)
        }
      }))
      if (!cancelled) {
        setResolved(next)
        if (failures.length > 0) setError('No se pudieron cargar imágenes: ' + failures.join(', '))
      }
    }
    void embed()
    return () => { cancelled = true }
  }, [files, loadImage])
  const html = useMemo(() => inlineBundledImages(entry, files[entry] as string, resolved), [entry, files, resolved])
  return <div className={styles.stack}>
    {error !== undefined && <p className={styles.note} role="alert">{error}</p>}
    <MiniApp html={html} title={title} executable={executable} />
  </div>
}

function RecordPreview({ record, mime, expanded, title, executable = true, renderMessageImages, loadImage }: {
  readonly record: JsonRecord
  readonly mime: string
  readonly expanded: boolean
  readonly title: string
  readonly executable?: boolean
  readonly renderMessageImages?: RenderMessageImages
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
}) {
  const attachment = imageAttachment(record.attachment)
  if (attachment !== undefined) {
    return <ImageAttachmentPreview
      attachment={attachment}
      {...renderMessageImages === undefined ? {} : { renderMessageImages }}
    />
  }
  if (mime === 'application/vnd.phoenix.web-preview+json' || mime === 'application/vnd.hardness.web-preview+json') {
    const url = safeWebPreviewUrl(record.url)
    if (url !== undefined) return <WebPagePreview url={url} title={text(record.title) ?? title} />
    return <p className={styles.note}>Page preview URL was rejected.</p>
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
  if (mime === 'application/vnd.phoenix.scene3d+json') return <Scene3DView spec={record} expanded={expanded} />
  if (mime === 'application/vnd.phoenix.scene-map+json' || record.component === 'scene_map') {
    const map = parseSceneMapSpec(record)
    return map === null
      ? <p className={styles.note} role="alert">El mapa narrativo no se pudo renderizar: datos inválidos.</p>
      : <SceneMap spec={map} />
  }
  if (mime === 'application/vnd.phoenix.diagram+json' || record.component === 'diagram') {
    const diagram = parseDiagramSpec(record)
    return diagram === null
      ? <p className={styles.note} role="alert">El diagrama no se pudo mostrar: estructura inválida.</p>
      : <DiagramSurface spec={diagram} />
  }
  if (mime === 'application/vnd.phoenix.geo+json' || record.component === 'geo_map') {
    const geo = parseGeoMapSpec(record)
    return geo === null
      ? <p className={styles.note} role="alert">El mapa geográfico no tiene un contrato válido.</p>
      : <GeoMap spec={geo} />
  }
  if (mime === 'application/vnd.hardness.ui+json' || isRecord(record.root)) return <DeclarativeUi record={record} />
  const visual = embeddedVisual(record)
  if (mime === 'application/vnd.phoenix.visual+json'
    || mime === 'application/vnd.hardness.visual+json'
    || mime === 'application/vnd.hardness.chart+json'
    || visual !== undefined) return <PhoenixVisualizer spec={visual ?? record} />
  if (typeof record.entry === 'string' && isRecord(record.files)) {
    const html = typeof record.files[record.entry] === 'string' ? record.files[record.entry] as string : undefined
    if (html !== undefined) return <BundledWebsitePreview entry={record.entry} files={record.files}
      title={title} executable={executable} {...loadImage === undefined ? {} : { loadImage }} />
  }
  return <pre className={styles.code}>{JSON.stringify(record, null, 2)}</pre>
}

export function HardnessArtifactBody({
  mime, data, expanded, title, executable = true, renderMessageImages, loadImage,
}: ArtifactBodyProps) {
  if (mime === 'application/vnd.phoenix.game+godot-web') return <GodotWebGamePreview payload={data} title={title} />
  if (mime === 'application/vnd.phoenix.comic+html') return typeof data === 'string'
    ? <ComicStudioPreview html={data} title={title} />
    : <p className={styles.gameError} role="alert">Comic Studio: artefacto inválido.</p>
  if (typeof data === 'string') {
    if (mime === 'application/vnd.phoenix.web-preview+json' || mime === 'application/vnd.hardness.web-preview+json') {
      const url = safeWebPreviewUrl(data)
      return url === undefined ? <p className={styles.note}>Page preview URL was rejected.</p> : <WebPagePreview url={url} title={title} />
    }
    if (mime === 'text/html'
      || mime === 'application/vnd.phoenix.game+html'
      || mime === 'application/vnd.hardness.app+html'
      || mime === 'application/vnd.phoenix.canvas+html') {
      const pageUrl = safeWebPreviewUrl(data)
      if (mime === 'application/vnd.phoenix.game+html') return <GameStudioPreview html={data} title={title} />
      if (pageUrl !== undefined && !data.includes('<')) return <WebPagePreview url={pageUrl} title={title} />
      return <MiniApp html={data} title={title} executable={executable} />
    }
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
          executable={executable}
          {...renderMessageImages === undefined ? {} : { renderMessageImages }}
          {...loadImage === undefined ? {} : { loadImage }}
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
    executable={executable}
    {...renderMessageImages === undefined ? {} : { renderMessageImages }}
    {...loadImage === undefined ? {} : { loadImage }}
  />
}
