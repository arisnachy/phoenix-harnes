import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { PhoenixUiIcon } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './InteractiveUi.module.css'

/** Bounded in-chat spreadsheet with a stable key for browser-local draft recovery. */
export interface SpreadsheetSpec {
  readonly component: 'spreadsheet'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly columns: readonly string[]
    readonly rows: readonly (readonly string[])[]
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const keys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every(key => allowed.includes(key))

/** Accept only bounded tabular values. Formulas are parsed as data, never evaluated as JS. */
export function parseSpreadsheet(value: unknown): SpreadsheetSpec | null {
  if (!isRecord(value) || !keys(value, ['component', 'version', 'props'])
    || value.component !== 'spreadsheet' || value.version !== 1 || !isRecord(value.props)) return null
  const p = value.props
  const columns = p.columns
  if (!keys(p, ['id', 'title', 'columns', 'rows'])
    || typeof p.id !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(p.id)
    || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 120
    || !Array.isArray(columns) || columns.length < 1 || columns.length > 16
    || !columns.every(c => typeof c === 'string' && c.trim() && c.length <= 60)
    || !Array.isArray(p.rows) || p.rows.length > 200
    || !p.rows.every(row => Array.isArray(row) && row.length === columns.length
      && row.every(cell => typeof cell === 'string' && cell.length <= 300))) return null
  return value as unknown as SpreadsheetSpec
}

const columnLetter = (index: number): string => String.fromCharCode(65 + index)
const reference = (token: string): [number, number] | null => {
  const match = /^([A-P])([1-9]\d*)$/i.exec(token)
  if (!match) return null
  return [Number(match[2]) - 2, match[1]!.toUpperCase().charCodeAt(0) - 65]
}
const numberOrZero = (raw: string): number => {
  if (raw.trim() === '') return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Formula grammar: arithmetic, parentheses, references and SUM/AVERAGE/MIN/MAX with cell ranges. */
export function evaluateSheetCell(
  rows: readonly (readonly string[])[], row: number, col: number,
  ancestors = new Set<string>(), budget = { remaining: 2000 },
): number | string {
  if (row < 0 || row >= rows.length || col < 0 || col >= (rows[row]?.length ?? 0)) return '#REF!'
  if (--budget.remaining < 0 || ancestors.size > 24) return '#LIMIT!'
  const address = String(row) + ':' + String(col)
  if (ancestors.has(address)) return '#CYCLE!'
  const raw = rows[row]?.[col] ?? ''
  if (!raw.startsWith('=')) return numberOrZero(raw)
  ancestors.add(address)
  try {
    const formula = raw.slice(1)
    const tokens: string[] = []
    const tokenizer = /\s*([A-Za-z]+\d+|[A-Za-z]+|\d+(?:\.\d+)?|[()+\-*/,:])\s*/gy
    let position = 0
    while (position < formula.length && tokens.length < 160) {
      tokenizer.lastIndex = position
      const match = tokenizer.exec(formula)
      if (match === null || match.index !== position) return '#ERR!'
      tokens.push(match[1]!)
      position = tokenizer.lastIndex
    }
    if (position !== formula.length || tokens.length === 0) return '#ERR!'
    let i = 0
    const peek = (): string | undefined => tokens[i]
    const take = (token: string): boolean => {
      if (peek() !== token) return false
      i++
      return true
    }
    const required = (token: string): void => {
      if (!take(token)) throw new Error('#ERR!')
    }
    const cell = (addressToken: string): number => {
      const index = reference(addressToken)
      if (index === null) throw new Error('#REF!')
      const result = evaluateSheetCell(rows, index[0], index[1], ancestors, budget)
      if (typeof result === 'string') throw new Error(result)
      return result
    }
    const arg = (): number[] => {
      const first = peek()
      const second = tokens[i + 1]
      const third = tokens[i + 2]
      if (first && second === ':' && third && reference(first) && reference(third)) {
        i += 3
        const from = reference(first)!
        const to = reference(third)!
        const count = (Math.abs(to[0] - from[0]) + 1) * (Math.abs(to[1] - from[1]) + 1)
        if (count > 800) throw new Error('#LIMIT!')
        const values: number[] = []
        for (let r = Math.min(from[0], to[0]); r <= Math.max(from[0], to[0]); r++)
          for (let c = Math.min(from[1], to[1]); c <= Math.max(from[1], to[1]); c++)
            values.push(cell(columnLetter(c) + String(r + 2)))
        return values
      }
      return [expression()]
    }
    const primary = (): number => {
      if (take('+')) return primary()
      if (take('-')) return -primary()
      if (take('(')) {
        const n = expression()
        required(')')
        return n
      }
      const value = peek()
      if (value === undefined) throw new Error('#ERR!')
      if (/^\d/.test(value)) {
        i++
        return Number(value)
      }
      if (/^[A-Za-z]+\d+$/.test(value)) {
        i++
        return cell(value)
      }
      if (/^(SUM|AVERAGE|MIN|MAX)$/i.test(value)) {
        i++
        required('(')
        const values = [...arg()]
        while (take(',')) values.push(...arg())
        required(')')
        if (values.length === 0) throw new Error('#ERR!')
        const fn = value.toUpperCase()
        if (fn === 'SUM') return values.reduce((a, b) => a + b, 0)
        if (fn === 'AVERAGE') return values.reduce((a, b) => a + b, 0) / values.length
        return fn === 'MIN' ? Math.min(...values) : Math.max(...values)
      }
      throw new Error('#ERR!')
    }
    const term = (): number => {
      let n = primary()
      while (peek() === '*' || peek() === '/') {
        const operator = tokens[i++]!
        const right = primary()
        if (operator === '/' && right === 0) throw new Error('#DIV/0!')
        n = operator === '*' ? n * right : n / right
      }
      return n
    }
    const expression = (): number => {
      let n = term()
      while (peek() === '+' || peek() === '-') {
        const operator = tokens[i++]!
        const right = term()
        n = operator === '+' ? n + right : n - right
      }
      return n
    }
    const result = expression()
    return i === tokens.length && Number.isFinite(result) ? result : '#ERR!'
  } catch (error) {
    return error instanceof Error && /^#[A-Z0-9/!]+$/.test(error.message) ? error.message : '#ERR!'
  } finally {
    ancestors.delete(address)
  }
}

/** CSV format with quoted newlines, double-quotes and commas. */
export function parseSheetCsv(csv: string, width: number): string[][] | null {
  if (csv.length > 2_000_000) return null
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quote = false
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (quote) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quote = false
      else field += ch
    } else if (ch === '"') {
      if (field !== '') return null
      quote = true
    } else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') {
      row.push(field.replace(/\r$/, '')); field = ''
      if (rows.length >= 201) return null
      rows.push(row); row = []
    } else field += ch
    if (field.length > 300) return null
  }
  if (quote) return null
  if (field.length > 0 || row.length > 0) { row.push(field.replace(/\r$/, '')); rows.push(row) }
  if (!rows.every(line => line.length === width && line.every(cell => cell.length <= 300))) return null
  return rows
}
const csvEscape = (cell: string): string => {
  // CSV is not an executable spreadsheet format; mitigate formula injection upon opening in Excel.
  const safe = /^[=+\-@]/.test(cell) && !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cell)
    ? "'" + cell : cell
  return '"' + safe.replace(/"/g, '""') + '"'
}
export function exportSheetCsv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  return [columns, ...rows].map(line => line.map(csvEscape).join(',')).join('\r\n')
}

