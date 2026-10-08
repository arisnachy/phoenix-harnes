type JsonRecord = Readonly<Record<string, unknown>>

const SUPPORTED_CHART_TYPES = new Set([
  'bar', 'line', 'area', 'scatter', 'pie', 'donut', 'candlestick',
])

const CHART_TYPE_ALIASES: Readonly<Record<string, string>> = {
  candles: 'candlestick',
  candle: 'candlestick',
  ohlc: 'candlestick',
  doughnut: 'donut',
  column: 'bar',
  columns: 'bar',
  spline: 'line',
}

/** Deterministic validation result produced before a visual reaches the renderer. */
export interface VisualQaPreflight {
  readonly valid: boolean
  readonly issues: readonly string[]
}

/** Browser-render audit report used to decide pass, repair, or vision escalation. */
export interface VisualQaReport {
  readonly visualType: string
  readonly chartType?: string
  readonly expectedMarks: number
  readonly renderedMarks: number
  readonly dimensions: { readonly width: number; readonly height: number } | null
  readonly fallbackUsed: boolean
  readonly invalidCoordinates: number
  readonly clipped: boolean
  readonly repairAttempts: number
  readonly verdict: 'pass' | 'fail'
  readonly issues: readonly string[]
  readonly needsVisionReview: boolean
}

/** Result of one bounded deterministic visual-spec repair attempt. */
export interface VisualRepairResult {
  readonly spec: JsonRecord
  readonly changed: boolean
  readonly reason?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function visualType(spec: JsonRecord): string {
  const explicit = text(spec.visualType) ?? text(spec.kind) ?? text(spec.type)
  if (explicit !== undefined) return explicit.toLowerCase()
  if (text(spec.chartType) !== undefined || Array.isArray(spec.series)) return 'chart'
  if (Array.isArray(spec.columns) && Array.isArray(spec.rows)) return 'table'
  if (Array.isArray(spec.metrics)) return 'metrics'
  if (Array.isArray(spec.timeline)) return 'timeline'
  if (Array.isArray(spec.cards)) return 'cards'
  if (Array.isArray(spec.progress)) return 'progress'
  return 'visual'
}

function chartType(spec: JsonRecord): string | undefined {
  const raw = text(spec.chartType)?.toLowerCase()
  if (raw === undefined) return undefined
  return CHART_TYPE_ALIASES[raw] ?? raw
}

function candlestickRows(spec: JsonRecord): readonly unknown[] {
  if (Array.isArray(spec.candles)) return spec.candles
  if (!isRecord(spec.data)) return []
  return Array.isArray(spec.data.candles) ? spec.data.candles : []
}

function chartRows(spec: JsonRecord): readonly unknown[] {
  if (Array.isArray(spec.data)) return spec.data
  if (Array.isArray(spec.rows)) return spec.rows
  return []
}

function validateCandlesticks(spec: JsonRecord, issues: string[]): void {
  const rows = candlestickRows(spec)
  if (rows.length === 0) {
    issues.push('candlestick-no-data')
    return
  }

  for (const [index, value] of rows.entries()) {
    if (!isRecord(value)) {
      issues.push(`candlestick-row-${index}-not-object`)
      continue
    }
    const open = value.open
    const high = value.high
    const low = value.low
    const close = value.close
    if (!finite(open) || !finite(high) || !finite(low) || !finite(close)) {
      issues.push(`candlestick-row-${index}-invalid-number`)
      continue
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      issues.push(`candlestick-row-${index}-invalid-ohlc`)
    }
  }
}

function validateGenericChart(spec: JsonRecord, issues: string[]): void {
  const rows = chartRows(spec)
  if (rows.length === 0) {
    issues.push('chart-no-data')
    return
  }
  if (!rows.some(isRecord)) issues.push('chart-data-not-records')

  if (Array.isArray(spec.series)) {
    const series = spec.series.filter(isRecord)
    if (series.length === 0) issues.push('chart-empty-series')
    for (const [index, item] of series.entries()) {
      const key = text(item.dataKey) ?? text(item.key) ?? text(item.id)
      if (key === undefined) issues.push(`chart-series-${index}-missing-key`)
    }
  }
}

function validateCollection(
  spec: JsonRecord,
  keys: readonly string[],
  issue: string,
  issues: string[],
): void {
  const collection = keys
    .map(key => spec[key])
    .find(Array.isArray)
  if (!Array.isArray(collection) || collection.length === 0) issues.push(issue)
}

/** Resolve both common table encodings without losing object-shaped row cells. */
export function projectVisualTable(spec: JsonRecord): {
  readonly columns: readonly string[]
  readonly rows: readonly (readonly unknown[])[]
} | undefined {
  const source = Array.isArray(spec.rows) ? spec.rows : Array.isArray(spec.data) ? spec.data : undefined
  if (source === undefined) return undefined
  const first = source.find(isRecord)
  const columns = Array.isArray(spec.columns)
    && spec.columns.every(column => typeof column === 'string' && column.trim().length > 0)
    ? spec.columns as string[]
    : first === undefined ? [] : Object.keys(first).slice(0, 12)
  if (columns.length === 0) return undefined
  const normalize = (key: string): string => key.normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '')
  const rows = source.map((entry): readonly unknown[] => {
    if (Array.isArray(entry)) return columns.map((_, index) => entry[index])
    if (!isRecord(entry)) return columns.map(() => undefined)
    const keys = Object.keys(entry)
    return columns.map(column => {
      if (Object.hasOwn(entry, column)) return entry[column]
      const key = keys.find(candidate => normalize(candidate) === normalize(column))
      return key === undefined ? undefined : entry[key]
    })
  })
  return { columns, rows }
}

