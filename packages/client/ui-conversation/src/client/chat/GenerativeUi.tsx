import { useState, type ReactNode } from 'react'
import { PhoenixStatusPill, PhoenixAgentLine, type PhoenixUiIconName, type PhoenixStatusTone } from '@phoenix-ai/dsh-client-ui-primitives'
import { ScaleForm, parseScaleForm, type ScaleFormSpec } from './ScaleForm.tsx'
import { SpreadsheetSurface, parseSpreadsheet, type SpreadsheetSpec } from './SpreadsheetSurface.tsx'
import { GeoMap, parseGeoMapSpec, type GeoMapSpec } from './GeoMap.tsx'
import { SceneMap, parseSceneMapSpec, type SceneMapSpec } from './SceneMap.tsx'
import { DiagramSurface, parseDiagramSpec, type DiagramSpec } from './DiagramSurface.tsx'
import { GenerativeCanvas, parseCanvasSpec, type CanvasAction, type CanvasSpec } from './GenerativeCanvas.tsx'
import css from './GenerativeUi.module.css'

const MAX_UI_BLOCKS = 6
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

type SportsSide = { label: string; score?: string; logo?: string; meta?: string }
type SportsPlayer = { name:string;role?:string;image?:string;stats?:string;id?:number }
type SportsPitcher = { team:string;name:string;id?:number;image?:string;stats?:string;probable:boolean }
type SportsLineup = { team:string;confirmed:boolean;players:SportsPlayer[] }
type SportsBullpen = { team:string;pitchers:SportsPlayer[];note:string }
type SportsResearch = { favorite:string;method:string;source:string;evidence:string[] }
type SportsGameCard = {
  component: 'sports_game_card'; version: 1
  props: {
    title: string; subtitle?: string; status?: string; when: string; venue?: string
    home: SportsSide; away: SportsSide; source: string
    highlights?: Array<{ label: string; value: string; image?: string; detail?: string }>
    pitchers?: SportsPitcher[]; lineups?: SportsLineup[]; bullpen?: SportsBullpen[]
    sport?: string; league?: string; country?: string; eventId?: string; broadcast?: string; research?: SportsResearch
    periods?: Array<{ label:string;away:string;home:string }>
    note?: string; askPrompt?: string
  }
}
type SportsOddsCard = {
  component: 'sports_odds_card'; version: 1
  props: { title:string;source:string;subtitle?:string;note:string
    rows:Array<{ event:string;market:string;selection:string;bookmaker:string;price:string;point?:string }> }
}
type SportsTicketCard = {
  component: 'sports_ticket_card'; version: 1
  props: {
    title: string; subtitle?: string; source: string
    legs: Array<{ event: string; selection: string; price: string; bookmaker: string; when?: string; image?: string;
      sport?:string;country?:string;league?:string;market?:string;player?:string;rationale?:string
      homeLogo?:string;awayLogo?:string }>
    requestedLegs?:number; combinedOdds: string; stake?: string; grossReturn?: string; note: string
    askPrompt?: string
  }
}

type StatusPillBlock = {
  component: 'status_pill'
  version: 1
  props: { label: string; tone?: PhoenixStatusTone }
}
type AgentLineBlock = {
  component: 'agent_line'
  version: 1
  props: { name: string; role: string; message: string; icon?: PhoenixUiIconName }
}
const supportedIcons: readonly PhoenixUiIconName[] = [
  'bot', 'brain', 'code', 'check', 'alert', 'table', 'calculator',
  'copy', 'download', 'reset', 'clipboard', 'plus', 'file', 'search',
  'settings', 'calendar', 'activity', 'shield', 'chart', 'info',
]
const supportedTones: readonly PhoenixStatusTone[] = ['positive', 'warning', 'negative', 'info', 'neutral']

export type GenerativeUiBlock = EventCard | MetricCard | ComparisonCard | TimelineCard | SmartCard | SportsGameCard | SportsTicketCard | SportsOddsCard
  | CanvasSpec | ScaleFormSpec | SpreadsheetSpec | GeoMapSpec | SceneMapSpec | DiagramSpec | StatusPillBlock | AgentLineBlock

