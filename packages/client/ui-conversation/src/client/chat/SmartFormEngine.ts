/**
 * Declarative, bounded calculation runtime for model-authored forms.
 * No eval, Function, scripts, network I/O or model round trips are involved.
 */
export type FormValue = string | number | boolean | string[]
export type SmartExpr =
  | { readonly constant: number | string | boolean }
  | { readonly field: string }
  | { readonly today: true }
  | { readonly op: SmartOp; readonly args: readonly SmartExpr[] }

export type SmartOp =
  | 'add' | 'sub' | 'mul' | 'div' | 'pow' | 'mod' | 'min' | 'max'
  | 'abs' | 'sqrt' | 'ln' | 'log10' | 'exp' | 'sin' | 'cos' | 'tan'
  | 'floor' | 'ceil' | 'round' | 'neg' | 'pi'
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'and' | 'or' | 'not' | 'if'
  | 'days_between' | 'add_days'

export interface SmartField {
  readonly id: string
  readonly label: string
  readonly type: 'number' | 'range' | 'text' | 'textarea' | 'date' | 'time' | 'select' | 'radio' | 'checkbox'
  readonly required?: boolean
  readonly description?: string
  readonly placeholder?: string
  readonly unit?: string
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly default?: FormValue
  readonly options?: readonly { readonly label: string; readonly value: string | number }[]
  readonly showWhen?: { readonly field: string; readonly equals: string | number | boolean }
}

export interface SmartOutput {
  readonly id: string
  readonly label: string
  readonly expression: SmartExpr
  readonly unit?: string
  readonly precision?: number
  readonly description?: string
  readonly bands?: readonly { readonly max: number; readonly label: string }[]
}

