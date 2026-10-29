/**
 * Primary-source annual health indicators from the official World Bank Indicators API v2.
 * A missing observation remains null; metadata and provenance are not replaced by model inference.
 */
import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Published World Bank indicator codes and display units; no model-estimated values. */
export const HEALTH_INDICATORS = {
  'SP.DYN.IMRT.IN': { label: 'Mortalidad infantil', unit: 'muertes por 1.000 nacidos vivos' },
  'SH_UHC_SCI': { label: 'Índice de cobertura de servicios de salud esenciales (UHC)', unit: 'índice de 0 a 100' },
  'SH.DYN.MORT': { label: 'Mortalidad de menores de cinco años', unit: 'muertes por 1.000 nacidos vivos' },
  'SH.XPD.CHEX.GD.ZS': { label: 'Gasto corriente en salud', unit: 'porcentaje del PIB' },
  'SH.XPD.OOPC.CH.ZS': { label: 'Gasto de bolsillo en salud', unit: 'porcentaje del gasto corriente en salud' },
  'SH.MED.PHYS.ZS': { label: 'Médicos disponibles', unit: 'médicos por 1.000 habitantes' },
} as const

type HealthIndicator = keyof typeof HEALTH_INDICATORS
type Observation = {
  year: number
  value: number | null
  status: string | null
  footnote: string | null
}
type SeriesOutcome = {
  status: 'ok' | 'partial' | 'empty' | 'unavailable'
  provider: string
  sourceUrl: string
  retrievedAt: string
  country: string
  indicator: string
  label: string
  unit: string
  observations: Observation[]
  missingYears: number[]
  latestAvailableYear: number | null
  warnings: string[]
}

/**
 * Retrieve a verified provider response, preserving sparse and unavailable years.
 * @param indicator - whitelisted published indicator code.
 * @param country - ISO country code, default Dominican Republic.
 * @param startYear - inclusive first year.
 * @param endYear - inclusive last year.
 * @param request - injectable HTTP adapter for test isolation.
 * @param signal - caller cancellation.
 * @returns dated values, explicit missing years, units and source URL.
 */