export type GenerativeUiSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'ui'; block: GenerativeUiBlock }
  | { kind: 'notice'; text: string }

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
    && items.every(item => isRecord(item)
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
    && rows.every(row => isRecord(row)
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
    && items.every(item => isRecord(item)
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
      && fields.every(field => isRecord(field)
        && hasOnlyKeys(field, ['label', 'value'])
        && isText(field.label)
        && isText(field.value, MAX_TEXT))))
    && optionalText(footer, MAX_TEXT)
}

const trustedPortrait = (value: unknown): value is string | undefined => {
  if (value === undefined) return true
  if (typeof value !== 'string' || value.length > 500) return false
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password
    && ['a.espncdn.com','img.mlbstatic.com','www.mlbstatic.com'].includes(u.hostname) } catch { return false }
}
const sportsSide = (value: unknown): value is SportsSide => isRecord(value)
  && hasOnlyKeys(value, ['label','score','logo','meta'])
  && isText(value.label) && optionalText(value.score,32) && optionalText(value.meta)
  && trustedPortrait(value.logo)
const sportsPlayer = (v:unknown):v is SportsPlayer => isRecord(v)
  && hasOnlyKeys(v,['name','role','image','stats','id']) && isText(v.name)
  && optionalText(v.role,60) && optionalText(v.stats,240) && trustedPortrait(v.image)
  && (v.id===undefined || typeof v.id==='number'&&Number.isSafeInteger(v.id))
const sportsPitcher = (v:unknown):v is SportsPitcher => isRecord(v)
  && hasOnlyKeys(v,['team','name','id','image','stats','probable'])
  && isText(v.team) && isText(v.name) && typeof v.probable==='boolean'
  && optionalText(v.stats,240) && trustedPortrait(v.image)
  && (v.id===undefined || typeof v.id==='number'&&Number.isSafeInteger(v.id))
const sportsLineup = (v:unknown):v is SportsLineup => isRecord(v)
  && hasOnlyKeys(v,['team','confirmed','players']) && isText(v.team)
  && typeof v.confirmed==='boolean' && Array.isArray(v.players)
  && v.players.length<=12 && v.players.every(sportsPlayer)
const sportsBullpen = (v:unknown):v is SportsBullpen => isRecord(v)
  && hasOnlyKeys(v,['team','pitchers','note']) && isText(v.team)
  && isText(v.note,320) && Array.isArray(v.pitchers)
  && v.pitchers.length<=8 && v.pitchers.every(sportsPlayer)
const sportsResearch = (v:unknown):v is SportsResearch => isRecord(v)
  && hasOnlyKeys(v,['favorite','method','source','evidence'])
  && isText(v.favorite) && isText(v.method,450) && isText(v.source,250)
  && Array.isArray(v.evidence) && v.evidence.length<=5 && v.evidence.every(x=>isText(x,250))
