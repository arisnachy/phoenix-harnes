/**
 * Phoenix's bounded interoperability bridge for assistant-ui trees and the
 * json-render flat element schema. This is deliberately NOT a second chat
 * runtime: the existing Phoenix canvas owns React, state and approvals.
 *
 * Format compatibility is independent of installing vendor React renderers.
 * All executable vendor actions, dynamic state expressions, URLs and unknown
 * components are rejected, not interpreted.
 */
import { parseCanvasSpec, type CanvasSpec } from './GenerativeCanvas.tsx'

type ObjectValue = Record<string, unknown>
type Node = CanvasSpec['props']['children'][number]

export const PHOENIX_INTELLIGENT_UI_CAPABILITIES = Object.freeze({
  renderer: 'Phoenix GenerativeCanvas (React 18)',
  formats: ['ui_canvas', 'assistant_ui', 'json_render'] as const,
  ecosystems: {
    'assistant-ui': 'Declarative $type/children trees; supported semantic subset, not its standalone runtime',
    'openai/apps-sdk-ui': 'Accessible chat-native presentation using Phoenix theme tokens; vendor Tailwind UI is not mounted',
    'json-render': 'Safe root/elements/props/children flat trees; no @json-render/react or dynamic bindings',
  },
  components: ['Card','Column','Row','Grid','Form','Heading','Text','Caption','Divider','Badge','Metric','Fact','Progress','Alert','Timeline','Table','Chart','Input','Select','Checkbox','Slider','Button'] as const,
  actions: ['filter locally', 'draft prompt', 'submit prompt after user click'] as const,
  constraints: 'React 18, max 64 nodes/depth 6, static values, no arbitrary code, URL or direct MCP execution',
})

const object = (value: unknown): value is ObjectValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const string = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0
const strOrEmpty = (value: unknown): value is string =>
  typeof value === 'string'
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const only = (o: ObjectValue, names: readonly string[]): boolean =>
  Object.keys(o).every(key => names.includes(key))
const maxNodes = 64
const maxDepth = 6

