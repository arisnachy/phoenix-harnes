/**
 * ORÁCULO: bounded, topic-aware discovery of scientific leads.
 * Search-engine results are not authenticated evidence or a forecast.
 */
import type { WebRuntime, WebSearchSource } from '@phoenix-ai/dsh-web'
import { oraclePlan, type OraclePlan } from './scientific-intelligence.ts'

/** A discovery lead whose title and snippet actually match the forecast question. */
export interface OracleResearchSource {
  url: string
  title: string
  snippet?: string
  publishedAt?: string
}

/** Report of verified relevance (not verified factual accuracy). */
export interface OracleResearch {
  kind: 'oracle_research'
  status: 'researched' | 'insufficient'
  question: string
  targetAt: string
  category: string
  plan: OraclePlan
  riskFlags: string[]
  researchedAt: string
  searches: string[]
  sources: OracleResearchSource[]
  candidateDatasets: string[]
  evidenceStatus: 'search_results_unverified'
  nextStep: string
  probabilityPercent: null
  /** Leads rejected because they belong to another topic, geography or an anti-bot page. */
  offTopicDropped: number
  /** Queries that failed at the configured provider, not invented empty results. */
  failedQueries: string[]
  /** Curated public entrypoints for human/authorized browser recovery, not retrieved facts. */
  sourceDirectories: Array<{ name: string; url: string }>
  reason?: string
}