const sportsOdds = (v:Record<string,unknown>):v is SportsOddsCard => {
  if(!isRecord(v.props)||!hasOnlyKeys(v.props,['title','source','subtitle','rows','note']))return false
  const p=v.props
  return isText(p.title) && isText(p.source,250) && optionalText(p.subtitle,220)
    && isText(p.note,1000) && Array.isArray(p.rows) && p.rows.length>=1 && p.rows.length<=12
    && p.rows.every(x=>isRecord(x)&&hasOnlyKeys(x,['event','market','selection','bookmaker','price','point'])
      && isText(x.event) && isText(x.market,50) && isText(x.selection)
      && isText(x.bookmaker) && isText(x.price,35) && optionalText(x.point,35))
}
const sportsGame = (value: Record<string, unknown>): value is SportsGameCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props,
    ['title','subtitle','status','when','venue','home','away','source','highlights','note','askPrompt','pitchers','lineups','bullpen','sport','league','country','eventId','broadcast','research','periods'])) return false
  const p = value.props
  return isText(p.title) && optionalText(p.subtitle) && optionalText(p.status,60)
    && isText(p.when) && optionalText(p.venue) && sportsSide(p.home) && sportsSide(p.away)
    && isText(p.source,320) && optionalText(p.note,MAX_TEXT) && optionalText(p.askPrompt,400)
    && optionalText(p.sport,60) && optionalText(p.league,100) && optionalText(p.country,100)
    && optionalText(p.eventId,50) && optionalText(p.broadcast,150)
    && (p.research===undefined || sportsResearch(p.research))
    && (p.periods===undefined || Array.isArray(p.periods) && p.periods.length<=12 && p.periods.every(x=>isRecord(x)
      && hasOnlyKeys(x,['label','away','home']) && isText(x.label,30) && isText(x.away,30) && isText(x.home,30)))
    && (p.pitchers===undefined || Array.isArray(p.pitchers) && p.pitchers.length<=4 && p.pitchers.every(sportsPitcher))
    && (p.lineups===undefined || Array.isArray(p.lineups) && p.lineups.length<=2 && p.lineups.every(sportsLineup))
    && (p.bullpen===undefined || Array.isArray(p.bullpen) && p.bullpen.length<=2 && p.bullpen.every(sportsBullpen))
    && (p.highlights === undefined || Array.isArray(p.highlights) && p.highlights.length <= 8
      && p.highlights.every(x => isRecord(x) && hasOnlyKeys(x,['label','value','image','detail'])
        && isText(x.label,70) && isText(x.value,180) && trustedPortrait(x.image) && optionalText(x.detail,240)))
}
const sportsTicket = (value: Record<string, unknown>): value is SportsTicketCard => {
  if (!isRecord(value.props) || !hasOnlyKeys(value.props,
    ['title','subtitle','source','legs','requestedLegs','combinedOdds','stake','grossReturn','note','askPrompt'])) return false
  const p = value.props
  return isText(p.title) && optionalText(p.subtitle) && isText(p.source,320)
    && isText(p.combinedOdds,40) && optionalText(p.stake,50)
    && optionalText(p.grossReturn,50) && isText(p.note,MAX_TEXT)
    && optionalText(p.askPrompt,400) && (p.requestedLegs===undefined ||
      (Number.isInteger(p.requestedLegs)&&Number(p.requestedLegs)>=1&&Number(p.requestedLegs)<=6))
    && Array.isArray(p.legs) && (p.requestedLegs===undefined||p.legs.length<=Number(p.requestedLegs))
    && p.legs.length >= 1 && p.legs.length <= 12 && p.legs.every(x => isRecord(x)
      && hasOnlyKeys(x,['event','selection','price','bookmaker','when','image','sport','country','league','market','player','rationale','homeLogo','awayLogo'])
      && isText(x.event) && isText(x.selection) && isText(x.price,32)
      && isText(x.bookmaker) && optionalText(x.when) && trustedPortrait(x.image)
      && trustedPortrait(x.homeLogo) && trustedPortrait(x.awayLogo)
      && optionalText(x.sport,60) && optionalText(x.country,100) && optionalText(x.league,100)
      && optionalText(x.market,70) && optionalText(x.player,140) && optionalText(x.rationale,240))
}

export function parseGenerativeUiBlock(value: unknown): GenerativeUiBlock | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ['component', 'version', 'props'])
    || value.version !== 1
    || typeof value.component !== 'string') return null

  switch (value.component) {
    case 'sports_game_card': return sportsGame(value) ? value : null
    case 'sports_ticket_card': return sportsTicket(value) ? value : null
    case 'sports_odds_card': return sportsOdds(value) ? value : null
    case 'event_card': return validateEventCard(value) ? value : null
    case 'metric_card': return validateMetricCard(value) ? value : null
    case 'comparison': return validateComparison(value) ? value : null
    case 'timeline': return validateTimeline(value) ? value : null
    case 'smart_card': return validateSmartCard(value) ? value : null
    case 'ui_canvas': return parseCanvasSpec(value)
    case 'scale_form': return parseScaleForm(value)
    case 'spreadsheet': return parseSpreadsheet(value)
    case 'geo_map': return parseGeoMapSpec(value)
    case 'scene_map': return parseSceneMapSpec(value)
    case 'diagram': return parseDiagramSpec(value)
    case 'status_pill':
      return isRecord(value.props) && hasOnlyKeys(value.props, ['label','tone'])
        && isText(value.props.label, 100)
        && (value.props.tone === undefined || supportedTones.includes(value.props.tone as PhoenixStatusTone))
        ? value as StatusPillBlock : null
    case 'agent_line':
      return isRecord(value.props) && hasOnlyKeys(value.props, ['name','role','message','icon'])
        && isText(value.props.name, 80) && isText(value.props.role, 100)
        && isText(value.props.message, 1200)
        && (value.props.icon === undefined || supportedIcons.includes(value.props.icon as PhoenixUiIconName))
        ? value as AgentLineBlock : null
    default: return null
  }
}