export async function fetchWorldBankHealthSeries(
  indicator: string,
  country = 'DOM',
  startYear = 2015,
  endYear = 2025,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SeriesOutcome> {
  if (!Object.hasOwn(HEALTH_INDICATORS, indicator)) {
    throw new ToolArgsError(['Indicador no habilitado; consulta HEALTH_INDICATORS.'])
  }
  if (!/^[A-Za-z]{2,3}$/u.test(country)
    || !Number.isInteger(startYear) || !Number.isInteger(endYear)
    || startYear < 1950 || endYear > 2100 || startYear > endYear || endYear - startYear > 34) {
    throw new ToolArgsError(['País ISO de 2–3 letras y rango de 1–35 años entre 1950 y 2100.'])
  }
  const code = indicator as HealthIndicator
  const countryCode = country.toUpperCase()
  const url = new URL('https://api.worldbank.org/v2/country/' + countryCode + '/indicator/' + code)
  url.searchParams.set('format', 'json')
  url.searchParams.set('date', String(startYear) + ':' + String(endYear))
  url.searchParams.set('per_page', '100')
  url.searchParams.set('footnote', 'y')
  const retrievedAt = new Date().toISOString()
  const base = {
    provider: 'World Bank Indicators API v2',
    sourceUrl: url.href,
    retrievedAt,
    country: countryCode,
    indicator: code,
    label: HEALTH_INDICATORS[code].label,
    unit: HEALTH_INDICATORS[code].unit,
  }
  try {
    const response = await request(url.href, {
      headers: { Accept: 'application/json' },
      signal: signal === undefined ? AbortSignal.timeout(20000)
        : AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    })
    if (!response.ok) throw new Error('HTTP ' + String(response.status))
    const raw = await response.text()
    if (raw.length > 250000) throw new Error('API response exceeded safe size')
    const body: unknown = JSON.parse(raw)
    if (!Array.isArray(body) || !Array.isArray(body[1])) {
      throw new Error('The provider did not return an indicator series')
    }
    const header = body[0] as Record<string, unknown> | undefined
    if (typeof header?.pages === 'number' && header.pages > 1) {
      throw new Error('Unexpected paginated API response; refusing an incomplete series')
    }
    const rows = new Map<number, Observation>()
    for (const rawRow of body[1] as unknown[]) {
      if (typeof rawRow !== 'object' || rawRow === null || Array.isArray(rawRow)) continue
      const row = rawRow as Record<string, unknown>
      const year = Number(row.date)
      const info = row.indicator
      if (!Number.isInteger(year) || year < startYear || year > endYear
        || typeof info !== 'object' || info === null
        || (info as Record<string, unknown>).id !== code) continue
      const value = typeof row.value === 'number' && Number.isFinite(row.value) ? row.value : null
      rows.set(year, {
        year, value,
        status: typeof row.obs_status === 'string' ? row.obs_status : null,
        footnote: typeof row.footnote === 'string' ? row.footnote.slice(0, 400) : null,
      })
    }
    const observations: Observation[] = []
    const missingYears: number[] = []
    for (let year = startYear; year <= endYear; year++) {
      const item = rows.get(year) ?? { year, value: null, status: null, footnote: null }
      observations.push(item)
      if (item.value === null) missingYears.push(year)
    }
    const available = observations.filter(item => item.value !== null)
    const warnings = [
      'Indicador descriptivo: no demuestra causalidad ni mide exclusivamente la calidad de la atención primaria.',
      'Las revisiones metodológicas entre años o fuentes pueden afectar comparabilidad; confirma notas originales.',
    ]
    if (missingYears.length > 0) warnings.push('Años ausentes conservados como null; no se interpolan datos.')
    if (observations.some(item => item.status === 'F')) warnings.push('La fuente marcó al menos una observación como pronóstico (F).')
    return {
      ...base, status: available.length === 0 ? 'empty'
        : missingYears.length > 0 ? 'partial' : 'ok',
      observations, missingYears,
      latestAvailableYear: available.length > 0 ? Math.max(...available.map(item => item.year)) : null,
      warnings,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return {
      ...base, status: 'unavailable', observations: [],
      missingYears: Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i),
      latestAvailableYear: null,
      warnings: ['Proveedor inaccesible: ' + (error instanceof Error ? error.message.slice(0, 160) : 'error no identificado')],
    }
  }
}

/**
 * Register an evidence-preserving official public-health series tool.
 * @returns searchable authorized indicator definitions and execution.
 */
export function createWorldBankHealthSeriesTool(): ToolDefinition {
  return defineTool({
    name: 'research_health_series',
    description: 'Obtiene series OFICIALES del Banco Mundial API v2 sin clave, con años null, unidades, procedencia y advertencias. Indicadores permitidos: mortalidad infantil SP.DYN.IMRT.IN, menores de 5 SH.DYN.MORT, cobertura UHC SH_UHC_SCI, gasto en salud PIB SH.XPD.CHEX.GD.ZS, gasto de bolsillo SH.XPD.OOPC.CH.ZS y médicos por 1000 SH.MED.PHYS.ZS. País DOM y años 2015–2025 por defecto. Comparar años y metodologías; no interpolar 2025 ni inferir causalidad sobre APS.',
    timeoutMs: 25000,
    parameters: {
      indicator: { type: 'string', required: true, description: 'Uno de HEALTH_INDICATORS; códigos World Bank autorizados.' },
      country: { type: 'string', description: 'ISO2 o ISO3, por defecto DOM' },
      start_year: { type: 'integer', description: 'Primer año; por defecto 2015' },
      end_year: { type: 'integer', description: 'Último año; por defecto 2025' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const result = await fetchWorldBankHealthSeries(
        args.indicator, args.country ?? 'DOM', args.start_year ?? 2015,
        args.end_year ?? 2025, fetch, exec.signal,
      )
      return result as unknown as Record<string, JsonValue>
    },
    presentCall(args) {
      return { card: 'generic', title: 'Serie oficial · ' + args.indicator, kind: 'search' }
    },
  })
}