/** Editable grid with local recalculation, CSV import/export, undo and local draft recovery. */
export function SpreadsheetSurface({ spec }: { readonly spec: SpreadsheetSpec }): ReactNode {
  const [rows, setRows] = useState<string[][]>(() => spec.props.rows.map(row => [...row]))
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState('')
  const [undo, setUndo] = useState<string[][][]>([])
  const [error, setError] = useState('')
  const key = 'phoenix:sheet:' + spec.props.id
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      if (Array.isArray(saved) && saved.length <= 200 && saved.every(row => Array.isArray(row)
        && row.length === spec.props.columns.length && row.every(cell => typeof cell === 'string' && cell.length <= 300)))
        setRows(saved as string[][])
    } catch { /* corrupted or unavailable browser storage: use declared initial rows */ }
    setReady(true)
  }, [key, spec.props.columns.length])
  useEffect(() => {
    if (!ready) return
    try { localStorage.setItem(key, JSON.stringify(rows)) }
    catch { /* private or full storage leaves editing functional */ }
  }, [ready, key, rows])
  const computed = useMemo(() => rows.map((row, r) => row.map((v, c) =>
    v.startsWith('=') ? evaluateSheetCell(rows, r, c) : v)), [rows])
  const change = (next: string[][]): void => {
    setUndo(old => [...old.slice(-19), rows.map(r => [...r])])
    setRows(next)
    setError('')
  }
  const update = (r: number, c: number, value: string): void => {
    if (value.length > 300) return
    change(rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? value : cell) : [...row]))
  }
  const download = (): void => {
    const blob = new Blob([exportSheetCsv(spec.props.columns, rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = spec.props.id + '.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const importCsv = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (file.size > 2_000_000) { setError('El CSV supera el límite de 2 MB.'); return }
    void file.text().then((content) => {
      const parsed = parseSheetCsv(content, spec.props.columns.length)
      if (!parsed) { setError('CSV inválido o columnas incompatibles.'); return }
      const body = parsed[0]?.every((cell, index) => cell === spec.props.columns[index])
        ? parsed.slice(1) : parsed
      if (body.length > 200) { setError('El límite es de 200 filas.'); return }
      change(body)
    }).catch(() =>{  setError('No se pudo leer el archivo.') })
  }
  return <section className={css.surface} data-generative-ui="spreadsheet">
    <header className={css.heading}><PhoenixUiIcon name="table" />
      <div><h3>{spec.props.title}</h3><p>Hoja editable · fórmulas en tiempo real</p></div></header>
    <div className={css.sheetScroll} role="region" aria-label={spec.props.title} tabIndex={0}>
      <table className={css.sheet}>
        <thead><tr><th scope="col">#</th>{spec.props.columns.map((label, c) =>
          <th key={c} scope="col">{columnLetter(c)} · {label}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}><th scope="row">{r + 2}</th>
          {row.map((cell, c) => {
            const address = r + ':' + c
            return <td key={c}>
              <input aria-label={columnLetter(c) + String(r + 2)}
                value={active === address || !cell.startsWith('=') ? cell : String(computed[r]?.[c] ?? '')}
                title={cell.startsWith('=') ? cell : undefined}
                onFocus={() =>{  setActive(address) }} onBlur={() =>{  setActive('') }}
                onChange={(event) =>{  update(r, c, event.currentTarget.value) }} />
            </td>
          })}</tr>)}</tbody>
      </table>
    </div>
    {error && <p role="alert" className={css.error}>{error}</p>}
    <div className={css.actions}>
      <button type="button" disabled={rows.length >= 200} onClick={() =>{
        change([...rows.map(row => [...row]), spec.props.columns.map(() => '')]) }}>
        <PhoenixUiIcon name="plus" size={15} /> Fila
      </button>
      <button type="button" disabled={undo.length === 0} onClick={() => {
        const prev = undo[undo.length - 1]
        if (!prev) return
        setRows(prev)
        setUndo(current => current.slice(0, -1))
      }}><PhoenixUiIcon name="reset" size={15} /> Deshacer</button>
      <label className={css.fileButton}><PhoenixUiIcon name="file" size={15}/> Importar CSV
        <input type="file" accept=".csv,text/csv" onChange={importCsv} /></label>
      <button type="button" onClick={download}><PhoenixUiIcon name="download" size={15} /> CSV</button>
    </div>
    <p className={css.disclaimer}>Fórmulas permitidas: referencias A2:P201, + − × ÷, SUM, AVERAGE, MIN, MAX.
      Los cambios se guardan solo en este navegador. CSV no conserva las fórmulas como Excel;
      importar/exportar XLSX requiere el motor de libros de trabajo.</p>
  </section>
}