function appendMarkdown(segments: GenerativeUiSegment[], text: string): void {
  if (text.length === 0) return
  const previous = segments.at(-1)
  if (previous?.kind === 'markdown') previous.text += text
  else segments.push({ kind: 'markdown', text })
}

type SplitGenerativeUiOptions = {
  streaming?: boolean
}

/**
 * Split assistant prose into ordinary Markdown and validated declarative UI.
 * Invalid or unsupported blocks remain literal Markdown, so malformed model
 * output never disappears and never gains executable authority. While a reply
 * is streaming, an unfinished generative-ui fence stays hidden until complete.
 */
export function splitGenerativeUiText(
  text: string,
  options: SplitGenerativeUiOptions = {},
): GenerativeUiSegment[] {
  const segments: GenerativeUiSegment[] = []
  const fence = /```[ \t]*(?:generative-ui|json)[ \t]*\r?\n([\s\S]*?)```/gi
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
    if (parsed === null) {
      if (/"component"\s*:\s*"(?:sports_game_card|sports_ticket_card)"/.test(body ?? ''))
        segments.push({ kind: 'notice', text: 'La tarjeta deportiva no pudo validarse. Kira debe consultar de nuevo el evento y entregar los datos verificados.' })
      else if (/"component"\s*:\s*"(?:ui_canvas|scale_form|spreadsheet|geo_map|scene_map|diagram|status_pill|agent_line)"/.test(body ?? ''))
        segments.push({ kind: 'notice', text: 'Esta interfaz no pudo mostrarse. Pide a Kira que la actualice.' })
      else appendMarkdown(segments, raw)
    }
    else {
      segments.push({ kind: 'ui', block: parsed })
      rendered += 1
    }
    cursor = index + raw.length
  }

  let tail = text.slice(cursor)
  if (options.streaming === true) {
    const lastJsonFence = tail.lastIndexOf('```json')
    const relevantJson = lastJsonFence >= 0 && /"component"\s*:\s*"(?:ui_canvas|scale_form|spreadsheet|geo_map|scene_map|diagram|status_pill|agent_line)"/.test(tail.slice(lastJsonFence))
      ? lastJsonFence : -1
    const unfinishedFence = Math.max(tail.lastIndexOf('```generative-ui'), relevantJson)
    if (unfinishedFence >= 0) tail = tail.slice(0, unfinishedFence)
  }
  appendMarkdown(segments, tail)

  const normalized = expandRawCanvases(segments, options.streaming === true)
  if (normalized.length > 0) return normalized
  // An unfinished bare JSON canvas is intentionally consumed by
  // expandRawCanvases; do not resurrect it as Markdown while streaming.
  return options.streaming === true ? [] : [{ kind: 'markdown', text }]
}

/**
 * Models often emit raw JSON rather than the special fenced format. Accept a
 * bounded, balanced top-level canvas object at the start of a line, even with
 * introductory or following prose. Do not interpret generic JSON as UI.
 */
