import { useId, useRef, useState } from 'react'
import type { CanvasAction } from './GenerativeCanvas.tsx'
import css from './DiagramSurface.module.css'

type DiagramShape = 'square' | 'circle' | 'rectangle' | 'diamond' | 'point'
type DiagramPort = 'top' | 'bottom' | 'left' | 'right' | 'center'
type DiagramLine = 'solid' | 'dashed' | 'arrow'
type DiagramKind = 'genogram' | 'flowchart' | 'mindmap' | 'network' | 'other'

/** One addressable, accessible object in a diagram. Coordinates are SVG units. */
export interface DiagramNode {
  readonly id: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly shape?: DiagramShape
  readonly detail?: string
}

/** Connector with optional waypoints for junctions, families, and orthogonal routes. */
export interface DiagramEdge {
  readonly from: string
  readonly to: string
  readonly fromPort?: DiagramPort
  readonly toPort?: DiagramPort
  readonly via?: readonly { readonly x: number; readonly y: number }[]
  readonly kind?: DiagramLine
  readonly label?: string
}

/** General-purpose, script-free diagram accepted in conversation or an artifact. */
export interface DiagramSpec {
  readonly component: 'diagram'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly subtitle?: string
    readonly kind?: DiagramKind
    readonly nodes: readonly DiagramNode[]
    readonly edges?: readonly DiagramEdge[]
    readonly note?: string
  }
}