/** Detect the primary scientific discipline without treating an unrelated clinical profile as relevant. */
export function classifyOracleTopic(question: string): string {
  if (/lluvia|clima|temperatura|hurac[aá]n|tormenta|tiempo atmosf[eé]rico|weather|rain|storm/iu.test(question)) return 'meteorología'
  if (/paciente|enfermedad|epidemia|salud|hospital|dengue|brote|health|epidemic/iu.test(question)) return 'salud pública'
  if (/precio|bolsa|inflaci[oó]n|finanzas|mercado|econom[ií]a|cotizaci[oó]n|bitcoin|crypto/iu.test(question)) return 'economía'
  if (/partido|equipo|deporte|f[uú]tbol|b[eé]isbol|nba|mlb|goles|sports/iu.test(question)) return 'deportes'
  if (/reacci[oó]n|qu[ií]mica|mezcla|f[ií]sica|fuerza|ca[ií]da|f[oó]rmula/iu.test(question)) return 'ciencias físicas'
  return 'general'
}
function futureDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error('targetAt debe ser fecha ISO con zona horaria.')
  if (Date.parse(value) <= Date.now()) throw new Error('La proyección investigada necesita un horizonte futuro.')
  return new Date(value).toISOString()
}
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
}
const STOP = new Set([
  'cual', 'cuales', 'cuando', 'donde', 'como', 'sera', 'seran', 'habra', 'sido', 'antes', 'despues',
  'pregunta', 'pronostico', 'pronosticar', 'prediccion', 'prediccion', 'futuro', 'proximos',
  'proximo', 'durante', 'segun', 'entre', 'hasta', 'para', 'sobre', 'desde', 'tendra', 'tener',
  'tendencia', 'semanal', 'mensual', 'anual', 'casos', 'caso', 'numero', 'notificados',
  'sera', 'siguiente', 'lanzada', 'lanzado', 'mision', 'datos', 'estudio', 'estudios',
  'fuentes', 'fuente', 'evidencia', 'cientifico', 'cientifica', 'historico', 'historica',
  'republica', 'dominicana', 'dominicano', 'dominican', 'republic', 'espana',
  'will', 'would', 'have', 'been', 'before', 'after', 'during', 'when', 'what', 'which', 'year',
  'with', 'their', 'from', 'that', 'this', 'whose', 'forecast', 'prediction', 'launch',
  'hasta', 'meses', 'semana', 'anio', 'years', '2026', '2027',
  'los', 'las', 'una', 'uno', 'por', 'del', 'que', 'con', 'sus', 'the', 'and', 'for', 'not', 'era',
])
function keywords(question: string): string[] {
  const tokens = normalize(question).match(/[a-z0-9]{4,}/gu) ?? []
  return [...new Set(tokens.filter(token => !STOP.has(token) && !/^\d+$/u.test(token)))].slice(0, 7)
}
function isDominicanRepublic(q: string): boolean {
  return /rep[uú]blica dominicana|dominican republic|\bRD\b/iu.test(q)
}
function makeQueries(question: string, category: string): string[] {
  const terms = keywords(question)
  const main = terms.slice(0, 4).join(' ') || question.trim()
  const year = String(new Date().getUTCFullYear())
  if (category === 'salud pública' && /\bdengue\b/iu.test(question)) {
    const country = isDominicanRepublic(question)
      ? 'República Dominicana' : terms.filter(x => x !== 'dengue').slice(0, 2).join(' ')
    return [...new Set([
      `dengue ${country} boletin epidemiologico ${year}`,
      `dengue ${country} vigilancia semanal casos confirmados ${year}`,
      `dengue ${country} site:epidemiologia.gob.do`,
      `dengue ${country} site:paho.org`,
    ])]
  }
  if (/\bartemis\b/iu.test(question)) {
    return [`"Artemis II" NASA launch schedule site:nasa.gov`,
      `"Artemis II" launch date ${year} NASA`,
      `"Artemis II" ${year} mission status`]
  }
  return [...new Set([
    `${main} ${year} fuente oficial`,
    `${main} registros historicos ${category}`,
    `${main} datos observados publicos`,
  ])]
}
function blockedPage(text: string, url: string): boolean {
  return /(?:captcha|just a moment|verify (?:you are|that you)|access denied|cloudflare challenge|robot verification|cf-chl-)/iu.test(text)
    || /(?:\/challenge-platform\/|\/captcha\/)/iu.test(url)
}
function relevance(question: string, item: WebSearchSource): number {
  const rawUrl = typeof item.url === 'string' ? item.url : ''
  const rawText = [item.title, item.snippet].filter(Boolean).join(' ')
  if (!rawUrl.startsWith('https://') || blockedPage(rawText, rawUrl)) return 0
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return 0 }
  const haystack = normalize(rawText + ' ' + parsed.pathname.replace(/[-_%/]/gu, ' '))
  const focus = keywords(question)
  // A distinct named subject must occur. In particular, "It" films cannot
  // substitute for Artemis II just because a search provider returned them.
  const named = /\bartemis\b/iu.test(question) ? 'artemis'
    : /\bdengue\b/iu.test(question) ? 'dengue' : undefined
  if (named !== undefined && !haystack.includes(named)) return 0
  if (named === undefined && focus.length > 0) {
    const found = focus.filter(word => haystack.includes(word)).length
    if (found < (focus.length <= 2 ? 1 : 2)) return 0
  }
  if (isDominicanRepublic(question)) {
    const country = /republica dominicana|dominican republic|\bdom\b|dominicana/iu.test(haystack)
      || /(?:^|\.)gob\.do$/iu.test(parsed.hostname)
    if (!country) return 0
  }
  const score = focus.filter(word => haystack.includes(word)).length
  const authority = /(?:^|\.)(?:nasa\.gov|paho\.org|who\.int|epidemiologia\.gob\.do|msp\.gob\.do)$/iu.test(parsed.hostname)
    || /\.gov(?:\.do)?$/iu.test(parsed.hostname) ? 8 : 0
  return Math.max(1, score) + authority
}
function researchDirectories(question: string): Array<{ name: string; url: string }> {
  if (/\bdengue\b/iu.test(question) && isDominicanRepublic(question)) {
    return [
      { name: 'DIGEPI · Boletines epidemiológicos', url: 'https://www.epidemiologia.gob.do/documentos-epidemiologicos/boletines-epidemiologicos/' },
      { name: 'OPS · Dengue', url: 'https://www.paho.org/es/temas/dengue' },
      { name: 'OpenDengue · Descargas y definiciones', url: 'https://opendengue.org/data.html' },
    ]
  }
  if (/\bartemis\b/iu.test(question)) return [
    { name: 'NASA · Programa Artemis', url: 'https://www.nasa.gov/humans-in-space/artemis/' },
  ]
  return []
}
function uniqueUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    url.hash = ''
    for (const k of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/iu.test(k)) url.searchParams.delete(k)
    return url.toString()
  } catch { return undefined }
}
/**
 * Discover related sources for an observable future claim, never fabricating a rate.
 * @param web - Existing source-search seam, with no new paid dependency.
 * @param question - Falsifiable research question.
 * @param targetAt - Future ISO deadline with explicit timezone.
 * @param signal - Cooperative user cancellation.
 * @returns Topic-screened leads, provider errors and unverified evidence status.
 */
