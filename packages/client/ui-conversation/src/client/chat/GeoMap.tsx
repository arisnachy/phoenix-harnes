import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import css from './GeoMap.module.css'
import { Geo3DView } from './Geo3DView.tsx'
import { generateGeoPdf } from './GeoMapPdf.ts'
import { fitGeoView, buildGeoLegend } from './GeoMapLayout.ts'

type Position = readonly [number, number] // [longitude, latitude], GeoJSON order
type Kind = 'points' | 'line' | 'polygon' | 'heat'
export interface GeoFeature {
  readonly id: string
  readonly label: string
  readonly coordinates: readonly Position[]
  readonly color?: string
  readonly value?: number
  readonly detail?: string
}
export interface GeoLayer {
  readonly id: string
  readonly name: string
  readonly kind: Kind
  readonly features: readonly GeoFeature[]
}
export interface GeoMapSpec {
  readonly component: 'geo_map'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly conversationId?: string
    readonly title: string
    readonly subtitle?: string
    readonly source: string
    readonly updatedAt?: string
    readonly metric?: string
    readonly theme?: 'business' | 'health' | 'research' | 'logistics' | 'neutral'
    readonly center: { readonly lng: number; readonly lat: number }
    readonly zoom?: number
    readonly layers: readonly GeoLayer[]
  }
}

const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const allowed = (x: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(x).every(key => keys.includes(key))
const short = (x: unknown, max = 160): x is string =>
  typeof x === 'string' && x.trim().length > 0 && x.length <= max
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const coordinate = (x: unknown): x is Position =>
  Array.isArray(x) && x.length === 2 && finite(x[0]) && finite(x[1])
  && x[0] >= -180 && x[0] <= 180 && x[1] >= -85 && x[1] <= 85
const color = (x: unknown): x is string | undefined =>
  x === undefined || (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x))
const featureValid = (x: unknown, kind: Kind): x is GeoFeature => {
  if (!record(x) || !allowed(x, ['id', 'label', 'coordinates', 'color', 'value', 'detail'])) return false
  if (!short(x.id, 100) || !short(x.label, 160) || !color(x.color)
    || (x.value !== undefined && !finite(x.value))
    || (x.detail !== undefined && !short(x.detail, 400))
    || !Array.isArray(x.coordinates)) return false
  const len = x.coordinates.length
  const min = kind === 'points' || kind === 'heat' ? 1 : kind === 'polygon' ? 3 : 2
  return len >= min && len <= 400 && x.coordinates.every(coordinate)
}
export function parseGeoMapSpec(x: unknown): GeoMapSpec | null {
  if (!record(x) || !allowed(x, ['component', 'version', 'props']) || x.component !== 'geo_map'
    || x.version !== 1 || !record(x.props)) return null
  const p = x.props
  if (!allowed(p, ['id', 'conversationId', 'title', 'subtitle', 'source', 'updatedAt',
    'metric', 'theme', 'center', 'zoom', 'layers'])
    || !short(p.id, 100) || (p.conversationId !== undefined && !short(p.conversationId, 140)) || !short(p.title, 180)
    || !short(p.source, 400)
    || (p.subtitle !== undefined && !short(p.subtitle, 400))
    || (p.metric !== undefined && !short(p.metric, 120))
    || (p.updatedAt !== undefined && !short(p.updatedAt, 80))
    || (p.theme !== undefined && !['business','health','research','logistics','neutral'].includes(String(p.theme)))
    || !record(p.center) || !allowed(p.center, ['lng', 'lat'])
    || !coordinate([p.center.lng, p.center.lat])
    || (p.zoom !== undefined && (!finite(p.zoom) || p.zoom < 2 || p.zoom > 17))
    || !Array.isArray(p.layers) || p.layers.length === 0 || p.layers.length > 12) return null
  let total = 0
  const ids = new Set<string>()
  for (const layer of p.layers) {
    if (!record(layer) || !allowed(layer, ['id', 'name', 'kind', 'features'])
      || !short(layer.id, 100) || !short(layer.name, 120)
      || !['points','line','polygon','heat'].includes(String(layer.kind))
      || !Array.isArray(layer.features) || layer.features.length > 1500
      || ids.has(layer.id)) return null
    ids.add(layer.id)
    total += layer.features.length
    if (total > 3000 || !layer.features.every(f => featureValid(f, layer.kind as Kind))) return null
    const fids = layer.features.map((f: GeoFeature) => f.id)
    if (new Set(fids).size !== fids.length) return null
  }
  return x as unknown as GeoMapSpec
}

