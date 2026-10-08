import { useState, type ReactNode } from 'react'
import css from './GenerativeCanvas.module.css'

/**
 * A bounded, script-free renderer for UI emitted by an assistant.
 * A button can only hand a user-clicked request to the existing composer;
 * no model-authored JavaScript, URLs, tool identifiers or callbacks execute.
 */
type Status = 'positive' | 'neutral' | 'warning' | 'negative' | 'info'
type Layout = 'column' | 'row' | 'grid'
type CanvasNode =
  | { type: 'group'; layout?: Layout; children: CanvasNode[] }
  | { type: 'text' | 'heading' | 'caption'; text: string }
  | { type: 'divider' }
  | { type: 'badge'; text: string; status?: Status }
  | { type: 'metric'; label: string; value: string; detail?: string; status?: Status }
  | { type: 'progress'; label: string; value: number; max?: number }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'chart'; title?: string; points: Array<{ label: string; value: number }> }
  | { type: 'input'; id: string; label: string; placeholder?: string; value?: string }
  | { type: 'select'; id: string; label: string; options: Array<{ label: string; value: string }>; value?: string }
  | { type: 'toggle'; id: string; label: string; value?: boolean }
  | { type: 'slider'; id: string; label: string; min: number; max: number; step?: number; value?: number }
  | { type: 'button'; label: string; prompt: string; action?: 'draft' | 'submit' | 'filter' }
  | { type: 'tabs'; tabs: Array<{ label: string; children: CanvasNode[] }> }

export interface CanvasSpec {
  readonly component: 'ui_canvas'
  readonly version: 1
  readonly props: {
    readonly title: string
    readonly subtitle?: string
    readonly children: CanvasNode[]
  }
}