export async function researchOracle(
  web: Pick<WebRuntime, 'search'>,
  question: string,
  targetAt: string,
  signal?: AbortSignal,
): Promise<OracleResearch> {
  if (typeof question !== 'string' || question.trim().length < 8 || question.length > 400)
    throw new Error('Pregunta específica entre 8 y 400 caracteres.')
  const target = futureDate(targetAt)
  const topic = classifyOracleTopic(question)
  const plan = oraclePlan(question, target)
  const searches = makeQueries(question, topic)
  const candidates: Array<{ source: OracleResearchSource; score: number }> = []
  const seen = new Set<string>()
  const failedQueries: string[] = []
  let offTopicDropped = 0
  let consecutiveFailures = 0
  for (const query of searches) {
    if (signal?.aborted) throw signal.reason ?? new Error('Investigación cancelada.')
    try {
      const result = await web.search({ query, maxResults: 8 }, signal)
      consecutiveFailures = 0
      for (const item of result.sources as WebSearchSource[]) {
        const url = uniqueUrl(item.url)
        if (url === undefined || seen.has(url)) continue
        seen.add(url)
        const score = relevance(question, item)
        if (score === 0) { offTopicDropped++; continue }
        const entry: OracleResearchSource = {
          url, title: (item.title || new URL(url).hostname).slice(0, 180),
        }
        if (item.snippet) entry.snippet = item.snippet.slice(0, 700)
        if (item.publishedAt) entry.publishedAt = item.publishedAt.slice(0, 45)
        candidates.push({ source: entry, score })
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      failedQueries.push(query)
      consecutiveFailures++
      // A free provider may spend multiple seconds per challenged engine. Do not
      // repeatedly probe it when two consecutive queries have already failed.
      if (consecutiveFailures >= 2 && candidates.length === 0) break
    }
  }
  const sources = candidates.sort((a, b) => b.score - a.score).map(x => x.source).slice(0, 12)
  const domains = new Set(sources.map(s => new URL(s.url).hostname.replace(/^www\./u, '')))
  const sufficient = domains.size >= 2
  const dated = sources.filter(x => x.publishedAt && Number.isFinite(Date.parse(x.publishedAt)))
  const older = dated.filter(x => Date.parse(x.publishedAt!) < Date.now() - 365 * 86400_000)
  const candidateDatasets = sources.filter(s => /\.csv(?:\?|$)/iu.test(s.url)).map(s => s.url).slice(0, 8)
  const sourceDirectories = researchDirectories(question)
  const riskFlags = [
    'Resultados pertinentes filtrados; su contenido y las cifras aún deben verificarse en el documento original.',
    ...(offTopicDropped ? [`${offTopicDropped} resultados fuera de tema, país o bloqueados fueron descartados.`] : []),
    ...(failedQueries.length ? [`${failedQueries.length} consultas fallaron en el proveedor: consultar fuentes públicas alternativas.`] : []),
    ...(!sufficient ? ['Faltan al menos dos dominios independientes sobre el MISMO asunto.'] : []),
    ...(dated.length === 0 ? ['Ningún resultado ofrece una fecha de publicación verificable.'] : []),
    ...(older.length ? ['Algunas fuentes tienen más de un año: comprobar vigencia.'] : []),
    ...(candidateDatasets.length === 0 ? ['Sin CSV pertinente descubierto: consultar boletines, APIs y series primarias.'] : []),
  ]
  return {
    kind: 'oracle_research', status: sufficient ? 'researched' : 'insufficient',
    question: question.trim(), targetAt: target, category: topic, plan,
    riskFlags, researchedAt: new Date().toISOString(), searches, sources, candidateDatasets,
    evidenceStatus: 'search_results_unverified', offTopicDropped, failedQueries, sourceDirectories,
    nextStep: sufficient
      ? 'Abrir, leer y contrastar cada fuente primaria antes de estimar. Para CSV con fechas y valores semanales, usar oracle_forecast_public_csv; no extrapolar únicamente desde dos titulares.'
      : sourceDirectories.length
        ? 'Abrir los directorios oficiales conocidos y reunir datos semanales verificables. No usar estos enlaces como cifras observadas hasta leer sus documentos.'
        : 'Reintentar con fuentes oficiales o APIs abiertas. No convertir páginas irrelevantes, CAPTCHA ni titulares en observaciones o porcentajes.',
    probabilityPercent: null,
    ...sufficient ? {} : { reason: failedQueries.length > 0 && candidates.length === 0
      ? 'Los proveedores de búsqueda gratuita no respondieron; usar conectores y enlaces oficiales alternativos.'
      : offTopicDropped ? 'Se rechazaron resultados sin relación verificable con la pregunta.'
        : 'No hay al menos dos dominios fuente relevantes e independientes.' },
  }
}
