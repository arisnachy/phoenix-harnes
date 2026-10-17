/**
 * Universal research entrypoint over the existing governed web capability seam.
 * Source names are discovery hints, NEVER pre-authorized API connections.
 * No third-party endpoint, credential, or executable plugin is installed here.
 */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool, ToolArgsError } from '@phoenix-ai/dsh-tools'
import type { WebSearchResult, WebSearchSource } from '@phoenix-ai/dsh-web'

export interface ResearchSource {
  readonly name: string
  readonly host: string
  readonly access: 'public' | 'mixed' | 'restricted'
}

/** Extensible starting map. Hosts are search scopes, not unverified direct API endpoints. */
export const RESEARCH_SOURCES: Record<string, readonly ResearchSource[]> = {
  general: [],
  sports: [
    { name: 'Official competition websites', host: 'fifa.com', access: 'public' },
    { name: 'ESPN', host: 'espn.com', access: 'mixed' },
    { name: 'MLB', host: 'mlb.com', access: 'public' },
  ],
  fx: [
    { name: 'Banco Central de la República Dominicana', host: 'bancentral.gov.do', access: 'public' },
    { name: 'European Central Bank', host: 'ecb.europa.eu', access: 'public' },
    { name: 'Frankfurter', host: 'frankfurter.dev', access: 'public' },
  ],
  crypto: [
    { name: 'CoinGecko', host: 'coingecko.com', access: 'mixed' },
    { name: 'Binance', host: 'binance.com', access: 'mixed' },
  ],
  finance: [
    { name: 'SEC EDGAR', host: 'sec.gov', access: 'public' },
    { name: 'FRED', host: 'fred.stlouisfed.org', access: 'public' },
  ],
  medicine: [
    { name: 'PubMed', host: 'pubmed.ncbi.nlm.nih.gov', access: 'public' },
    { name: 'ClinicalTrials.gov', host: 'clinicaltrials.gov', access: 'public' },
    { name: 'World Health Organization', host: 'who.int', access: 'public' },
  ],
  neuroscience: [
    { name: 'PubMed', host: 'pubmed.ncbi.nlm.nih.gov', access: 'public' },
    { name: 'OpenNeuro', host: 'openneuro.org', access: 'public' },
  ],
  science: [
    { name: 'OpenAlex', host: 'openalex.org', access: 'mixed' },
    { name: 'arXiv', host: 'arxiv.org', access: 'public' },
    { name: 'Crossref', host: 'crossref.org', access: 'public' },
  ],
  economics: [
    { name: 'World Bank', host: 'worldbank.org', access: 'public' },
    { name: 'IMF', host: 'imf.org', access: 'public' },
    { name: 'CEPAL', host: 'cepal.org', access: 'public' },
  ],
  law: [
    { name: 'EUR-Lex', host: 'eur-lex.europa.eu', access: 'public' },
    { name: 'Congress.gov', host: 'congress.gov', access: 'public' },
  ],
  weather: [
    { name: 'NOAA', host: 'noaa.gov', access: 'public' },
    { name: 'Open-Meteo', host: 'open-meteo.com', access: 'public' },
  ],
  geography: [
    { name: 'OpenStreetMap', host: 'openstreetmap.org', access: 'public' },
    { name: 'USGS', host: 'usgs.gov', access: 'public' },
  ],
  travel: [
    { name: 'IATA', host: 'iata.org', access: 'public' },
    { name: 'Amadeus', host: 'amadeus.com', access: 'mixed' },
  ],
  news: [
    { name: 'GDELT', host: 'gdeltproject.org', access: 'public' },
    { name: 'Reuters', host: 'reuters.com', access: 'mixed' },
  ],
  commerce: [
    { name: 'eBay', host: 'ebay.com', access: 'mixed' },
    { name: 'Mercado Libre', host: 'mercadolibre.com', access: 'mixed' },
  ],
  entertainment: [
    { name: 'TMDb', host: 'themoviedb.org', access: 'mixed' },
    { name: 'MusicBrainz', host: 'musicbrainz.org', access: 'public' },
  ],
  books: [
    { name: 'Open Library', host: 'openlibrary.org', access: 'public' },
    { name: 'Library of Congress', host: 'loc.gov', access: 'public' },
  ],
  education: [
    { name: 'ERIC', host: 'eric.ed.gov', access: 'public' },
    { name: 'UNESCO', host: 'unesco.org', access: 'public' },
  ],
  environment: [
    { name: 'NASA Earthdata', host: 'earthdata.nasa.gov', access: 'mixed' },
    { name: 'Copernicus', host: 'copernicus.eu', access: 'mixed' },
  ],
  agriculture: [
    { name: 'FAOSTAT', host: 'fao.org', access: 'public' },
    { name: 'USDA', host: 'usda.gov', access: 'public' },
  ],
  energy: [
    { name: 'US EIA', host: 'eia.gov', access: 'public' },
    { name: 'IEA', host: 'iea.org', access: 'mixed' },
  ],
  cybersecurity: [
    { name: 'CISA', host: 'cisa.gov', access: 'public' },
    { name: 'NVD', host: 'nvd.nist.gov', access: 'public' },
    { name: 'OSV', host: 'osv.dev', access: 'public' },
  ],
  software: [
    { name: 'GitHub', host: 'github.com', access: 'mixed' },
    { name: 'npm', host: 'npmjs.com', access: 'public' },
    { name: 'PyPI', host: 'pypi.org', access: 'public' },
  ],
  patents: [
    { name: 'European Patent Office', host: 'epo.org', access: 'mixed' },
    { name: 'WIPO', host: 'wipo.int', access: 'public' },
  ],
  businesses: [
    { name: 'Companies House', host: 'find-and-update.company-information.service.gov.uk', access: 'public' },
    { name: 'OpenCorporates', host: 'opencorporates.com', access: 'mixed' },
  ],
  transport: [
    { name: 'OpenStreetMap', host: 'openstreetmap.org', access: 'public' },
    { name: 'OpenSky Network', host: 'opensky-network.org', access: 'mixed' },
  ],
}