const shapes: readonly DiagramShape[] = ['square', 'circle', 'rectangle', 'diamond', 'point']
const ports: readonly DiagramPort[] = ['top', 'bottom', 'left', 'right', 'center']
const lines: readonly DiagramLine[] = ['solid', 'dashed', 'arrow']
const kinds: readonly DiagramKind[] = ['genogram', 'flowchart', 'mindmap', 'network', 'other']
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const only = (v: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(v).every(key => allowed.includes(key))
const short = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
const coord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000

/**
 * Validate untrusted model-authored diagram JSON before handing it to the React renderer.
 * @param value - Candidate UI block or artifact data.
 * @returns A safe declarative diagram, or null when any object is inconsistent.
 */
export function parseDiagramSpec(value: unknown): DiagramSpec | null {
  if (!isRecord(value) || !only(value, ['component', 'version', 'props'])
    || value.component !== 'diagram' || value.version !== 1 || !isRecord(value.props)) return null
  const p = value.props
  if (!only(p, ['id', 'title', 'subtitle', 'kind', 'nodes', 'edges', 'note'])
    || !short(p.id, 80) || !short(p.title, 140)
    || (p.subtitle !== undefined && !short(p.subtitle, 250))
    || (p.note !== undefined && !short(p.note, 800))
    || (p.kind !== undefined && !kinds.includes(p.kind as DiagramKind))
    || !Array.isArray(p.nodes) || p.nodes.length < 2 || p.nodes.length > 70) return null

  const ids = new Set<string>()
  for (const node of p.nodes) {
    if (!isRecord(node) || !only(node, ['id', 'label', 'x', 'y', 'shape', 'detail'])
      || !short(node.id, 80) || ids.has(node.id)
      || !short(node.label, 100) || !coord(node.x) || !coord(node.y)
      || (node.shape !== undefined && !shapes.includes(node.shape as DiagramShape))
      || (node.detail !== undefined && !short(node.detail, 650))) return null
    ids.add(node.id)
  }
  if (p.edges !== undefined && (!Array.isArray(p.edges) || p.edges.length > 140)) return null
  if (Array.isArray(p.edges)) {
    for (const edge of p.edges) {
      if (!isRecord(edge) || !only(edge, ['from', 'to', 'fromPort', 'toPort', 'via', 'kind', 'label'])
        || !short(edge.from, 80) || !short(edge.to, 80)
        || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to
        || (edge.fromPort !== undefined && !ports.includes(edge.fromPort as DiagramPort))
        || (edge.toPort !== undefined && !ports.includes(edge.toPort as DiagramPort))
        || (edge.kind !== undefined && !lines.includes(edge.kind as DiagramLine))
        || (edge.label !== undefined && !short(edge.label, 120))
        || (edge.via !== undefined && (!Array.isArray(edge.via) || edge.via.length > 12
          || !edge.via.every(point => isRecord(point) && only(point, ['x', 'y'])
            && coord(point.x) && coord(point.y))))) return null
    }
  }
  return value as unknown as DiagramSpec
}

function anchor(node: DiagramNode, port: DiagramPort): { x: number; y: number } {
  const radiusX = node.shape === 'rectangle' ? 80 : node.shape === 'diamond' ? 58
    : node.shape === 'point' ? 0 : 45
  const radiusY = node.shape === 'rectangle' ? 36 : node.shape === 'diamond' ? 58
    : node.shape === 'point' ? 0 : 45
  switch (port) {
    case 'top': return { x: node.x, y: node.y - radiusY }
    case 'bottom': return { x: node.x, y: node.y + radiusY }
    case 'left': return { x: node.x - radiusX, y: node.y }
    case 'right': return { x: node.x + radiusX, y: node.y }
    case 'center': return { x: node.x, y: node.y }
  }
}

function downloadSvg(svg: SVGSVGElement | null, title: string): void {
  if (svg === null) return
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', '1200')
  clone.setAttribute('height', '744')
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = (title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').slice(0, 70) || 'diagrama') + '.svg'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Draw any validated graph natively, without an iframe, remote CDN or executable model code.
 * @param spec - The validated diagram JSON.
 * @param onAction - Composer draft callback triggered only by a user click.
 * @returns A scalable SVG, semantic details and export action.
 */
export function DiagramSurface({ spec, onAction }: {
  readonly spec: DiagramSpec
  readonly onAction?: CanvasAction | undefined
}) {
  const p = spec.props
  const [selected, setSelected] = useState(p.nodes.find(n => n.shape !== 'point')?.id ?? p.nodes[0]!.id)
  const svgRef = useRef<SVGSVGElement>(null)
  const arrowId = useId().replaceAll(':', '-') + '-arrow'
  const byId = new Map(p.nodes.map(node => [node.id, node]))
  const active = byId.get(selected) ?? p.nodes[0]!
  const choose = (id: string): void => setSelected(id)

  return <section className={css.root} data-phoenix-diagram={p.id} data-diagram-kind={p.kind ?? 'other'}>
    <header className={css.header}>
      <div><span className={css.eyebrow}>DIAGRAMA INTERACTIVO</span>
        <h3>{p.title}</h3>{p.subtitle && <p>{p.subtitle}</p>}</div>
      <button type="button" className={css.export} onClick={() => downloadSvg(svgRef.current, p.title)}>Exportar SVG</button>
    </header>
    <div className={css.layout}>
      <div className={css.canvas}>
        <svg ref={svgRef} viewBox="0 0 1000 620" role="img" aria-label={'Diagrama: ' + p.title}
          xmlns="http://www.w3.org/2000/svg" className={css.svg}>
          <defs><marker id={arrowId} markerWidth="10" markerHeight="10" refX="8" refY="3"
            orient="auto" markerUnits="strokeWidth"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#64748b" strokeWidth="1.6"/></marker></defs>
          <rect x="0" y="0" width="1000" height="620" rx="22" fill="#fffdfa"/>
          {(p.edges ?? []).map((edge, index) => {
            const from = byId.get(edge.from)!
            const to = byId.get(edge.to)!
            const positions = [anchor(from, edge.fromPort ?? 'center'), ...(edge.via ?? []), anchor(to, edge.toPort ?? 'center')]
            const points = positions.map(point => point.x + ',' + point.y).join(' ')
            return <g key={edge.from + ':' + edge.to + ':' + index}>
              <polyline points={points} fill="none" stroke="#64748b" strokeWidth="3.2"
                strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={edge.kind === 'dashed' ? '8 7' : undefined}
                markerEnd={edge.kind === 'arrow' ? 'url(#' + arrowId + ')' : undefined}/>
              {edge.label && <title>{edge.label}</title>}
            </g>
          })}
          {p.nodes.map(node => {
            if (node.shape === 'point') return null
            const shape = node.shape ?? 'rectangle'
            const focused = selected === node.id
            return <g key={node.id} className={css.node} role="button" tabIndex={0}
              aria-label={'Ver ' + node.label} aria-pressed={focused}
              onClick={() => choose(node.id)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node.id) } }}>
              <title>{node.label + (node.detail ? ': ' + node.detail : '')}</title>
              {focused && <circle cx={node.x} cy={node.y} r={shape === 'rectangle' ? 96 : 64}
                fill="none" stroke="#e97839" strokeDasharray="7 7" strokeWidth="2.8"/>}
              {shape === 'circle' && <circle cx={node.x} cy={node.y} r="45" fill="#fce7ee" stroke="#c35d83" strokeWidth="3.5"/>}
              {shape === 'square' && <rect x={node.x - 45} y={node.y - 45} width="90" height="90" rx="2"
                fill="#e1efff" stroke="#4479b2" strokeWidth="3.5"/>}
              {shape === 'rectangle' && <rect x={node.x - 80} y={node.y - 36} width="160" height="72" rx="15"
                fill="#e7f1ee" stroke="#56857b" strokeWidth="3"/>}
              {shape === 'diamond' && <path d={'M ' + node.x + ' ' + (node.y - 58)
                + ' L ' + (node.x + 58) + ' ' + node.y + ' L ' + node.x + ' ' + (node.y + 58)
                + ' L ' + (node.x - 58) + ' ' + node.y + ' Z'}
                fill="#fff0d7" stroke="#ca9842" strokeWidth="3"/>}
              {shape === 'rectangle' || shape === 'diamond'
                ? <text x={node.x} y={node.y + 5} textAnchor="middle" fontSize="18" fontWeight="600"
                  fill="#253346">{node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}</text>
                : <text x={node.x} y={node.y + 73} textAnchor="middle" fontSize="19" fontWeight="600"
                  fill="#253346">{node.label.length > 19 ? node.label.slice(0, 18) + '…' : node.label}</text>}
            </g>
          })}
        </svg>
      </div>
      <aside className={css.details}>
        <strong>Elementos</strong>
        <div className={css.list}>
          {p.nodes.filter(node => node.shape !== 'point').map(node =>
            <button type="button" key={node.id} aria-pressed={node.id === selected}
              onClick={() => choose(node.id)}>{node.label}</button>)}
        </div>
        <div aria-live="polite" className={css.selected}>
          <strong>{active.label}</strong>
          <p>{active.detail ?? 'Elemento del diagrama'}</p>
        </div>
        {onAction && <button className={css.ask} type="button" onClick={() =>
          onAction('En el diagrama "' + p.title + '" he seleccionado "' + active.label + '". ' +
            (active.detail ?? '') + ' Continúa a partir de este elemento.', 'draft')}>
          Preguntar a Kira sobre este elemento
        </button>}
      </aside>
    </div>
    {p.note && <p className={css.note}>{p.note}</p>}
  </section>
}
