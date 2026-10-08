/**
 * A small, deterministic chart admission path shared by phoenix_visualize.
 * Nothing here consults the model, network, browser or HARDNESS judge.
 * Rejects empty/invalid chart data before publishing a visual artifact.
 */
type Visual = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const allowed = new Set(['bar', 'line', 'area', 'scatter', 'pie', 'donut', 'candlestick'])
const aliases: Record<string, string> = {
  spline: 'line', column: 'bar', columns: 'bar', doughnut: 'donut',
  candles: 'candlestick', ohlc: 'candlestick',
}
const sample = [38, 51, 47, 65, 58, 73, 79]

/** Always explicitly label synthetic figures; never mix them with real-world results. */
function syntheticSeries(spec: Visual, chartType: string): Visual {
  return {
    ...spec, visualType: 'chart', chartType, simulated: true,
    description: 'Datos ficticios · ejemplo demostrativo, no mediciones reales',
    xKey: 'label',
    series: [{ dataKey: 'value', label: 'Valor ficticio' }],
    data: sample.map((value, index) => ({
      label: ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][index], value,
    })),
  }
}

function fromLabels(spec: Visual): Visual | undefined {
  if (!Array.isArray(spec.labels) || !Array.isArray(spec.values)
    || spec.labels.length < 1 || spec.labels.length !== spec.values.length
    || !spec.values.every(finite)) return undefined
  const labels = spec.labels as unknown[]
  const values = spec.values
  return {
    ...spec, visualType: 'chart', xKey: 'label',
    series: [{ dataKey: 'value', label: nonempty(spec.seriesName) ? spec.seriesName : 'Valor' }],
    data: labels.map((label, index) => ({
      label: String(label), value: values[index],
    })),
  }
}

function fromChartJs(spec: Visual): Visual | undefined {
  const payload = isRecord(spec.data) ? spec.data : undefined
  if (payload === undefined || !Array.isArray(payload.labels) || !Array.isArray(payload.datasets)
    || payload.labels.length === 0 || payload.datasets.length === 0 || payload.datasets.length > 8) return undefined
  const labels = payload.labels as unknown[]
  const datasets = payload.datasets
  if (!datasets.every(dataset => isRecord(dataset) && Array.isArray(dataset.data)
    && dataset.data.length === labels.length && dataset.data.every(finite))) return undefined
  const series = datasets.map((dataset, index) => ({
    dataKey: `series${index+1}`,
    label: isRecord(dataset) && nonempty(dataset.label) ? dataset.label : `Serie ${index+1}`,
  }))
  const data = labels.map((label, rowIndex) => {
    const row: Record<string, unknown> = { label: String(label) }
    for (const [index, dataset] of datasets.entries()) {
      if (isRecord(dataset) && Array.isArray(dataset.data)) row[`series${index+1}`] = dataset.data[rowIndex]
    }
    return row
  })
  return { ...spec, visualType: 'chart', xKey: 'label', series, data }
}

function fromPairs(spec: Visual): Visual | undefined {
  if (!Array.isArray(spec.data) || spec.data.length === 0
    || !spec.data.every(row => Array.isArray(row) && row.length === 2
      && (nonempty(row[0]) || finite(row[0])) && finite(row[1]))) return undefined
  return {
    ...spec, visualType: 'chart', xKey: 'label',
    series: [{ dataKey: 'value', label: 'Valor' }],
    data: spec.data.map((entry) => {
      const pair = entry as [string | number, number]
      return { label: String(pair[0]), value: pair[1] }
    }),
  }
}

export interface VisualChartAdmission {
  readonly spec?: Visual
  readonly error?: string
}

const example = 'Para una línea: {"visualType":"chart","chartType":"line","xKey":"mes",'
  + '"series":[{"dataKey":"valor","label":"Valor"}],'
  + '"data":[{"mes":"Ene","valor":10},{"mes":"Feb","valor":17}]}. '
  + 'Para un ejemplo ficticio sin datos proporciona {"visualType":"chart","chartType":"line","demo":true}.'

/**
 * Handle the common chart formats (canonical, paired points, labels/values,
 * Chart.js) plus an explicitly requested zero-cost synthetic example.
 * Other visual types are returned untouched; existing MCP truth checks stay intact.
 */
export function admitVisualChart(spec: Visual): VisualChartAdmission {
  if (spec.visualType !== 'chart' && !(spec.visualType === 'visual' && nonempty(spec.chartType))) return { spec }
  const raw = nonempty(spec.chartType) ? spec.chartType.toLowerCase().trim() : 'bar'
  const chartType = aliases[raw] ?? raw
  if (!allowed.has(chartType)) return { error: `Tipo de gráfica no admitido: ${raw}. ${example}` }
  if (chartType === 'candlestick') return { spec: { ...spec, chartType, visualType: 'chart' } }
  const hasData = (Array.isArray(spec.data) && spec.data.length > 0)
    || Array.isArray(spec.rows) && spec.rows.length > 0
    || Array.isArray(spec.labels) && spec.labels.length > 0
    || isRecord(spec.data)
  if (!hasData && spec.demo === true) return { spec: syntheticSeries(spec, chartType) }
  const normalized: Visual = { ...spec, chartType }
  const fromOther = fromLabels(normalized) ?? fromChartJs(normalized) ?? fromPairs(normalized)
  const next = fromOther ?? (Array.isArray(normalized.data) ? normalized
    : Array.isArray(normalized.rows) ? { ...normalized, data: normalized.rows } : normalized)
  const rows: unknown[] = Array.isArray(next.data) ? next.data : []
  if (rows.length < ((chartType === 'line' || chartType === 'area') ? 2 : 1)
    || rows.length > 80 || !rows.every(isRecord)) {
    return { error: `La gráfica necesita filas representables y datos numéricos. ${example}` }
  }
  const first = rows[0] as Record<string, unknown>
  const xKey = nonempty(next.xKey) ? next.xKey
    : nonempty(next.categoryKey) ? next.categoryKey
      : 'label' in first ? 'label'
        : 'x' in first ? 'x' : 'label'
  const inferred = Object.entries(first)
    .filter(([key,value]) => key !== xKey && finite(value))
    .slice(0,8)
    .map(([key])=>({ dataKey:key, label:key }))
  const series = Array.isArray(next.series) && next.series.length > 0 ? next.series : inferred
  if (!Array.isArray(series) || series.length === 0 || series.length > 8
    || !series.every(item => isRecord(item) && (nonempty(item.dataKey) || nonempty(item.key) || nonempty(item.id)))) {
    return { error: `La gráfica no tiene series numéricas utilizables. ${example}` }
  }
  const keys = series.map(item => isRecord(item) ? item.dataKey ?? item.key ?? item.id : undefined)
  if (!rows.every(row=>isRecord(row) && keys.every(key => typeof key === 'string' && finite(row[key])))) {
    return { error: `Una o más filas carecen de números válidos para las series. ${example}` }
  }
  const chart = { ...next, chartType, visualType:'chart', xKey,
    series: series.map((item,index) => {
      const object = item as Record<string,unknown>
      return { dataKey: String(keys[index]), label: nonempty(object.label) ? object.label : String(keys[index]) }
    }), data: rows }
  return { spec: chart }
}