export type CanvasAction = (prompt: string, mode: 'draft' | 'submit') => void

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const keys = (x: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(x).every(key => allowed.includes(key))
const text = (x: unknown, max = 240): x is string =>
  typeof x === 'string' && x.trim().length > 0 && x.length <= max
const optionalText = (x: unknown, max = 240): boolean =>
  x === undefined || text(x, max)
const status = (x: unknown): boolean =>
  x === undefined || ['positive', 'neutral', 'warning', 'negative', 'info'].includes(String(x))
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(x)
const labels = (x: unknown, max: number): x is string[] =>
  Array.isArray(x) && x.length > 0 && x.length <= max && x.every(item => text(item))
const MAX_NODES = 64
const MAX_DEPTH = 6

function validateNode(value: unknown, depth: number, count: { n: number }, ids: Set<string>): boolean {
  if (!isObject(value) || !text(value.type, 30) || depth > MAX_DEPTH || ++count.n > MAX_NODES) return false
  switch (value.type) {
    case 'group':
      return keys(value, ['type','layout','children'])
        && (value.layout === undefined || ['column','row','grid'].includes(String(value.layout)))
        && Array.isArray(value.children) && value.children.length <= 24
        && value.children.every(child => validateNode(child, depth + 1, count, ids))
    case 'text':
    case 'heading':
    case 'caption':
      return keys(value, ['type','text']) && text(value.text, 1200)
    case 'divider':
      return keys(value, ['type'])
    case 'badge':
      return keys(value, ['type','text','status']) && text(value.text) && status(value.status)
    case 'metric':
      return keys(value, ['type','label','value','detail','status'])
        && text(value.label) && text(value.value) && optionalText(value.detail) && status(value.status)
    case 'progress':
      return keys(value, ['type','label','value','max']) && text(value.label)
        && finite(value.value) && value.value >= 0
        && (value.max === undefined || (finite(value.max) && value.max > 0))
        && value.value <= (value.max === undefined ? 100 : value.max)
    case 'table':
      return keys(value, ['type','columns','rows']) && labels(value.columns, 8)
        && Array.isArray(value.rows) && value.rows.length > 0 && value.rows.length <= 30
        && value.rows.every(row => Array.isArray(row) && row.length === (value.columns as string[]).length
          && row.every(cell => text(cell, 500)))
    case 'chart':
      return keys(value, ['type','title','points']) && optionalText(value.title)
        && Array.isArray(value.points) && value.points.length > 0 && value.points.length <= 20
        && value.points.every(point => isObject(point) && keys(point, ['label','value'])
          && text(point.label) && finite(point.value) && point.value >= 0 && point.value <= 1e12)
    case 'input':
      if (!keys(value, ['type','id','label','placeholder','value']) || !id(value.id)
        || ids.has(value.id) || !text(value.label) || !optionalText(value.placeholder)
        || (value.value !== undefined && (typeof value.value !== 'string' || value.value.length > 500))) return false
      ids.add(value.id)
      return true
    case 'select':
      if (!keys(value, ['type','id','label','options','value']) || !id(value.id)
        || ids.has(value.id) || !text(value.label) || !Array.isArray(value.options)
        || value.options.length < 1 || value.options.length > 30
        || !value.options.every(o => text(o) || (isObject(o) && keys(o,['label','value']) && text(o.label) && text(o.value)))
        || (value.value !== undefined && !value.options.some(o => typeof o === 'string' ? o === value.value : o.value === value.value))) return false
      ids.add(value.id)
      return true
    case 'toggle':
      if (!keys(value, ['type','id','label','value']) || !id(value.id)
        || ids.has(value.id) || !text(value.label)
        || (value.value !== undefined && typeof value.value !== 'boolean')) return false
      ids.add(value.id)
      return true
    case 'slider':
      if (!keys(value, ['type','id','label','min','max','step','value']) || !id(value.id)
        || ids.has(value.id) || !text(value.label) || !finite(value.min) || !finite(value.max)
        || value.max <= value.min || value.max - value.min > 1e9
        || (value.step !== undefined && (!finite(value.step) || value.step <= 0))
        || (value.value !== undefined && (!finite(value.value) || value.value < value.min || value.value > value.max))) return false
      ids.add(value.id)
      return true
    case 'button':
      return keys(value, ['type','label','prompt','action']) && text(value.label)
        && text(value.prompt, 1600)
        && (value.action === undefined || value.action === 'draft' || value.action === 'submit' || value.action === 'filter')
    case 'tabs':
      return keys(value, ['type','tabs']) && Array.isArray(value.tabs)
        && value.tabs.length >= 2 && value.tabs.length <= 6
        && value.tabs.every(tab => isObject(tab) && keys(tab, ['label','children'])
          && text(tab.label) && Array.isArray(tab.children) && tab.children.length <= 16
          && tab.children.every(child => validateNode(child, depth + 1, count, ids)))
    default: return false
  }
}

/** Strict allowlist, depth/size bounds, unique control ids and no code execution. */
export function parseCanvasSpec(value: unknown): CanvasSpec | null {
  if (!isObject(value) || !keys(value, ['component','version','props'])
    || value.component !== 'ui_canvas' || value.version !== 1 || !isObject(value.props)
    || !keys(value.props, ['title','subtitle','children'])
    || !text(value.props.title) || !optionalText(value.props.subtitle)
    || !Array.isArray(value.props.children) || value.props.children.length === 0
    || value.props.children.length > 24) return null
  const count = { n: 0 }
  const ids = new Set<string>()
  if (!value.props.children.every(child => validateNode(child, 0, count, ids))) return null
  // Providers sometimes emit select options as simple strings. Canonicalize
  // that safe and common shorthand, while keeping every other validation strict.
  const normalize = (node: CanvasNode): CanvasNode => {
    if (node.type === 'group') return { ...node, children: node.children.map(normalize) }
    if (node.type === 'tabs') return { ...node, tabs: node.tabs.map(tab => ({ ...tab, children: tab.children.map(normalize) })) }
    if (node.type === 'select') return {
      ...node,
      options: (node.options as Array<string | { label: string; value: string }>).map(option =>
        typeof option === 'string' ? { label: option, value: option } : option),
    }
    return node
  }
  const valid = value as unknown as CanvasSpec
  return { ...valid, props: { ...valid.props, children: valid.props.children.map(normalize) } }
}

type Values = Record<string, string | number | boolean>
function initialValues(nodes: CanvasNode[]): Values {
  const values: Values = {}
  const walk = (node: CanvasNode): void => {
    if (node.type === 'group') node.children.forEach(walk)
    else if (node.type === 'tabs') node.tabs.forEach(tab => tab.children.forEach(walk))
    else if (node.type === 'input') values[node.id] = node.value ?? ''
    else if (node.type === 'select') values[node.id] = node.value ?? node.options[0]?.value ?? ''
    else if (node.type === 'toggle') values[node.id] = node.value ?? false
    else if (node.type === 'slider') values[node.id] = node.value ?? node.min
  }
  nodes.forEach(walk)
  return values
}

interface RendererProps {
  node: CanvasNode
  values: Values
  setValue: (id: string, value: string | number | boolean) => void
  onAction?: CanvasAction | undefined
}

function expandPrompt(prompt: string, values: Values): string {
  return prompt.replace(/\{([a-z][a-z0-9_-]{0,39})\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match)
}

function Tabs({ tabs, values, setValue, onAction }: {
  tabs: Extract<CanvasNode,{type:'tabs'}>['tabs']
  values: Values
  setValue: RendererProps['setValue']
  onAction?: CanvasAction | undefined
}): ReactNode {
  const [active, setActive] = useState(0)
  return (
    <div className={css.tabs}>
      <div className={css.tabStrip} role="tablist">
        {tabs.map((tab, i) => (
          <button key={i} type="button" role="tab" aria-selected={active === i}
            className={active === i ? css.selected : ''} onClick={() => setActive(i)}>{tab.label}</button>
        ))}
      </div>
      <div role="tabpanel" className={css.column}>
        {tabs[active]?.children.map((node, i) => <Node key={i} node={node} values={values} setValue={setValue} onAction={onAction} />)}
      </div>
    </div>
  )
}

function Node({ node, values, setValue, onAction }: RendererProps): ReactNode {
  switch (node.type) {
    case 'group':
      return <div className={node.layout === 'grid' ? css.grid : node.layout === 'row' ? css.row : css.column}>
        {node.children.map((child, i) => <Node key={i} node={child} values={values} setValue={setValue} onAction={onAction} />)}
      </div>
    case 'heading': return <h4 className={css.heading}>{node.text}</h4>
    case 'text': return <p className={css.text}>{node.text}</p>
    case 'caption': return <p className={css.caption}>{node.text}</p>
    case 'divider': return <hr className={css.divider} />
    case 'badge': return <span className={css.badge} data-status={node.status}>{node.text}</span>
    case 'metric': return <div className={css.metric} data-status={node.status}>
      <span>{node.label}</span><strong>{node.value}</strong>{node.detail && <small>{node.detail}</small>}
    </div>
    case 'progress': {
      const max = node.max ?? 100
      return <div className={css.progress}><div><span>{node.label}</span><strong>{Math.round(node.value / max * 100)}%</strong></div>
        <progress aria-label={node.label} max={max} value={node.value} /></div>
    }
    case 'table':
      return <div className={css.tableScroll}><table>
        <thead><tr>{node.columns.map((c,i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
        <tbody>{node.rows.map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table></div>
    case 'chart': {
      const max = Math.max(1,...node.points.map(p => p.value))
      return <div className={css.chart} role="img" aria-label={node.title ?? 'Gráfico de barras'}>
        {node.title && <strong>{node.title}</strong>}
        {node.points.map((point,i) => <div key={i} className={css.barRow}>
          <span>{point.label}</span><div className={css.barTrack}><div style={{ width: `${point.value / max * 100}%` }}/></div>
          <strong>{new Intl.NumberFormat().format(point.value)}</strong>
        </div>)}
      </div>
    }
    case 'input':
      return <label className={css.field}>{node.label}<input type="text" maxLength={500}
        placeholder={node.placeholder} value={String(values[node.id] ?? '')}
        onChange={event => setValue(node.id,event.target.value)} /></label>
    case 'select':
      return <label className={css.field}>{node.label}<select value={String(values[node.id] ?? '')}
        onChange={event => setValue(node.id,event.target.value)}>{node.options.map(o =>
        <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    case 'toggle':
      return <label className={css.toggle}><input type="checkbox" checked={Boolean(values[node.id])}
        onChange={event => setValue(node.id,event.target.checked)} />{node.label}</label>
    case 'slider':
      return <label className={css.field}>{node.label}: {String(values[node.id] ?? node.min)}
        <input type="range" min={node.min} max={node.max} step={node.step ?? 1}
          value={Number(values[node.id] ?? node.min)}
          onChange={event => setValue(node.id,Number(event.target.value))} /></label>
    case 'button':
      return <button type="button" className={css.action}
        disabled={onAction === undefined}
        title={onAction === undefined ? 'Acción no disponible en esta conversación' : undefined}
        onClick={() => onAction?.(expandPrompt(node.prompt, values), node.action ?? 'draft')}>{node.label}</button>
    case 'tabs': return <Tabs tabs={node.tabs} values={values} setValue={setValue} onAction={onAction} />
  }
}

/** Self-contained local state: no model roundtrip for sliders, tabs or filters. */
export function GenerativeCanvas({ spec, onAction }: { spec: CanvasSpec; onAction?: CanvasAction | undefined }): ReactNode {
  const [values, setValues] = useState<Values>(() => initialValues(spec.props.children))
  const setValue = (key: string, value: string | number | boolean): void =>
    setValues(current => ({ ...current, [key]: value }))
  return <section className={css.canvas} data-generative-ui="ui_canvas">
    <header><h3>{spec.props.title}</h3>{spec.props.subtitle && <p>{spec.props.subtitle}</p>}</header>
    <div className={css.column}>
      {spec.props.children.map((node,i) => <Node key={i} node={node} values={values} setValue={setValue} onAction={onAction} />)}
    </div>
  </section>
}