/** Only meaningful cells count as actual table data; blank placeholders are not results. */
export function populatedVisualTableRows(spec: JsonRecord): readonly (readonly unknown[])[] {
  const table = projectVisualTable(spec)
  return table?.rows.filter(row => row.some(cell =>
    cell !== null && cell !== undefined && (typeof cell !== 'string' || cell.trim().length > 0))) ?? []
}

/**
 * Validate a declarative Phoenix visual before allowing it into the renderer.
 * The check is intentionally deterministic and never calls a model.
 * @param spec - Declarative visual specification to validate.
 * @returns Validation status and deterministic issue identifiers.
 */
export function preflightVisualSpec(spec: JsonRecord): VisualQaPreflight {
  const issues: string[] = []
  const kind = visualType(spec)

  if (kind === 'chart') {
    const requested = chartType(spec) ?? 'bar'
    if (!SUPPORTED_CHART_TYPES.has(requested)) issues.push(`unsupported-chart-type:${requested}`)
    if (requested === 'candlestick') validateCandlesticks(spec, issues)
    else validateGenericChart(spec, issues)
  } else if (kind === 'table' || (kind === 'visual' && Array.isArray(spec.columns)
    && (Array.isArray(spec.rows) || Array.isArray(spec.data)))) {
    const table = projectVisualTable(spec)
    if (table === undefined) issues.push('table-no-rows')
    else if (populatedVisualTableRows(spec).length === 0) issues.push('table-empty-data')
  } else if (kind === 'metrics') {
    validateCollection(spec, ['metrics', 'data'], 'metrics-no-data', issues)
  } else if (kind === 'timeline') {
    validateCollection(spec, ['timeline', 'items', 'data'], 'timeline-no-data', issues)
  } else if (kind === 'cards') {
    validateCollection(spec, ['cards', 'items', 'data'], 'cards-no-data', issues)
  } else if (kind === 'progress') {
    validateCollection(spec, ['progress', 'items', 'data'], 'progress-no-data', issues)
  }

  return { valid: issues.length === 0, issues }
}

function withChartType(spec: JsonRecord, value: string): JsonRecord {
  return { ...spec, visualType: 'chart', chartType: value }
}

function labelsValuesRepair(spec: JsonRecord): JsonRecord | undefined {
  const labels = spec.labels
  const values = spec.values
  if (!Array.isArray(labels) || !Array.isArray(values)) return undefined
  const rows = labels.map((label, index) => {
    const value: unknown = values[index]
    return {
      label: typeof label === 'string' || typeof label === 'number' ? String(label) : String(index + 1),
      value: finite(value) ? value : 0,
    }
  })
  return {
    ...spec,
    visualType: 'chart',
    chartType: chartType(spec) ?? 'bar',
    xKey: 'label',
    series: [{ dataKey: 'value', label: text(spec.seriesName) ?? text(spec.label) ?? 'Value' }],
    data: rows,
  }
}

