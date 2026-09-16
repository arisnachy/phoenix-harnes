import type { ReactNode } from 'react'
import css from './GenerativeUi.module.css'

const MAX_UI_BLOCKS = 3
const MAX_TEXT = 1200
const MAX_SHORT_TEXT = 180

type Status = 'positive' | 'neutral' | 'warning' | 'negative' | 'info'

type EventSide = {
  label: string
  meta?: string
  symbol?: string
}

type EventCard = {
  component: 'event_card'
  version: 1
  props: {
    title: string
    subtitle?: string
    badge?: string
    left: EventSide
    center: { eyebrow?: string; value: string; detail?: string }
    right: EventSide
    footer?: string
  }
}

type MetricCard = {
  component: 'metric_card'
  version: 1
  props: {
    title: string
    subtitle?: string
    items: Array<{ label: string; value: string; detail?: string; status?: Status }>
  }
}

type ComparisonCard = {
  component: 'comparison'
  version: 1
  props: {
    title: string
    subtitle?: string
    columns: string[]
    rows: Array<{ label: string; values: string[] }>
  }
}

type TimelineCard = {
  component: 'timeline'
  version: 1
  props: {
    title: string
    subtitle?: string
    items: Array<{ title: string; description?: string; time?: string; status?: Status }>
  }
}

type SmartCard = {
  component: 'smart_card'
  version: 1
  props: {
    title: string
    subtitle?: string
    badge?: string
    description?: string
    fields?: Array<{ label: string; value: string }>
    footer?: string
  }
}

export type GenerativeUiBlock = EventCard | MetricCard | ComparisonCard | TimelineCard | SmartCard

export type GenerativeUiSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'ui'; block: GenerativeUiBlock }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown, max = MAX_SHORT_TEXT): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

const optionalText = (value: unknown, max = MAX_SHORT_TEXT): value is string | undefined =>
  value === undefined || isText(value, max)

const isStatus = (value: unknown): value is Status | undefined =>
  value === undefined || value === 'positive' || value === 'neutral' || value === 'warning' || value === 'negative' || value === 'info'

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key))

const isEventSide = (value: unknown): value is EventSide => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['label', 'meta', 'symbol'])) return false
  return isText(value.label) && optionalText(value.meta) && optionalText(value.symbol, 12)
}

const validateEventCard = (value: Record<string, unknown>): value is EventCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props, ['title', 'subtitle', 'badge', 'left', 'center', 'right', 'footer'])) return false
  const props = value.props
  if (!isRecord(props.center) || !hasOnlyKeys(props.center, ['eyebrow', 'value', 'detail'])) return false
  return isText(props.title)
    && optionalText(props.subtitle)
    && optionalText(props.badge, 48)
    && isEventSide(props.left)
    && isText(props.center.value)
    && optionalText(props.center.eyebrow, 64)
    && optionalText(props.center.detail)
    && isEventSide(props.right)
    && optionalText(props.footer, MAX_TEXT)
}

const validateMetricCard = (value: Record<string, unknown>): value is MetricCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props, ['title', 'subtitle', 'items'])) return false
  const { title, subtitle, items } = value.props
  return isText(title)
    && optionalText(subtitle)
    && Array.isArray(items)
    && items.length > 0
    && items.length <= 6
    && items.every((item) => isRecord(item)
      && hasOnlyKeys(item, ['label', 'value', 'detail', 'status'])
      && isText(item.label)
      && isText(item.value)
      && optionalText(item.detail)
      && isStatus(item.status))
}

const validateComparison = (value: Record<string, unknown>): value is ComparisonCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props, ['title', 'subtitle', 'columns', 'rows'])) return false
  const { title, subtitle, columns, rows } = value.props
  return isText(title)
    && optionalText(subtitle)
    && Array.isArray(columns)
    && columns.length >= 2
    && columns.length <= 5
    && columns.every(column => isText(column))
    && Array.isArray(rows)
    && rows.length > 0
    && rows.length <= 12
    && rows.every((row) => isRecord(row)
      && hasOnlyKeys(row, ['label', 'values'])
      && isText(row.label)
      && Array.isArray(row.values)
      && row.values.length === columns.length
      && row.values.every(cell => isText(cell, MAX_TEXT)))
}

const validateTimeline = (value: Record<string, unknown>): value is TimelineCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props, ['title', 'subtitle', 'items'])) return false
  const { title, subtitle, items } = value.props
  return isText(title)
    && optionalText(subtitle)
    && Array.isArray(items)
    && items.length > 0
    && items.length <= 12
    && items.every((item) => isRecord(item)
      && hasOnlyKeys(item, ['title', 'description', 'time', 'status'])
      && isText(item.title)
      && optionalText(item.description, MAX_TEXT)
      && optionalText(item.time)
      && isStatus(item.status))
}

const validateSmartCard = (value: Record<string, unknown>): value is SmartCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props, ['title', 'subtitle', 'badge', 'description', 'fields', 'footer'])) return false
  const { title, subtitle, badge, description, fields, footer } = value.props
  return isText(title)
    && optionalText(subtitle)
    && optionalText(badge, 48)
    && optionalText(description, MAX_TEXT)
    && (fields === undefined || (Array.isArray(fields)
      && fields.length <= 12
      && fields.every((field) => isRecord(field)
        && hasOnlyKeys(field, ['label', 'value'])
        && isText(field.label)
        && isText(field.value, MAX_TEXT))))
    && optionalText(footer, MAX_TEXT)
}