export interface SmartFormSpec {
  readonly component: 'smart_form'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly kind: 'calculator' | 'scientific' | 'test' | 'scale' | 'survey' | 'form'
    readonly folder?: string
    readonly description?: string
    readonly source?: string
    readonly tags?: readonly string[]
    readonly fields: readonly SmartField[]
    readonly outputs?: readonly SmartOutput[]
  }
}
export interface SmartLibrarySpec {
  readonly component: 'smart_form_library'
  readonly version: 1
  readonly props: { readonly title?: string }
}
export interface SmartResult {
  readonly ready: boolean
  readonly missing: readonly string[]
  readonly outputs: readonly {
    readonly id: string; readonly label: string; readonly value: number | string | null
    readonly text: string; readonly unit?: string; readonly band?: string; readonly error?: string
  }[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const keys = (v: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(v).every(k => allowed.includes(k))
const bounded = (v: unknown, max = 160): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,49}$/.test(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const ops: Record<SmartOp, readonly [number, number]> = {
  add:[2,12], sub:[2,2], mul:[2,12], div:[2,2], pow:[2,2], mod:[2,2],
  min:[2,12], max:[2,12], abs:[1,1], sqrt:[1,1], ln:[1,1],
  log10:[1,1], exp:[1,1], sin:[1,1], cos:[1,1], tan:[1,1],
  floor:[1,1], ceil:[1,1], round:[1,1], neg:[1,1], pi:[0,0],
  eq:[2,2], neq:[2,2], gt:[2,2], gte:[2,2], lt:[2,2], lte:[2,2],
  and:[2,12], or:[2,12], not:[1,1], if:[3,3],
  days_between:[2,2], add_days:[2,2],
}

function validExpression(
  v: unknown, fieldIds: Set<string>, budget: { remaining: number }, depth = 0,
): v is SmartExpr {
  if (!isObject(v) || depth > 14 || --budget.remaining < 0) return false
  if ('constant' in v) {
    return keys(v, ['constant']) && (num(v.constant) || bounded(v.constant, 100) || typeof v.constant === 'boolean')
  }
  if ('field' in v) return keys(v, ['field']) && id(v.field) && fieldIds.has(v.field)
  if ('today' in v) return keys(v, ['today']) && v.today === true
  if (!keys(v, ['op','args']) || typeof v.op !== 'string' || !(v.op in ops) || !Array.isArray(v.args)) return false
  const arity = ops[v.op as SmartOp]
  if (!arity || v.args.length < arity[0] || v.args.length > arity[1]) return false
  return v.args.every(a => validExpression(a, fieldIds, budget, depth + 1))
}

function validateField(v: unknown, ids: Set<string>): v is SmartField {
  if (!isObject(v) || !keys(v, ['id','label','type','required','description','placeholder','unit','min','max','step','default','options','showWhen'])
    || !id(v.id) || ids.has(v.id) || !bounded(v.label,200)
    || !['number','range','text','textarea','date','time','select','radio','checkbox'].includes(String(v.type))
    || (v.required !== undefined && typeof v.required !== 'boolean')
    || (v.description !== undefined && !bounded(v.description,500))
    || (v.placeholder !== undefined && !bounded(v.placeholder,160))
    || (v.unit !== undefined && !bounded(v.unit,30))
    || (v.min !== undefined && !num(v.min)) || (v.max !== undefined && !num(v.max))
    || (v.step !== undefined && (!num(v.step) || v.step <= 0))
    || (num(v.min) && num(v.max) && v.min > v.max)) return false
  if (v.default !== undefined && !(typeof v.default === 'boolean' || num(v.default) || bounded(v.default,300))) return false
  if (v.showWhen !== undefined && (!isObject(v.showWhen)
    || !keys(v.showWhen, ['field','equals']) || !id(v.showWhen.field)
    || v.showWhen.field === v.id || !ids.has(v.showWhen.field)
    || !['string','number','boolean'].includes(typeof v.showWhen.equals))) return false
  const select = v.type === 'select' || v.type === 'radio'
  if (select !== (v.options !== undefined)) return false
  if (select) {
    if (!Array.isArray(v.options) || v.options.length < 2 || v.options.length > 40) return false
    const values = new Set<string>()
    for (const opt of v.options) {
      if (!isObject(opt) || !keys(opt, ['label','value']) || !bounded(opt.label,160)
        || !(bounded(opt.value,120) || num(opt.value)) || values.has(String(opt.value))) return false
      values.add(String(opt.value))
    }
    if (v.default !== undefined && !v.options.some((o: {value:unknown}) => o.value === v.default)) return false
  }
  if (v.type === 'checkbox' && v.default !== undefined && typeof v.default !== 'boolean') return false
  if ((v.type === 'number' || v.type === 'range') && v.default !== undefined
    && (!num(v.default) || (num(v.min) && v.default < v.min) || (num(v.max) && v.default > v.max))) return false
  if (v.type === 'range' && (!num(v.min) || !num(v.max))) return false
  if ((v.type === 'date' || v.type === 'time' || v.type === 'text' || v.type === 'textarea')
    && v.default !== undefined && !bounded(v.default,300)) return false
  ids.add(v.id)
  return true
}

/** The renderer accepts only this versioned allowlisted contract. */
export function parseSmartForm(v: unknown): SmartFormSpec | null {
  if (!isObject(v) || !keys(v,['component','version','props']) ||
    v.component !== 'smart_form' || v.version !== 1 || !isObject(v.props)) return null
  const p = v.props
  if (!keys(p,['id','title','kind','folder','description','source','tags','fields','outputs'])
    || !id(p.id) || !bounded(p.title,140)
    || !['calculator','scientific','test','scale','survey','form'].includes(String(p.kind))
    || (p.folder !== undefined && (typeof p.folder !== 'string' || !/^[\p{L}0-9 _/-]{1,90}$/u.test(p.folder) || p.folder.includes('..')))
    || (p.description !== undefined && !bounded(p.description,1000))
    || (p.source !== undefined && !bounded(p.source,500))
    || (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length > 12 || !p.tags.every(t => bounded(t,40))))
    || !Array.isArray(p.fields) || p.fields.length < 1 || p.fields.length > 80
    || (p.outputs !== undefined && (!Array.isArray(p.outputs) || p.outputs.length > 18))) return null
  const ids = new Set<string>()
  for (const field of p.fields) if (!validateField(field, ids)) return null
  const outputIds = new Set<string>()
  let budget = {remaining: 350}
  for (const o of p.outputs ?? []) {
    if (!isObject(o) || !keys(o,['id','label','expression','unit','precision','description','bands'])
      || !id(o.id) || ids.has(o.id) || outputIds.has(o.id) || !bounded(o.label,160)
      || (o.unit !== undefined && !bounded(o.unit,40))
      || (o.description !== undefined && !bounded(o.description,500))
      || (o.precision !== undefined && (!Number.isInteger(o.precision) || (o.precision as number) < 0 || (o.precision as number) > 10))
      || !validExpression(o.expression,ids,budget)) return null
    outputIds.add(o.id)
    if (o.bands !== undefined) {
      if (!Array.isArray(o.bands) || o.bands.length < 1 || o.bands.length > 20) return null
      let prev = -Infinity
      for (const band of o.bands) {
        if (!isObject(band) || !keys(band,['max','label']) || !num(band.max)
          || band.max <= prev || !bounded(band.label,180)) return null
        prev = band.max
      }
    }
  }
  return v as unknown as SmartFormSpec
}

export function parseSmartLibrary(v: unknown): SmartLibrarySpec | null {
  return isObject(v) && keys(v,['component','version','props'])
    && v.component === 'smart_form_library' && v.version === 1
    && isObject(v.props) && keys(v.props,['title'])
    && (v.props.title === undefined || bounded(v.props.title,140))
    ? v as unknown as SmartLibrarySpec : null
}

export function localToday(date: Date = new Date()): string {
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,'0')
  return String(y).padStart(4,'0')+'-'+m+'-'+String(date.getDate()).padStart(2,'0')
}
export function initialSmartValues(spec: SmartFormSpec): Record<string, FormValue> {
  const values: Record<string, FormValue> = {}
  for (const f of spec.props.fields) {
    if (f.default !== undefined) values[f.id] = f.default
    else if (f.type === 'checkbox') values[f.id] = false
    else if (f.type === 'range') values[f.id] = f.min ?? 0
  }
  return values
}
export function fieldVisible(field: SmartField, values: Record<string, FormValue>): boolean {
  return field.showWhen === undefined || values[field.showWhen.field] === field.showWhen.equals
}

function dateMillis(x: unknown): number | null {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null
  const [yy,mm,dd] = x.split('-').map(Number)
  if (yy === undefined || mm === undefined || dd === undefined || yy < 1900 || yy > 2200) return null
  const ms = Date.UTC(yy,mm-1,dd), d = new Date(ms)
  return d.getUTCFullYear() === yy && d.getUTCMonth() === mm-1 && d.getUTCDate() === dd ? ms : null
}
type Scalar = string | number | boolean | null
function finite(x: number): number | null { return Number.isFinite(x) && Math.abs(x) <= 1e15 ? x : null }
function calc(expr: SmartExpr, values: Record<string, FormValue>, today: string): Scalar {
  if ('constant' in expr) return expr.constant
  if ('field' in expr) {
    const v = values[expr.field]
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null
  }
  if ('today' in expr) return today
  if (expr.op === 'pi') return Math.PI
  if (expr.op === 'if') {
    const test = calc(expr.args[0]!,values,today)
    return calc(expr.args[test ? 1 : 2]!,values,today)
  }
  if (expr.op === 'and') return expr.args.every(a => calc(a,values,today) === true)
  if (expr.op === 'or') return expr.args.some(a => calc(a,values,today) === true)
  if (expr.op === 'not') return calc(expr.args[0]!,values,today) === false
  const a = expr.args.map(e => calc(e,values,today))
  if (a.some(x => x === null)) return null
  const x = a[0], y = a[1]
  if (expr.op === 'eq') return x === y
  if (expr.op === 'neq') return x !== y
  if (expr.op === 'days_between') {
    const d1 = dateMillis(x), d2 = dateMillis(y)
    return d1 === null || d2 === null ? null : (d2 - d1)/86400000
  }
  if (expr.op === 'add_days') {
    const d = dateMillis(x)
    if (d === null || typeof y !== 'number' || !Number.isInteger(y)) return null
    const final = new Date(d + y*86400000)
    return Number.isNaN(final.getTime()) || final.getUTCFullYear() > 2200 || final.getUTCFullYear() < 1900
      ? null : final.toISOString().slice(0,10)
  }
  if (typeof x !== 'number' || (a.length > 1 && a.some(z => typeof z !== 'number'))) {
    if (['gt','gte','lt','lte'].includes(expr.op) && typeof x === 'string' && typeof y === 'string') {
      if (expr.op === 'gt') return x > y
      if (expr.op === 'gte') return x >= y
      if (expr.op === 'lt') return x < y
      return x <= y
    }
    return null
  }
  const nums = a as number[]
  switch (expr.op) {
    case 'add': return finite(nums.reduce((s,n)=>s+n,0))
    case 'sub': return finite(x - (y as number))
    case 'mul': return finite(nums.reduce((s,n)=>s*n,1))
    case 'div': return y === 0 ? null : finite(x / (y as number))
    case 'pow': return finite(Math.pow(x,y as number))
    case 'mod': return y === 0 ? null : finite(x % (y as number))
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    case 'abs': return Math.abs(x)
    case 'sqrt': return finite(Math.sqrt(x))
    case 'ln': return finite(Math.log(x))
    case 'log10': return finite(Math.log10(x))
    case 'exp': return finite(Math.exp(x))
    case 'sin': return finite(Math.sin(x))
    case 'cos': return finite(Math.cos(x))
    case 'tan': return finite(Math.tan(x))
    case 'floor': return Math.floor(x)
    case 'ceil': return Math.ceil(x)
    case 'round': return Math.round(x)
    case 'neg': return -x
    case 'gt': return x > (y as number)
    case 'gte': return x >= (y as number)
    case 'lt': return x < (y as number)
    case 'lte': return x <= (y as number)
    default: return null
  }
}
function formatted(value: Scalar, precision?: number): string {
  if (value === null) return 'No calculable'
  if (typeof value === 'number') return Number(value.toFixed(precision ?? 2)).toLocaleString('es-DO',{maximumFractionDigits:precision ?? 2})
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value
}
export function calculateSmartForm(spec: SmartFormSpec, values: Record<string, FormValue>, today = localToday()): SmartResult {
  const missing = spec.props.fields.filter(field => {
    if (!fieldVisible(field,values) || field.required === false) return false
    const value = values[field.id]
    if (value === undefined || value === '') return true
    if (field.type === 'number' || field.type === 'range') {
      return typeof value !== 'number' || !Number.isFinite(value)
        || (field.min !== undefined && value < field.min)
        || (field.max !== undefined && value > field.max)
    }
    if (field.type === 'date') return dateMillis(value) === null
    if (field.type === 'select' || field.type === 'radio')
      return !field.options?.some(option => option.value === value)
    return false
  }).map(field => field.id)
  const ready = missing.length === 0
  return {
    ready, missing, outputs: (spec.props.outputs ?? []).map(o => {
      const raw = ready ? calc(o.expression,values,today) : null
      const value = typeof raw === 'boolean' ? (raw ? 'Sí' : 'No') : raw
      const band = typeof raw === 'number' ? o.bands?.find(b => raw <= b.max)?.label : undefined
      return {
        id:o.id, label:o.label, value: typeof value === 'number' || typeof value === 'string' ? value : null,
        text:ready ? formatted(raw,o.precision) : '—',
        ...(o.unit === undefined ? {} : { unit:o.unit }),
        ...(band === undefined ? {} : {band}),
        ...(ready && raw === null ? {error:'Revisa los datos, fechas o el dominio de la fórmula.'} : {}),
      }
    }),
  }
}