const TILE = 256
const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat))
const wrapLng = (lng: number) => ((lng + 180) % 360 + 360) % 360 - 180
function toWorld(lng: number, lat: number, zoom: number): Position {
  const scale = TILE * 2 ** zoom
  const rad = clampLat(lat) * Math.PI / 180
  return [(lng + 180) / 360 * scale, (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2 * scale]
}
function fromWorld(x: number, y: number, zoom: number): Position {
  const size = TILE * 2 ** zoom
  return [wrapLng(x / size * 360 - 180), clampLat(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI)]
}
function svgEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
const featureColor = (f: GeoFeature, kind: Kind): string =>
  f.color ?? (kind === 'heat' ? '#dc6531' : kind === 'line' ? '#ea6927' : '#d96a28')
const fileName = (title: string, ext: string): string =>
  (title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 54) || 'mapa') + '.' + ext
function save(name: string, data: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function toGeoJson(layers: readonly GeoLayer[]): object {
  return { type: 'FeatureCollection', features: layers.flatMap(layer => layer.features.map(feature => {
    const coords = feature.coordinates
    const geometry = layer.kind === 'points' || layer.kind === 'heat'
      ? { type: 'Point', coordinates: coords[0] }
      : layer.kind === 'line'
        ? { type: 'LineString', coordinates: coords }
        : { type: 'Polygon', coordinates: [[...coords, ...(coords[0]?.[0] === coords[coords.length - 1]?.[0]
          && coords[0]?.[1] === coords[coords.length - 1]?.[1] ? [] : [coords[0]])]] }
    return { type: 'Feature', id: feature.id, properties: {
      label: feature.label, layer: layer.name, color: featureColor(feature, layer.kind),
      ...(feature.value === undefined ? {} : { value: feature.value }),
      ...(feature.detail === undefined ? {} : { detail: feature.detail }),
    }, geometry }
  })) }
}
function csvCell(raw: string): string {
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw
  return '"' + safe.replace(/"/g, '""') + '"'
}
function localKey(spec: GeoMapSpec, conversationId?: string): string | undefined {
  if (!conversationId) return undefined
  return 'phoenix:geo:v1:' + encodeURIComponent(conversationId) + ':' + encodeURIComponent(spec.props.id)
}
type View = { lng: number; lat: number; zoom: number }
function initialView(spec: GeoMapSpec, conversationId?: string): View {
  const fallback = { ...spec.props.center, zoom: spec.props.zoom ?? 11 }
  const key = localKey(spec, conversationId)
  if (!key || typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v: unknown = JSON.parse(raw)
    if (record(v) && coordinate([v.lng, v.lat]) && finite(v.zoom) && v.zoom >= 2 && v.zoom <= 17)
      return { lng: v.lng as number, lat: v.lat as number, zoom: v.zoom as number }
  } catch { /* blocked storage, invalid data: return transcript view */ }
  return fallback
}

export function GeoMap({ spec, onAction, conversationId }: { spec: GeoMapSpec; onAction?: CanvasAction | undefined; conversationId?: string }) {
  const p = spec.props
  const effectiveConversationId = conversationId ?? p.conversationId
  const [view, setView] = useState<View>(() => initialView(spec, effectiveConversationId))
  const [size, setSize] = useState({ w: 780, h: 430 })
  const [visible, setVisible] = useState<readonly string[]>(() => p.layers.map(l => l.id))
  const [show3D, setShow3D] = useState(false)
  const [tileFailures, setTileFailures] = useState<readonly string[]>([])
  const [selected, setSelected] = useState<{ layer: GeoLayer; feature: GeoFeature } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; view: View } | null>(null)
  useEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.max(280, Math.round(entry.contentRect.width)), h: 430 })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const key = localKey(spec, effectiveConversationId)
    if (!key) return
    try { localStorage.setItem(key, JSON.stringify(view)) } catch { /* private browsing */ }
  }, [spec, effectiveConversationId, view])
  const active = useMemo(() => p.layers.filter(l => visible.includes(l.id)), [p.layers, visible])
  const center = toWorld(view.lng, view.lat, view.zoom)
  const project = (pos: Position): Position => {
    const [x, y] = toWorld(pos[0], pos[1], view.zoom)
    const worldWidth = TILE * 2 ** view.zoom
    let dx = x - center[0]
    if (dx > worldWidth / 2) dx -= worldWidth
    if (dx < -worldWidth / 2) dx += worldWidth
    return [dx + size.w / 2, y - center[1] + size.h / 2]
  }
  const tiles = useMemo(() => {
    const n = 2 ** view.zoom
    const minX = Math.floor((center[0] - size.w / 2) / TILE)
    const maxX = Math.ceil((center[0] + size.w / 2) / TILE)
    const minY = Math.max(0, Math.floor((center[1] - size.h / 2) / TILE))
    const maxY = Math.min(n - 1, Math.ceil((center[1] + size.h / 2) / TILE))
    const out: Array<{ key: string; src: string; x: number; y: number }> = []
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const tx = ((x % n) + n) % n
      out.push({ key: x + ':' + y, src: 'https://tile.openstreetmap.org/' + view.zoom + '/' + tx + '/' + y + '.png',
        x: x * TILE - center[0] + size.w / 2, y: y * TILE - center[1] + size.h / 2 })
    }
    return out
  }, [view, size.w, size.h, center[0], center[1]])
  const select = (layer: GeoLayer, feature: GeoFeature): void => {
    setSelected({ layer, feature })
    onAction?.('En el mapa "' + p.title + '" (' + p.source + ') seleccioné "' + feature.label
      + '" de la capa "' + layer.name + '" (coordenadas GeoJSON: '
      + JSON.stringify(feature.coordinates[0]) + (feature.value === undefined ? '' : ', valor: ' + feature.value)
      + '). Utiliza esta selección para la próxima consulta.', 'draft')
  }
  const zoom = (delta: number): void => setView(v => ({ ...v, zoom: Math.max(2, Math.min(17, v.zoom + delta)) }))
  const exportSvg = (): void => {
    const w = 960, h = 590, c = toWorld(view.lng, view.lat, view.zoom)
    const point = (pos: Position): Position => {
      const xy = toWorld(pos[0], pos[1], view.zoom)
      return [xy[0] - c[0] + w / 2, xy[1] - c[1] + 100 + (h - 140) / 2]
    }
    const markup = active.flatMap(layer => layer.features.map(f => {
      const pts = f.coordinates.map(point)
      const stroke = featureColor(f, layer.kind)
      if (layer.kind === 'points' || layer.kind === 'heat') return '<circle cx="' + pts[0]![0]
        + '" cy="' + pts[0]![1] + '" r="' + (layer.kind === 'heat' ? 16 : 7)
        + '" fill="' + stroke + '" fill-opacity=".75"><title>' + svgEscape(f.label) + '</title></circle>'
      return '<polyline points="' + pts.map(pt => pt.join(',')).join(' ') + '" stroke="' + stroke
        + '" stroke-width="3" fill="' + (layer.kind === 'polygon' ? stroke : 'none')
        + '" fill-opacity=".17"><title>' + svgEscape(f.label) + '</title></polyline>'
    })).join('')
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 590" width="960" height="590">'
      + '<rect width="960" height="590" fill="#f7f6f3"/><rect x="18" y="94" width="924" height="448" rx="12" fill="#eef0e9" stroke="#d0d5cb"/>'
      + '<text x="24" y="37" font-family="Arial" font-size="24" font-weight="bold" fill="#302c26">'
      + svgEscape(p.title) + '</text><text x="24" y="66" font-family="Arial" font-size="14" fill="#75695b">'
      + svgEscape(p.metric ?? p.subtitle ?? 'Visualización territorial') + '</text>' + markup
      + '<text x="24" y="571" font-family="Arial" font-size="12" fill="#75695b">Fuente: '
      + svgEscape(p.source) + ' · Solo geometrías vectoriales (sin mapa base)</text></svg>'
    save(fileName(p.title, 'svg'), svg, 'image/svg+xml;charset=utf-8')
  }
  const metricValues = active.flatMap(l => l.features.flatMap(f => f.value === undefined ? [] : [f.value]))
  const total = metricValues.reduce((sum, v) => sum + v, 0)
  const mean = metricValues.length ? total / metricValues.length : null
  const legend = buildGeoLegend(active)
  const number = (value: number): string => value.toLocaleString('es-DO', { maximumFractionDigits: 1 })
  const empty = active.every(layer => layer.features.length === 0)
  const offline = tiles.length > 0 && tileFailures.length >= Math.min(3, tiles.length)
  const themeName = ({ business: 'Comercial', health: 'Salud', research: 'Investigación', logistics: 'Logística', neutral: 'Territorial' } as const)[p.theme ?? 'neutral']
  return (
    <section className={css.root} data-phoenix-geo-map={p.id} data-geo-conversation={effectiveConversationId} data-geo-theme={p.theme ?? 'neutral'}>
      <header className={css.header}>
        <div><span className={css.eyebrow}>PHOENIX GEO INTELLIGENCE</span><h3>{p.title}</h3>
          {p.subtitle && <p>{p.subtitle}</p>}</div>
        <span className={css.theme}>{themeName}</span>
      </header>
      <div className={css.summary} aria-label="Indicadores del mapa">
        <div className={css.summaryItem}><span className={css.summaryLabel}>Ubicaciones y áreas</span>
          <strong className={css.summaryValue}>{number(active.reduce((n,l) => n + l.features.length, 0))}</strong></div>
        <div className={css.summaryItem}><span className={css.summaryLabel}>Capas visibles</span>
          <strong className={css.summaryValue}>{number(active.length)}</strong></div>
        <div className={css.summaryItem}><span className={css.summaryLabel}>{p.metric ? 'Media · ' + p.metric : 'Valores numéricos'}</span>
          <strong className={css.summaryValue}>{mean === null ? '—' : number(mean)}</strong></div>
      </div>
      <div className={css.toolbar} aria-label="Controles cartográficos">
        <div className={css.viewControls} role="group" aria-label="Navegación del mapa">
          <button type="button" onClick={() => zoom(1)} aria-label="Acercar mapa">+</button>
          <button type="button" onClick={() => zoom(-1)} aria-label="Alejar mapa">−</button>
          <button type="button" onClick={() => setView(fitGeoView(active, size))} disabled={empty}>Ver todo</button>
          <button type="button" onClick={() => setView({ ...p.center, zoom: p.zoom ?? 11 })}>Centrar</button>
        </div>
        <div className={css.exportControls} role="group" aria-label="Exportar datos e informes">
        <span className={css.toolbarCaption}>Exportar</span>
        <button type="button" disabled={empty} onClick={() => save(fileName(p.title,'geojson'), JSON.stringify(toGeoJson(active), null, 2), 'application/geo+json')}>GeoJSON</button>
        <button type="button" onClick={() => {
          const lines = [['capa','id','lugar','longitud','latitud','valor','detalle'].map(csvCell).join(',')]
          active.forEach(l => l.features.forEach(f => {
            if (l.kind !== 'points' && l.kind !== 'heat') return
            const coord = f.coordinates[0]
            if (!coord) return
            lines.push([l.name,f.id,f.label,String(coord[0]),String(coord[1]),String(f.value ?? ''),f.detail ?? ''].map(csvCell).join(','))
          }))
          save(fileName(p.title,'csv'), '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8')
        }} disabled={empty}>CSV</button>
        <button type="button" onClick={exportSvg} disabled={empty} title="Geometrías vectoriales para informes, sin mapa base">SVG</button>
        <button type="button" disabled={empty} title="Descargar mapa vectorial PDF con fuente y leyenda" onClick={() => {
          if (active.every(layer => layer.features.length === 0)) return
          const url = URL.createObjectURL(generateGeoPdf(active,p.title,p.source,p.metric))
          const anchor = document.createElement('a')
          anchor.href=url
          anchor.download=fileName(p.title,'pdf')
          anchor.click()
          window.setTimeout(() => URL.revokeObjectURL(url),1000)
        }}>PDF · Informe</button>
        </div>
        <div className={css.modeControls} role="group" aria-label="Modo de visualización">
          <button type="button" onClick={() => setShow3D(v => !v)} aria-pressed={show3D}>{show3D ? 'Volver a 2D' : 'Vista 3D'}</button>
        </div>
      </div>
      {show3D && <Geo3DView layers={active} onSelect={select} />}
      <div className={css.map} ref={frame} style={show3D ? { display: "none" } : undefined} role="region" aria-label={'Mapa interactivo: ' + p.title}
        onPointerDown={e => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
          drag.current = { x: e.clientX, y: e.clientY, view }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={e => {
          if (!drag.current) return
          const first = drag.current
          const origin = toWorld(first.view.lng, first.view.lat, first.view.zoom)
          const loc = fromWorld(origin[0] - (e.clientX - first.x), origin[1] - (e.clientY - first.y), first.view.zoom)
          setView({ ...first.view, lng: loc[0], lat: loc[1] })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}>
        <div className={css.mapHud}><span className={css.mapHudDot} />
          <span className={css.mapHudText}>{p.metric ?? 'Mapa temático'} · {view.zoom.toFixed(0)}×</span></div>
        {tiles.map(tile => <img key={tile.key} className={css.tile} src={tile.src} alt="" draggable={false}
          loading="lazy" style={{ left: tile.x, top: tile.y }}
          onError={() => setTileFailures(old => old.includes(tile.key) ? old : [...old, tile.key].slice(-64))} />)}
        {offline && <div className={css.tileWarning} role="status">Mapa base no disponible. Las ubicaciones y capas vectoriales siguen visibles.</div>}
        <svg className={css.overlay} width={size.w} height={size.h} viewBox={'0 0 ' + size.w + ' ' + size.h} aria-hidden="true">
          {active.flatMap(layer => layer.features.map(f => {
            if (layer.kind === 'points' || layer.kind === 'heat') return null
            const points = f.coordinates.map(project)
            const d = points.map((pt,i) => (i === 0 ? 'M' : 'L') + pt[0] + ' ' + pt[1]).join(' ')
              + (layer.kind === 'polygon' ? ' Z' : '')
            return <path key={layer.id + ':' + f.id} d={d} fill={layer.kind === 'polygon' ? featureColor(f, layer.kind) : 'none'}
              fillOpacity=".24" stroke={featureColor(f, layer.kind)} strokeWidth="3" strokeLinecap="round"
              strokeLinejoin="round" />
          }))}
        </svg>
        {active.flatMap(layer => layer.features.flatMap(f => {
          const pos = f.coordinates[0]
          if (!pos) return []
          const pt = project(pos)
          if (pt[0] < -30 || pt[0] > size.w + 30 || pt[1] < -30 || pt[1] > size.h + 30) return []
          return [<button key={layer.id + ':' + f.id} className={layer.kind === 'heat' ? css.heat : css.marker}
            style={{ left: pt[0], top: pt[1], backgroundColor: featureColor(f,layer.kind) }}
            type="button" title={f.label} aria-label={'Seleccionar ' + f.label}
            aria-pressed={selected?.layer.id === layer.id && selected.feature.id === f.id}
            onClick={() => select(layer,f)} />]
        }))}
        <span className={css.attribution}>© OpenStreetMap contributors</span>
      </div>
      <div className={css.legend} aria-label="Leyenda cartográfica">
        <span className={css.legendTitle}>Leyenda</span>
        {legend.map(entry => <span className={css.legendEntry} key={entry.key} title={entry.label}>
          <span className={css.legendSwatch} style={{ backgroundColor: entry.color }} />
          <span>{entry.label}</span>
        </span>)}
        {legend.length === 0 && <span className={css.legendMore}>Activa una capa para mostrar sus categorías</span>}
      </div>
      <div className={css.bottom}>
        <div className={css.layers} aria-label="Capas del mapa">
          <span className={css.layersTitle}>Capas</span>
          {p.layers.map(l => <label key={l.id}><input type="checkbox" checked={visible.includes(l.id)}
            onChange={e => setVisible(old => e.target.checked ? [...old, l.id] : old.filter(id => id !== l.id))} />
            <span>{l.name}</span><small>{l.features.length}</small></label>)}
        </div>
        {selected && <div className={css.selection}>
          <strong>{selected.feature.label}</strong>
          {selected.feature.value !== undefined && <span>{p.metric ?? 'Valor'}: {selected.feature.value.toLocaleString('es-DO')}</span>}
          {selected.feature.detail && <span>{selected.feature.detail}</span>}
          <small>{selected.layer.name} · {selected.feature.coordinates[0]?.join(', ')}</small>
          {onAction && <button type="button" onClick={() => select(selected.layer,selected.feature)}>Consultar a Kira</button>}
        </div>}
      </div>
      <footer className={css.footer}>
        <span>{active.reduce((n,l) => n + l.features.length, 0).toLocaleString('es-DO')} elementos
          {metricValues.length ? ' · ' + metricValues.length + ' con datos numéricos' : ''} · WGS84</span>
        <span>Fuente: {p.source}{p.updatedAt ? ' · ' + p.updatedAt : ''}</span>
      </footer>
    </section>
  )
}