function chartJsRepair(spec: JsonRecord): JsonRecord | undefined {
  const payload = isRecord(spec.data) ? spec.data : undefined
  if (payload === undefined || !Array.isArray(payload.labels) || !Array.isArray(payload.datasets)) return undefined
  const datasets = payload.datasets.filter(isRecord)
  if (datasets.length === 0) return undefined
  const series = datasets.map((dataset, index) => ({
    dataKey: `series${index + 1}`,
    label: text(dataset.label) ?? `Series ${index + 1}`,
  }))
  const rows = payload.labels.map((label, rowIndex) => {
    const row: Record<string, unknown> = {
      label: typeof label === 'string' || typeof label === 'number' ? String(label) : String(rowIndex + 1),
    }
    for (const [index, dataset] of datasets.entries()) {
      if (!Array.isArray(dataset.data)) continue
      const value: unknown = dataset.data[rowIndex]
      if (finite(value)) row[`series${index + 1}`] = value
    }
    return row
  })
  return {
    ...spec,
    visualType: 'chart',
    chartType: chartType(spec) ?? 'bar',
    xKey: 'label',
    series,
    data: rows,
  }
}

/**
 * Apply one bounded, deterministic repair pass. Callers may invoke at most twice.
 * @param spec - Declarative visual specification to repair.
 * @param attempt - Bounded repair pass number.
 * @returns Repaired specification plus whether and why it changed.
 */
export function repairVisualSpec(spec: JsonRecord, attempt: 1 | 2): VisualRepairResult {
  const kind = visualType(spec)
  if (kind !== 'chart') return { spec, changed: false }

  const requested = text(spec.chartType)?.toLowerCase()
  const aliased = requested === undefined ? undefined : CHART_TYPE_ALIASES[requested]
  if (attempt === 1 && aliased !== undefined && aliased !== requested) {
    return { spec: withChartType(spec, aliased), changed: true, reason: 'normalize-chart-type' }
  }

  const nested = isRecord(spec.data) ? spec.data : undefined
  if (attempt === 1 && nested !== undefined) {
    if ((chartType(spec) === 'candlestick' || Array.isArray(nested.candles)) && Array.isArray(nested.candles)) {
      return {
        spec: { ...spec, visualType: 'chart', chartType: 'candlestick', candles: nested.candles },
        changed: true,
        reason: 'lift-nested-candles',
      }
    }
    for (const key of ['rows', 'points', 'items'] as const) {
      const value = nested[key]
      if (Array.isArray(value)) {
        return {
          spec: { ...spec, visualType: 'chart', data: value },
          changed: true,
          reason: `lift-nested-${key}`,
        }
      }
    }
  }

  if (attempt === 1) {
    const repaired = labelsValuesRepair(spec)
    if (repaired !== undefined) return { spec: repaired, changed: true, reason: 'normalize-labels-values' }
  }

  if (attempt === 2) {
    const repaired = chartJsRepair(spec)
    if (repaired !== undefined) return { spec: repaired, changed: true, reason: 'normalize-chartjs' }

    if (nested !== undefined) {
      const candidate = Object.values(nested).find(value => Array.isArray(value) && value.some(isRecord))
      if (Array.isArray(candidate)) {
        const first = candidate.find(isRecord)
        const looksOhlc = first !== undefined
          && finite(first.open) && finite(first.high) && finite(first.low) && finite(first.close)
        return {
          spec: looksOhlc
            ? { ...spec, visualType: 'chart', chartType: 'candlestick', candles: candidate }
            : { ...spec, visualType: 'chart', chartType: chartType(spec) ?? 'bar', data: candidate },
          changed: true,
          reason: looksOhlc ? 'infer-ohlc-array' : 'infer-record-array',
        }
      }
    }

    const rows = chartRows(spec).filter(isRecord)
    const first = rows[0]
    if (first !== undefined && chartType(spec) === undefined) {
      const looksOhlc = finite(first.open) && finite(first.high) && finite(first.low) && finite(first.close)
      return {
        spec: looksOhlc
          ? { ...spec, visualType: 'chart', chartType: 'candlestick', candles: rows }
          : { ...spec, visualType: 'chart', chartType: 'bar' },
        changed: true,
        reason: looksOhlc ? 'infer-candlestick' : 'infer-bar',
      }
    }
  }

  return { spec, changed: false }
}