function convert(type: unknown, props: unknown, children: Node[]): Node | null {
  if (!string(type) || !object(props)) return null
  const is = (names: string[]): boolean => only(props, names)
  switch (type) {
    case 'Card':
    case 'Column':
    case 'Col':
    case 'Stack':
    case 'Form': {
      if (!is(['title', 'subtitle']) || (props.title !== undefined && !strOrEmpty(props.title))
        || (props.subtitle !== undefined && !strOrEmpty(props.subtitle))) return null
      const parts: Node[] = []
      if (string(props.title)) parts.push({ type: 'heading', text: props.title })
      if (string(props.subtitle)) parts.push({ type: 'caption', text: props.subtitle })
      return { type: 'group', layout: 'column', children: [...parts, ...children] }
    }
    case 'Row':
    case 'Grid':
      return is([]) ? { type: 'group', layout: type === 'Row' ? 'row' : 'grid', children } : null
    case 'Heading':
    case 'Text':
    case 'Caption': {
      if (children.length > 0 || !is(['text', 'content', 'variant'])) return null
      const text = props.text ?? props.content
      if (!string(text) || (props.variant !== undefined && !['heading', 'caption', 'text'].includes(String(props.variant)))) return null
      const variant = type === 'Text' ? props.variant : undefined
      const kind = variant === 'heading' || type === 'Heading' ? 'heading'
        : variant === 'caption' || type === 'Caption' ? 'caption' : 'text'
      return { type: kind, text }
    }
    case 'Divider': return children.length === 0 && is([]) ? { type: 'divider' } : null
    case 'Badge':
      return children.length === 0 && is(['text', 'label', 'status']) && string(props.text ?? props.label)
        ? { type: 'badge', text: String(props.text ?? props.label), ...(props.status === undefined ? {} : { status: props.status as 'info' }) }
        : null
    case 'Fact':
    case 'Metric':
      return children.length === 0 && is(['label','value','detail','status'])
        && string(props.label) && (string(props.value) || finite(props.value))
        && (props.detail === undefined || string(props.detail))
        ? { type: 'metric', label: props.label, value: String(props.value),
            ...(props.detail === undefined ? {} : { detail: String(props.detail) }),
            ...(props.status === undefined ? {} : { status: props.status as 'info' }) } : null
    case 'Alert':
      return children.length === 0 && is(['title','message','status'])
        && string(props.message) && (props.title === undefined || string(props.title))
        ? { type: 'alert', message: props.message,
            ...(props.title === undefined ? {} : { title: String(props.title) }),
            ...(props.status === undefined ? {} : { status: props.status as 'info' }) } : null
    case 'Progress':
      return children.length === 0 && is(['label','value','max'])
        && string(props.label) && finite(props.value)
        && (props.max === undefined || finite(props.max))
        ? { type: 'progress', label: props.label, value: props.value,
            ...(props.max === undefined ? {} : { max: props.max as number }) } : null
    case 'Table': {
      if (children.length > 0 || !is(['columns','rows']) || !Array.isArray(props.columns) || !Array.isArray(props.rows)) return null
      if (!props.columns.every(string) || !props.rows.every(row=>Array.isArray(row) && row.every(strOrEmpty))) return null
      return { type: 'table', columns: props.columns, rows: props.rows }
    }
    case 'Chart': {
      if (children.length > 0 || !is(['title','data','points']) || (props.title !== undefined && !string(props.title))) return null
      const points = props.data ?? props.points
      if (!Array.isArray(points) || !points.every(x=>object(x) && only(x,['label','value']) && string(x.label) && finite(x.value))) return null
      return { type: 'chart', ...(props.title === undefined ? {} : { title: props.title as string }), points: points as Array<{label:string;value:number}> }
    }
    case 'Input':
      return children.length === 0 && is(['name','id','label','placeholder','defaultValue','value'])
        && string(props.label) && string(props.id ?? props.name)
        && (props.placeholder === undefined || strOrEmpty(props.placeholder))
        && (props.defaultValue === undefined || strOrEmpty(props.defaultValue))
        && (props.value === undefined || strOrEmpty(props.value))
        ? { type: 'input', id: String(props.id ?? props.name), label: props.label,
            ...(props.placeholder === undefined ? {} : { placeholder: String(props.placeholder) }),
            ...(props.value ?? props.defaultValue === undefined ? {} : { value: String(props.value ?? props.defaultValue) }) } : null
    case 'Select':
      return children.length === 0 && is(['name','id','label','options','defaultValue','value'])
        && string(props.id ?? props.name) && string(props.label) && Array.isArray(props.options)
        && props.options.every(o=>strOrEmpty(o) || (object(o) && only(o,['label','value']) && strOrEmpty(o.label) && strOrEmpty(o.value)))
        ? { type: 'select', id: String(props.id ?? props.name), label: props.label,
            options: props.options as Array<{label:string;value:string}>,
            ...(props.value ?? props.defaultValue === undefined ? {} : { value: String(props.value ?? props.defaultValue) }) } : null
    case 'Checkbox':
      return children.length === 0 && is(['name','id','label','defaultChecked','value'])
        && string(props.id ?? props.name) && string(props.label)
        && (props.value === undefined || typeof props.value === 'boolean')
        && (props.defaultChecked === undefined || typeof props.defaultChecked === 'boolean')
        ? { type: 'toggle', id: String(props.id ?? props.name), label: props.label,
            value: Boolean(props.value ?? props.defaultChecked ?? false) } : null
    case 'Slider':
      return children.length === 0 && is(['name','id','label','min','max','step','defaultValue','value'])
        && string(props.id ?? props.name) && string(props.label)
        && finite(props.min) && finite(props.max)
        && (props.step === undefined || finite(props.step))
        && (props.value === undefined || finite(props.value))
        && (props.defaultValue === undefined || finite(props.defaultValue))
        ? { type: 'slider', id: String(props.id ?? props.name), label: props.label,
            min: props.min, max: props.max,
            ...(props.step === undefined ? {} : { step: props.step as number }),
            value: (props.value ?? props.defaultValue ?? props.min) as number } : null
    case 'Button':
      return children.length === 0 && is(['label','prompt','action']) && string(props.label)
        && string(props.prompt) && (props.action === undefined || ['draft','submit','filter'].includes(String(props.action)))
        ? { type: 'button', label: props.label, prompt: props.prompt,
            ...(props.action === undefined ? {} : { action: props.action as 'draft'|'submit'|'filter' }) } : null
    default: return null
  }
}