const DOMAIN_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['fx', /\b(d[oó]lar|euro|divisa|exchange rate|currency|tipo de cambio|usd|dop|eur)\b/iu],
  ['crypto', /\b(bitcoin|ethereum|criptomoneda|crypto|blockchain|token|btc)\b/iu],
  ['sports', /\b(partido|f[uú]tbol|football|soccer|nba|mlb|b[eé]isbol|tenis|liga|marcador|resultado deportivo|champions|real madrid)\b/iu],
  ['neuroscience', /\b(neurociencia|neuropsicolog|neuroplasticidad|neuroimagen|cognitiv|alzheimer|alzh[eé]imer)\b/iu],
  ['medicine', /\b(medicina|clinical|cl[ií]nic|ensayo|tratamiento|paciente|salud|f[aá]rmaco|epidemiolog)\b/iu],
  ['finance', /\b(acciones|bolsa|stock|bonos|inversiones|nasdaq|s&p|sec edgar)\b/iu],
  ['economics', /\b(inflaci[oó]n|pib|gdp|desempleo|econom[ií]a|banco mundial|pol[ií]ticas p[uú]blicas)\b/iu],
  ['weather', /\b(clima|tiempo atmosf[eé]rico|hurac[aá]n|meteorolog|pron[oó]stico|weather)\b/iu],
  ['law', /\b(ley|decreto|jurisprudencia|legislaci[oó]n|normativa|derecho|legal)\b/iu],
  ['travel', /\b(vuelo|aeropuerto|hotel|viaje|turismo|flight|airline)\b/iu],
  ['news', /\b(noticias|actualidad|breaking|noticia|acontecimiento)\b/iu],
  ['cybersecurity', /\b(cve|vulnerabilidad|ciberseguridad|malware|exploit|seguridad inform[aá]tica)\b/iu],
  ['education', /\b(educaci[oó]n|pedagog|curso|universidad|ense[nñ]anza|aprendizaje)\b/iu],
  ['science', /\b(ciencia|investigaci[oó]n|art[ií]culos cient[ií]ficos|papers|estudio cient[ií]fico|arxiv)\b/iu],
  ['geography', /\b(mapa|geograf[ií]a|coordenada|cartograf[ií]a)\b/iu],
  ['commerce', /\b(comprar|producto|precio|tienda|oferta|shopping)\b/iu],
  ['entertainment', /\b(pel[ií]cula|serie|spotify|actor|cine|m[uú]sica)\b/iu],
  ['books', /\b(libro|novela|biblioteca|isbn|autor literario)\b/iu],
  ['environment', /\b(medioambiente|contaminaci[oó]n|emisiones|ecosistema|biodiversidad)\b/iu],
  ['agriculture', /\b(agricultura|cultivo|siembra|cosecha)\b/iu],
  ['energy', /\b(energ[ií]a|electricidad|petr[oó]leo|combustible)\b/iu],
  ['software', /\b(programaci[oó]n|github|typescript|python|software|api|repositorio)\b/iu],
  ['patents', /\b(patente|patent|inventor)\b/iu],
  ['businesses', /\b(empresa|corporaci[oó]n|compa[nñ][ií]a|registro mercantil)\b/iu],
  ['transport', /\b(log[ií]stica|transporte|tracking|paquete|env[ií]o)\b/iu],
]

export interface ResearchPlan {
  readonly domain: string
  readonly queries: string[]
  readonly candidates: ResearchSource[]
}

export function planResearch(question: string, requestedDomain?: string): ResearchPlan {
  const q = question.trim()
  if (q.length < 3 || q.length > 500) throw new ToolArgsError(['question must contain 3–500 characters'])
  const domain = requestedDomain === undefined || requestedDomain.trim() === ''
    ? (DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(q))?.[0] ?? 'general')
    : requestedDomain.trim().toLowerCase()
  if (!Object.hasOwn(RESEARCH_SOURCES, domain)) {
    throw new ToolArgsError([`unknown domain: ${domain}; use research_sources to inspect supported domains`])
  }
  const candidates = (RESEARCH_SOURCES[domain] ?? []).slice(0, 2)
  // One broad query preserves recall; two authority-scoped queries improve precision.
  return { domain, candidates, queries: [q, ...candidates.map(source => `${q} site:${source.host}`)] }
}

function canonicalUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/iu.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch { return undefined }
}

export interface ResearchOutcome {
  readonly domain: string
  readonly queries: string[]
  readonly candidates: ResearchSource[]
  readonly sources: WebSearchSource[]
  readonly failedQueries: string[]
  readonly truncated: boolean
  readonly status: 'ok' | 'partial' | 'empty'
  readonly note: string
}

/** Failures do not discard independent successful searches; no response is fabricated. */
export async function executeResearch(
  ctx: Pick<Context, 'web'>,
  plan: ResearchPlan,
  maxResults: number,
  signal: AbortSignal,
): Promise<ResearchOutcome> {
  const outcomes = await Promise.allSettled(plan.queries.map(query => ctx.web.search({ query, maxResults }, signal)))
  if (signal.aborted) throw signal.reason ?? new Error('research cancelled')
  const failedQueries: string[] = []
  const successful: WebSearchResult[] = []
  for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index]
    if (outcome?.status === 'fulfilled') successful.push(outcome.value)
    else failedQueries.push(plan.queries[index] as string)
  }
  if (successful.length === 0) throw new Error('No search provider succeeded; check provider credentials or availability.')
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  let dropped = false
  const maxRanks = Math.max(0, ...successful.map(result => result.sources.length))
  outer: for (let rank = 0; rank < maxRanks; rank++) {
    for (const result of successful) {
      const source = result.sources[rank]
      if (source === undefined) continue
      const url = canonicalUrl(source.url)
      if (url === undefined || seen.has(url)) continue
      seen.add(url)
      if (sources.length >= maxResults) { dropped = true; break outer }
      sources.push(source)
    }
  }
  return {
    domain: plan.domain,
    queries: plan.queries,
    candidates: plan.candidates,
    sources,
    failedQueries,
    truncated: dropped || successful.some(result => result.truncated),
    status: failedQueries.length > 0 ? 'partial' : sources.length > 0 ? 'ok' : 'empty',
    note: 'Web-discovered links are leads, not verified API results. Open primary documents before making consequential claims; include source and as-of time for live data. No candidate API has been installed or authorized.',
  }
}

const sourceSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    name: { type: 'string' as const, required: true },
    host: { type: 'string' as const, required: true },
    access: { type: 'string' as const, required: true },
  },
}

/** Registers an intentionally bounded federated research tool and source inventory. */
export function applyResearchTools(ctx: Context, maxResults: number, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:research_search',
    order: 112,
    text: 'For evidence-intensive multidisciplinary questions, use research_search to consult a broad search and at most two authority-scoped searches through the existing web provider. Research candidate sources are discovery hints, not connected APIs or proof. Inspect primary URLs using web_fetch when available; show publication/as-of date and disagreements. For a quick factual search use web_search instead. Never claim real-time or exhaustive coverage from snippets.',
  })
  ctx.tools.register(defineTool({
    name: 'research_sources',
    description: 'List candidate authoritative source hosts by research domain. This is metadata, not an API connection, credential or live availability claim.',
    parameters: { domain: { type: 'string', description: 'Optional domain, for example sports, fx, medicine, science, economics, weather, law or general.' } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domains: { type: 'array', required: true, items: { type: 'string' } },
          sources: { type: 'array', required: true, items: sourceSchema },
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    execute: async args => {
      const domain = args.domain?.trim().toLowerCase()
      if (domain !== undefined && domain !== '' && !Object.hasOwn(RESEARCH_SOURCES, domain)) {
        throw new ToolArgsError(['unknown domain; use research_sources without a domain to list domains'])
      }
      return {
        domains: Object.keys(RESEARCH_SOURCES),
        sources: domain === undefined || domain === '' ? [] : [...(RESEARCH_SOURCES[domain] ?? [])],
        note: 'Candidates require independent checks for API capability, freshness, credentials, rate limits, license and coverage.',
      }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'research_search',
    description: 'Run bounded multidisciplinary live web research with domain-aware source-scoped queries, deduplication and partial failure recovery. Returns source leads and provenance, not directly verified API data.',
    parameters: {
      question: { type: 'string', required: true },
      domain: { type: 'string', description: 'Optional source domain. Call research_sources to list valid values.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          domain: { type: 'string', required: true },
          queries: { type: 'array', required: true, items: { type: 'string' } },
          candidates: { type: 'array', required: true, items: sourceSchema },
          sources: { type: 'array', required: true, items: {
            type: 'object', additionalProperties: false,
            properties: {
              url: { type: 'string', required: true },
              title: { type: 'string' },
              snippet: { type: 'string' },
              publishedAt: { type: 'string' },
            },
          } },
          failedQueries: { type: 'array', required: true, items: { type: 'string' } },
          truncated: { type: 'boolean', required: true },
          status: { type: 'string', required: true, enum: ['ok', 'partial', 'empty'] },
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const plan = planResearch(args.question, args.domain)
      return executeResearch(ctx, plan, maxResults, exec.signal)
    },
  }))
}