function invalidSvgCoordinates(root: HTMLElement): number {
  let invalid = 0
  for (const element of root.querySelectorAll('svg *')) {
    for (const name of ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'points', 'd']) {
      const raw = element.getAttribute(name)
      if (raw !== null && /(?:NaN|Infinity)/u.test(raw)) invalid += 1
    }
  }
  return invalid
}

function clippingState(root: HTMLElement): boolean {
  if (root.clientWidth <= 0 || root.clientHeight <= 0) return false
  const style = getComputedStyle(root)
  const clippedX = root.scrollWidth > root.clientWidth + 8 && style.overflowX === 'hidden'
  const clippedY = root.scrollHeight > root.clientHeight + 8 && style.overflowY === 'hidden'
  return clippedX || clippedY
}

/**
 * Audit what the browser actually rendered. This is deliberately DOM-based so
 * passing schema validation does not count as visual success by itself.
 * @param root - Root element containing the rendered visual.
 * @param spec - Declarative visual specification that produced the render.
 * @param repairAttempts - Number of deterministic repair passes already used.
 * @returns Render audit measurements, issues, and escalation verdict.
 */
export function auditRenderedVisual(
  root: HTMLElement,
  spec: JsonRecord,
  repairAttempts: number,
): VisualQaReport {
  const issues: string[] = []
  const section = root.querySelector<HTMLElement>('[data-phoenix-visual-kind]')
  const fallbackUsed = root.querySelector('[data-phoenix-visual-fallback="true"]') !== null
  const expectedMarks = Number(section?.dataset.phoenixExpectedMarks ?? 0) || 0
  const renderedMarks = root.querySelectorAll('[data-phoenix-visual-mark]').length
  const invalidCoordinates = invalidSvgCoordinates(root)
  const chart = chartType(spec)
  const kind = visualType(spec)

  if (fallbackUsed) issues.push('renderer-fallback-used')
  if (section === null) issues.push('renderer-surface-missing')
  if (invalidCoordinates > 0) issues.push('invalid-render-coordinates')
  if (expectedMarks > 0 && renderedMarks !== expectedMarks) {
    issues.push(`mark-count-mismatch:${renderedMarks}/${expectedMarks}`)
  }

  if ((kind === 'table' || (kind === 'visual' && Array.isArray(spec.columns)))
    && section !== null && section.dataset.phoenixVisualKind === 'table') {
    const expectedRows = populatedVisualTableRows(spec).length
    const renderedRows = section.querySelectorAll('tbody tr').length
    if (expectedRows === 0) issues.push('table-empty-data')
    if (renderedRows !== expectedRows) issues.push(`table-row-count-mismatch:${renderedRows}/${expectedRows}`)
    if (Array.from(section.querySelectorAll('tbody tr')).some(row =>
      !Array.from(row.querySelectorAll('td')).some(cell => (cell.textContent ?? '').trim().length > 0))) {
      issues.push('table-blank-rendered-row')
    }
  }

  if (kind === 'chart' && section !== null) {
    const visual = section.querySelector('svg,canvas')
    if (visual === null) issues.push('chart-surface-missing')
    if (chart !== 'pie' && chart !== 'donut' && section.querySelectorAll('text').length === 0) {
      issues.push('chart-labels-missing')
    }
  }

  let dimensions: VisualQaReport['dimensions'] = null
  const clientRects = root.getClientRects()
  if (clientRects.length > 0) {
    const rect = root.getBoundingClientRect()
    dimensions = { width: Math.round(rect.width), height: Math.round(rect.height) }
    if (rect.width < 24 || rect.height < 24) issues.push('render-dimensions-too-small')
  }

  const clipped = clippingState(root)
  if (clipped) issues.push('visual-content-clipped')

  const verdict = issues.length === 0 ? 'pass' : 'fail'
  return {
    visualType: kind,
    ...(chart === undefined ? {} : { chartType: chart }),
    expectedMarks,
    renderedMarks,
    dimensions,
    fallbackUsed,
    invalidCoordinates,
    clipped,
    repairAttempts,
    verdict,
    issues,
    needsVisionReview: verdict === 'fail',
  }
}

/**
 * Publish QA telemetry without coupling the renderer to a host transport.
 * @param report - Completed visual QA report to publish to browser listeners.
 */
export function emitVisualQaReport(report: VisualQaReport): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('phoenix:visual-qa', { detail: report }))
  if (report.needsVisionReview) {
    window.dispatchEvent(new CustomEvent('phoenix:visual-qa-escalation', { detail: report }))
  }
}