/** assistant-ui present-tool JSON subset ($type/children, no $action). */
function assistantTree(node: unknown, level: number, budget: { value: number }): Node | null {
  if (!object(node) || !string(node.$type) || level > maxDepth || ++budget.value > maxNodes) return null
  if ('$action' in node || '$key' in node || '$status' in node) return null
  const children = node.children ?? []
  if (!Array.isArray(children) || children.length > 24) return null
  const props: ObjectValue = {}
  for (const [key,value] of Object.entries(node)) {
    if (key !== '$type' && key !== 'children') props[key] = value
  }
  const converted: Node[] = []
  for (const child of children) {
    const mapped = assistantTree(child,level+1,budget)
    if (mapped === null) return null
    converted.push(mapped)
  }
  return convert(node.$type,props,converted)
}

/** json-render flat root/elements subset; refuses cycles, dangling ids and bindings. */
function flatTree(spec: unknown): Node | null {
  if (!object(spec) || !only(spec,['root','elements']) || !string(spec.root) || !object(spec.elements)
    || Object.keys(spec.elements).length > maxNodes) return null
  const budget = { value: 0 }
  const visit = (ref: string, level: number, parents: ReadonlySet<string>): Node | null => {
    if (level > maxDepth || ++budget.value > maxNodes || parents.has(ref)
      || !Object.prototype.hasOwnProperty.call(spec.elements,ref)) return null
    const node = spec.elements[ref]
    if (!object(node) || !only(node,['type','props','children']) || !object(node.props)) return null
    const children = node.children ?? []
    if (!Array.isArray(children) || children.length > 24 || !children.every(string)) return null
    const ancestry = new Set(parents)
    ancestry.add(ref)
    const converted: Node[] = []
    for (const id of children) {
      const mapped = visit(id,level+1,ancestry)
      if (mapped === null) return null
      converted.push(mapped)
    }
    return convert(node.type,node.props,converted)
  }
  return visit(spec.root,0,new Set())
}

export function parseInteroperableCanvas(value: unknown): CanvasSpec | null {
  if (!object(value) || !only(value,['component','version','props'])
    || value.version !== 1 || !object(value.props)
    || !only(value.props,['title','subtitle','tree','spec'])
    || !string(value.props.title) || (value.props.subtitle !== undefined && !string(value.props.subtitle))) return null
  const source = value.component
  const node = source === 'assistant_ui' && Object.prototype.hasOwnProperty.call(value.props,'tree')
    && !Object.prototype.hasOwnProperty.call(value.props,'spec')
    ? assistantTree(value.props.tree,0,{value:0})
    : source === 'json_render' && Object.prototype.hasOwnProperty.call(value.props,'spec')
      && !Object.prototype.hasOwnProperty.call(value.props,'tree')
      ? flatTree(value.props.spec)
      : null
  if (node === null) return null
  const canvas = {
    component: 'ui_canvas',
    version: 1,
    props: { title: value.props.title, ...(value.props.subtitle === undefined ? {} : {subtitle:value.props.subtitle}), children: [node] },
  }
  return parseCanvasSpec(canvas)
}