export function parseGenerativeUiBlock(value: unknown): GenerativeUiBlock | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['component', 'version', 'props'])
    || value.version !== 1
    || typeof value.component !== 'string') return null

  switch (value.component) {
    case 'event_card': return validateEventCard(value) ? value : null
    case 'metric_card': return validateMetricCard(value) ? value : null
    case 'comparison': return validateComparison(value) ? value : null
    case 'timeline': return validateTimeline(value) ? value : null
    case 'smart_card': return validateSmartCard(value) ? value : null
    default: return null
  }
}

function appendMarkdown(segments: GenerativeUiSegment[], text: string): void {
  if (text.length === 0) return
  const previous = segments.at(-1)
  if (previous?.kind === 'markdown') previous.text += text
  else segments.push({ kind: 'markdown', text })
}

/**
 * Split assistant prose into ordinary Markdown and validated declarative UI.
 * Invalid or unsupported blocks remain literal Markdown, so malformed model
 * output never disappears and never gains executable authority.
 */
export function splitGenerativeUiText(text: string): GenerativeUiSegment[] {
  const segments: GenerativeUiSegment[] = []
  const fence = /```generative-ui[ \t]*\r?\n([\s\S]*?)```/g
  let cursor = 0
  let rendered = 0

  for (const match of text.matchAll(fence)) {
    const index = match.index ?? 0
    appendMarkdown(segments, text.slice(cursor, index))
    const raw = match[0]
    const body = match[1]
    let parsed: GenerativeUiBlock | null = null
    if (rendered < MAX_UI_BLOCKS && body !== undefined) {
      try {
        parsed = parseGenerativeUiBlock(JSON.parse(body))
      } catch {
        parsed = null
      }
    }
    if (parsed === null) appendMarkdown(segments, raw)
    else {
      segments.push({ kind: 'ui', block: parsed })
      rendered += 1
    }
    cursor = index + raw.length
  }
  appendMarkdown(segments, text.slice(cursor))
  return segments.length > 0 ? segments : [{ kind: 'markdown', text }]
}

const Initial = ({ label, symbol }: EventSide) => (
  <span className={css.symbol} aria-hidden="true">{(symbol ?? label.slice(0, 2)).toUpperCase()}</span>
)

const Header = ({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: string }) => (
  <header className={css.header}>
    <div>
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {badge && <span className={css.badge}>{badge}</span>}
  </header>
)

const statusClass = (status: Status | undefined): string => status === undefined ? '' : css[status]

export function GenerativeUi({ block }: { block: GenerativeUiBlock }): ReactNode {
  switch (block.component) {
    case 'event_card': {
      const { title, subtitle, badge, left, center, right, footer } = block.props
      return (
        <section className={css.card} data-generative-ui="event_card">
          <Header title={title} subtitle={subtitle} badge={badge} />
          <div className={css.eventGrid}>
            <div className={css.participant}><Initial {...left} /><strong>{left.label}</strong>{left.meta && <small>{left.meta}</small>}</div>
            <div className={css.eventCenter}>{center.eyebrow && <small>{center.eyebrow}</small>}<strong>{center.value}</strong>{center.detail && <span>{center.detail}</span>}</div>
            <div className={css.participant}><Initial {...right} /><strong>{right.label}</strong>{right.meta && <small>{right.meta}</small>}</div>
          </div>
          {footer && <footer className={css.footer}>{footer}</footer>}
        </section>
      )
    }
    case 'metric_card':
      return (
        <section className={css.card} data-generative-ui="metric_card">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <div className={css.metrics}>
            {block.props.items.map((item, index) => (
              <div className={css.metric} key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small className={statusClass(item.status)}>{item.detail}</small>}</div>
            ))}
          </div>
        </section>
      )
    case 'comparison':
      return (
        <section className={css.card} data-generative-ui="comparison">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <div className={css.tableWrap}>
            <table className={css.table}><thead><tr><th scope="col" />{block.props.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.props.rows.map((row, index) => <tr key={`${row.label}-${index}`}><th scope="row">{row.label}</th>{row.values.map((value, cell) => <td key={`${index}-${cell}`}>{value}</td>)}</tr>)}</tbody></table>
          </div>
        </section>
      )
    case 'timeline':
      return (
        <section className={css.card} data-generative-ui="timeline">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <ol className={css.timeline}>{block.props.items.map((item, index) => <li key={`${item.title}-${index}`}><span className={`${css.dot} ${statusClass(item.status)}`} /> <div>{item.time && <small>{item.time}</small>}<strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div></li>)}</ol>
        </section>
      )
    case 'smart_card':
      return (
        <section className={css.card} data-generative-ui="smart_card">
          <Header title={block.props.title} subtitle={block.props.subtitle} badge={block.props.badge} />
          {block.props.description && <p className={css.description}>{block.props.description}</p>}
          {block.props.fields && block.props.fields.length > 0 && <dl className={css.fields}>{block.props.fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
          {block.props.footer && <footer className={css.footer}>{block.props.footer}</footer>}
        </section>
      )
  }
}