function expandRawCanvases(segments: GenerativeUiSegment[], streaming: boolean): GenerativeUiSegment[] {
  const result: GenerativeUiSegment[] = []
  let count = segments.filter(segment => segment.kind === 'ui').length
  for (const segment of segments) {
    if (segment.kind !== 'markdown' || !segment.text.includes('"component"') || segment.text.includes('```')) {
      result.push(segment)
      continue
    }
    const source = segment.text
    const startPattern = /^[ \t]*\{\s*"component"\s*:\s*"(?:ui_canvas|scale_form|spreadsheet|geo_map|scene_map|diagram|status_pill|agent_line)"/gm
    let cursor = 0
    for (const match of source.matchAll(startPattern)) {
      if (count >= MAX_UI_BLOCKS) break
      const start = (match.index ?? 0) + (match[0]?.indexOf('{') ?? 0)
      if (start < cursor) continue
      let nesting = 0
      let stringMode = false
      let escaped = false
      let end = -1
      for (let i = start; i < source.length && i - start <= 100_000; i++) {
        const ch = source[i]
        if (stringMode) {
          if (escaped) escaped = false
          else if (ch === '\\') escaped = true
          else if (ch === '"') stringMode = false
        } else if (ch === '"') stringMode = true
        else if (ch === '{') nesting += 1
        else if (ch === '}') {
          nesting -= 1
          if (nesting === 0) { end = i + 1; break }
        }
      }
      appendMarkdown(result, source.slice(cursor, start))
      if (end === -1 && streaming) {
        cursor = source.length // hide unfinished machine representation
        break
      }
      if (end === -1) {
        result.push({ kind: 'notice', text: 'La interfaz llegó incompleta. Pide a Kira que la actualice.' })
        cursor = source.length
        break
      }
      let block: GenerativeUiBlock | null = null
      try { block = parseGenerativeUiBlock(JSON.parse(source.slice(start, end))) } catch { /* invalid UI */ }
      if (block === null)
        result.push({ kind: 'notice', text: 'Esta interfaz no pudo mostrarse. Pide a Kira que la actualice.' })
      else {
        result.push({ kind: 'ui', block })
        count += 1
      }
      cursor = end
    }
    appendMarkdown(result, source.slice(cursor))
  }
  return result
}

const SportsPortrait = ({ label,logo }:{ label:string;logo?:string|undefined }) => (
  <span className={css.sportsPortrait}>
    <span>{label.slice(0,2).toUpperCase()}</span>
    {logo && <img src={logo} alt={label} loading="lazy" referrerPolicy="no-referrer"
      onError={(event)=>{event.currentTarget.style.display='none'}}/>}
  </span>
)
const SportsLineups = ({ lineups }:{ lineups:SportsLineup[] }) => {
  const [selected,setSelected]=useState(0)
  const lineup=lineups[selected]
  if(!lineup)return null
  return <section className={css.sportsDetailSection} aria-label="Alineaciones MLB">
    <h4>Alineaciones</h4>
    <div className={css.sportsTabs} role="group" aria-label="Seleccionar equipo">
      {lineups.map((side,i)=><button key={side.team} type="button"
        aria-pressed={selected===i} onClick={()=>{ setSelected(i) }}>{side.team}</button>)}
    </div>
    {!lineup.confirmed&&<p className={css.sportsNote}>Alineación pendiente de confirmación: solo jugadores publicados por MLB.</p>}
    {lineup.players.length>0?<div className={css.sportsTableScroll}><table className={css.sportsTable}>
      <thead><tr><th scope="col">Bateador</th><th scope="col">Pos.</th><th scope="col">Temporada</th></tr></thead>
      <tbody>{lineup.players.map((p,i)=><tr key={p.id??i}>
        <th scope="row"><span className={css.sportsPlayerName}>
          {p.image&&<SportsPortrait label={p.name} logo={p.image}/>}
          {i+1}. {p.name}</span></th><td>{p.role??'—'}</td>
        <td>{p.stats??'Pendiente'}</td>
      </tr>)}</tbody></table></div>:<p className={css.sportsNote}>MLB todavía no publicó la alineación oficial.</p>}
  </section>
}
const SportsBullpen = ({ bullpen }:{ bullpen:SportsBullpen[] }) => (
  <section className={css.sportsDetailSection} aria-label="Bullpen MLB">
    <h4>Bullpen y cuerpo de lanzadores</h4>
    <div className={css.sportsBulpenGrid}>{bullpen.map((b,i)=><div key={i} className={css.sportsBullpenTeam}>
      <strong>{b.team}</strong>{b.pitchers.length?b.pitchers.map((p,j)=>
        <div className={css.sportsPitcherRow} key={p.id??j}>
          <SportsPortrait label={p.name} logo={p.image}/>
          <span><b>{p.name}</b><small>{p.stats??'Estadísticas no disponibles'}</small></span>
        </div>):<p className={css.sportsNote}>Sin datos de bullpen verificables.</p>}
      <p className={css.sportsNote}>{b.note}</p>
    </div>)}</div>
  </section>
)

const Initial = ({ label, symbol }: EventSide) => (
  <span className={css.symbol} aria-hidden="true">{(symbol ?? label.slice(0, 2)).toUpperCase()}</span>
)

type HeaderProps = {
  title: string
  subtitle?: string | undefined
  badge?: string | undefined
}

const Header = ({ title, subtitle, badge }: HeaderProps) => (
  <header className={css.header}>
    <div>
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {badge && <span className={css.badge}>{badge}</span>}
  </header>
)

const statusClass = (status: Status | undefined): string =>
  status === undefined ? '' : (css[status] ?? '')

export function GenerativeUi({ block, onAction, conversationId }: { block: GenerativeUiBlock; onAction?: CanvasAction | undefined; conversationId?: string }): ReactNode {
  switch (block.component) {
    case 'ui_canvas': return <GenerativeCanvas spec={block} onAction={onAction} />
    case 'scale_form': return <ScaleForm spec={block} />
    case 'spreadsheet': return <SpreadsheetSurface key={block.props.id} spec={block} />
    case 'geo_map': return <GeoMap key={(conversationId ?? block.props.conversationId ?? 'ephemeral') + ':' + block.props.id} spec={block} onAction={onAction} {...(conversationId === undefined ? {} : { conversationId })} />
    case 'scene_map': return <SceneMap key={(conversationId ?? 'ephemeral') + ':' + block.props.id} spec={block} onAction={onAction} />
    case 'diagram': return <DiagramSurface key={(conversationId ?? 'ephemeral') + ':' + block.props.id} spec={block} onAction={onAction} />
    case 'status_pill': return <PhoenixStatusPill label={block.props.label} {...block.props.tone === undefined ? {} : { tone: block.props.tone }} />
    case 'agent_line': return <PhoenixAgentLine {...block.props} />
    case 'sports_game_card': {
      const p=block.props
      return <section className={css.sportsCard} data-generative-ui="sports_game_card">
        <header className={css.sportsHeadline}>
          <div><span className={css.sportsKicker}>PHOENIX / {p.sport?.toUpperCase()??'DEPORTES'}</span>
            {(p.country||p.league)&&<div className={css.sportsCompetition}>{[p.country,p.league].filter(Boolean).join(' · ')}</div>}
            <h3>{p.title}</h3>{p.subtitle&&<p>{p.subtitle}</p>}</div>
          {p.status&&<span className={css.sportsStatus}>{p.status}</span>}
        </header>
        <div className={css.sportsVenue}><span>◷ {p.when}</span>
          <span>⌖ {p.venue||'Sede sin confirmar'}</span>
          {p.broadcast&&<span>TV · {p.broadcast}</span>}</div>
        <div className={css.sportsVersus}>
          <div className={css.sportsTeam}><SportsPortrait label={p.away.label} logo={p.away.logo}/>
            <strong>{p.away.label}</strong>{p.away.meta&&<small>{p.away.meta}</small>}
            {p.away.score!==undefined&&<b>{p.away.score}</b>}</div>
          <span className={css.sportsVs}>{p.away.score!==undefined||p.home.score!==undefined?'—':'VS'}</span>
          <div className={css.sportsTeam}><SportsPortrait label={p.home.label} logo={p.home.logo}/>
            <strong>{p.home.label}</strong>{p.home.meta&&<small>{p.home.meta}</small>}
            {p.home.score!==undefined&&<b>{p.home.score}</b>}</div>
        </div>
        {p.periods?.length?<section className={css.sportsDetailSection} aria-label="Parciales del partido">
          <h4>Marcador por período</h4><div className={css.sportsTableScroll}><table className={css.sportsTable}>
            <thead><tr><th>Equipo</th>{p.periods.map((period,i)=><th key={i}>{period.label}</th>)}</tr></thead>
            <tbody><tr><th>{p.away.label}</th>{p.periods.map((period,i)=><td key={i}>{period.away}</td>)}</tr>
              <tr><th>{p.home.label}</th>{p.periods.map((period,i)=><td key={i}>{period.home}</td>)}</tr></tbody>
          </table></div></section>:null}
        {p.pitchers?.length?<section className={css.sportsDetailSection} aria-label="Lanzadores probables">
          <h4>Abridores probables</h4>
          <div className={css.sportsStarters}>{p.pitchers.map((pitcher,i)=>
            <div key={pitcher.id??i} className={css.sportsStarter}>
              <SportsPortrait label={pitcher.name} logo={pitcher.image}/>
              <div><span>{pitcher.team}</span><strong>{pitcher.name}</strong>
                <small>{pitcher.stats??'Estadísticas de temporada no disponibles'}</small></div>
            </div>)}</div>
          <p className={css.sportsNote}>Probables según MLB; sujetos a cambios.</p>
        </section>:null}
        {!p.pitchers?.length&&p.highlights?.length?<dl className={css.sportsFacts}>{p.highlights.map((h,i)=>
          <div key={i}>{h.image&&<SportsPortrait label={h.value} logo={h.image}/>}
            <dt>{h.label}</dt><dd>{h.value}</dd>{h.detail&&<small>{h.detail}</small>}</div>)}</dl>:null}
        {p.research&&<section className={css.sportsDetailSection} aria-label="Investigación de Phoenix">
          <h4>Investigación Phoenix · Tendencia</h4>
          <div className={css.sportsResearch}><strong>{p.research.favorite}</strong>
            <p>{p.research.method}</p>
            <ul>{p.research.evidence.map((line,i)=><li key={i}>{line}</li>)}</ul>
            <small>Fuente: {p.research.source}</small></div>
        </section>}
        {p.lineups?.length?<SportsLineups lineups={p.lineups}/>:null}
        {p.bullpen?.length?<SportsBullpen bullpen={p.bullpen}/>:null}
        <footer className={css.sportsSourceBar}>
          <span>Datos · {p.source}</span>
          {p.note&&<small>{p.note}</small>}
          {p.askPrompt&&onAction&&<button type="button" onClick={() => { if (p.askPrompt) onAction(p.askPrompt, 'draft') }}>
            Investigar análisis y mercados</button>}
        </footer>
      </section>
    }
    case 'sports_odds_card': {
      const p=block.props
      return <section className={css.sportsCard} data-generative-ui="sports_odds_card">
        <header className={css.sportsHeadline}><div><span className={css.sportsKicker}>PHOENIX / CUOTAS VERIFICADAS</span>
          <h3>{p.title}</h3>{p.subtitle&&<p>{p.subtitle}</p>}</div></header>
        <div className={css.sportsTableScroll}><table className={css.sportsTable}>
          <thead><tr><th>Partido</th><th>Mercado</th><th>Selección</th><th>Casa</th><th>Cuota decimal</th></tr></thead>
          <tbody>{p.rows.map((r,i)=><tr key={i}><th>{r.event}</th><td>{r.market}</td>
            <td>{r.selection}{r.point?' · '+r.point:''}</td><td>{r.bookmaker}</td><td><strong>{r.price}</strong></td>
          </tr>)}</tbody></table></div>
        <footer className={css.sportsSourceBar}><span>Fuente: {p.source}</span><small>{p.note}</small></footer>
      </section>
    }
    case 'sports_ticket_card': {
      const p = block.props
      const requested = p.requestedLegs ?? p.legs.length
      const incomplete = p.legs.length < requested
      const unpriced = p.combinedOdds === 'No disponible'
      // Keep only attributed competition taxonomy; do not infer unnamed leagues.
      const groups = new Map<string,typeof p.legs>()
      for (const leg of p.legs) {
        const heading=[leg.sport??'Deporte no clasificado',leg.country,leg.league].filter(Boolean).join(' · ')
        groups.set(heading,[...(groups.get(heading)??[]),leg])
      }
      return <section className={`${css.sportsCard} ${css.sportsTicketCard}`} data-generative-ui="sports_ticket_card">
        <header className={css.sportsTicketHeading}>
          <div className={css.sportsTicketRibbon}>
            <span className={css.sportsKicker}>PHOENIX / SPORTS INTELLIGENCE</span>
            <span className={css.sportsStatus}>{incomplete?'INCOMPLETO':unpriced?'PREVIA SIN CUOTAS':'SIMULACIÓN'}</span>
          </div>
          <div className={css.sportsTicketIntro}>
            <div><h3>{p.title}</h3>{p.subtitle&&<p>{p.subtitle}</p>}</div>
            <div className={css.sportsTicketCount}><strong>{p.legs.length}<span> / {requested}</span></strong><small>PATAS</small></div>
          </div>
          <div className={css.sportsTicketProgress} role="progressbar" aria-label="Patas verificadas"
            aria-valuemin={0} aria-valuemax={requested} aria-valuenow={p.legs.length}>
            <span style={{width:`${100*p.legs.length/requested}%`}}/>
          </div>
          {incomplete&&<p className={css.sportsTicketMissing}>Faltan {requested-p.legs.length} selecciones por verificar. Esto no es un ticket completo.</p>}
        </header>
        <div className={css.sportsTicketGroups}>{[...groups].map(([heading,legs])=>
          <section key={heading} className={css.sportsTicketGroup} aria-label={heading}>
            <h4>{heading}<small>{legs.length} {legs.length===1?'pata':'patas'}</small></h4>
            <div className={css.sportsLegs}>{legs.map(leg=><article key={p.legs.indexOf(leg)} className={css.sportsLeg}>
              <span className={css.sportsTicketLegNumber}>{String(p.legs.indexOf(leg)+1).padStart(2,'0')}</span>
              <div className={css.sportsTicketLegMain}>
                <span className={css.sportsTicketEvent}>{leg.event}{leg.when?' · '+leg.when:''}</span>
                <div className={css.sportsTicketPick}>
                  {(leg.homeLogo||leg.awayLogo||leg.image)&&<span className={css.sportsTicketLogos}>
                    {leg.awayLogo&&<SportsPortrait label="Visitante" logo={leg.awayLogo}/>}
                    {leg.homeLogo&&<SportsPortrait label="Local" logo={leg.homeLogo}/>}
                    {leg.image&&<SportsPortrait label={leg.player??leg.selection} logo={leg.image}/>}
                  </span>}
                  <strong>{leg.selection}</strong>
                </div>
                <small>{[leg.market,leg.player?'Jugador · '+leg.player:undefined,leg.bookmaker].filter(Boolean).join(' · ')}</small>
                {leg.rationale&&<details className={css.sportsTicketReason}><summary>Ver fundamento</summary><p>{leg.rationale}</p></details>}
              </div>
              <div className={css.sportsTicketPrice}>
                <small>{unpriced?'ESTADO':'CUOTA'}</small>
                <b aria-label={`Cuota ${leg.price}`}>{leg.price}</b>
              </div>
            </article>)}</div>
          </section>)}</div>
        <div className={css.sportsTicketTotal}>
          <div><small>{unpriced?'Cotización':'Cuota combinada'}</small>
            <strong>{unpriced?'Sin verificar':p.combinedOdds}</strong></div>
          {p.stake&&<div><small>Importe simulado</small><strong>{p.stake}</strong></div>}
          {p.grossReturn&&<div><small>Retorno bruto potencial</small><strong>{p.grossReturn}</strong></div>}
        </div>
        <footer className={css.sportsFoot}>
          <strong>Solo análisis · No se ha realizado ninguna apuesta</strong>
          <span>Fuente: {p.source}</span>
          <details className={css.sportsTicketDisclaimer}><summary>Fuentes, metodología y advertencias</summary><p>{p.note}</p></details>
          {p.askPrompt&&onAction&&<button type="button" onClick={() => {if(p.askPrompt)onAction(p.askPrompt,'draft')}}>Revisar selecciones</button>}
        </footer>
      </section>
    }
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
