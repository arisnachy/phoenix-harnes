/**
 * Universal research entrypoint over the existing governed web capability seam.
 * Source names are discovery hints, NEVER pre-authorized API connections.
 * No third-party endpoint, credential, or executable plugin is installed here.
 */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool, ToolArgsError } from '@phoenix-ai/dsh-tools'
import type { WebSearchResult, WebSearchSource } from '@phoenix-ai/dsh-web'

/** Candidate research host metadata. A listing does not grant network or API execution authority. */
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
  academic: [
    { name: 'University graduate schools (.edu)', host: 'edu', access: 'public' },
    { name: 'United Kingdom university guidance (.ac.uk)', host: 'ac.uk', access: 'public' },
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
  ['academic', /\b(tesis|tesina|thesis|dissertation|disertaci[oó]n|maestr[ií]a|doctorad[oa]|posgrado|postgrado|referencias bibliogr[aá]ficas|bibliograf[ií]a)\b/iu],
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

/** Bounded federated query plan, independent of the active web-search provider. */
export interface ResearchPlan {
  readonly domain: string
  readonly queries: string[]
  readonly candidates: ResearchSource[]
}

/**
 * Infer a research domain and create a bounded source-aware search plan.
 * @param question - user's research question, from 3 to 500 characters.
 * @param requestedDomain - optional explicit catalogue domain.
 * @returns broad and authority-scoped queries plus candidate metadata.
 */
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
  // Preserve the full question for recall, shorten institution-scoped searches.
  const academicStopwords = /^(las?|los?|del?|por|para|que|qu[eé]|con|una?|unos?|hay|son|exigen|existe|existen|cu[aá]nt[oa]s?|recomendad[oa]s?)$/iu
  const keywords = domain === 'academic'
    ? q.replace(/[¿?¡!.,;:()[\]]/gu, ' ').split(/\s+/u).filter(word =>
      word.length > 2 && !academicStopwords.test(word))
      .slice(0, 14).join(' ')
    : q
  return { domain, candidates, queries: [q, ...candidates.map(source => `${keywords || q} site:${source.host}`)] }
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

/** Auditable research leads and explicit partial-failure outcome. */
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

/**
 * Failures do not discard independent successful searches; no response is fabricated.
 * @param ctx - host-owned web seam with configured search providers.
 * @param plan - domain-aware research plan.
 * @param maxResults - cap on retained result URLs.
 * @param signal - cancellation signal for all live provider requests.
 * @returns deduplicated search leads and diagnostic status.
 */
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
  if (successful.length === 0) {
    return {
      domain: plan.domain, queries: plan.queries, candidates: plan.candidates,
      sources: [], failedQueries, truncated: false, status: 'empty',
      note: 'All search requests failed. Search providers may be blocked or unavailable. Do not repeat equivalent queries; try a directly known primary source or stop with a clearly disclosed evidence gap.',
    }
  }
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
      if (plan.domain === 'academic' && !/tesis|tesina|thesis|dissert|doctor|maestr|master|graduate|universid|universit|bibliograf|referenc|research|academic|posgrado|postgrado|reglamento/iu
        .test([source.title ?? '', source.snippet ?? '', new URL(url).pathname].join(' '))) continue
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
    status: sources.length === 0 ? 'empty' : failedQueries.length > 0 ? 'partial' : 'ok',
    note: sources.length === 0
      ? 'No on-topic source was recovered. Do not loop through equivalent searches or interpret a blocked page as evidence; report the limitation and request an institutional document if essential.'
      : 'Web-discovered links are leads, not verified API results. Open primary documents before making consequential claims; include source and as-of time for live data. No candidate API has been installed or authorized.',
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
} as const

/**
 * Register bounded federated research and candidate source discovery in the existing tool registry.
 * @param ctx - Cordis plugin context.
 * @param maxResults - maximum result URLs per tool call.
 * @param timeoutMs - existing cooperative web timeout budget.
 */
export function applyResearchTools(ctx: Context, maxResults: number, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:research_search',
    order: 112,
    text: 'For evidence-intensive questions, use research_search for broad and authority-scoped leads; for thesis and dissertation regulations, seek original university guidelines and distinguish local requirements from general advice. A search result is not verified evidence: open primary sources using web_fetch. If search returns empty or blocked sources, change method once (direct university domain/document or another available provider), then finish with explicit limitations instead of repeating queries. Do not invent citations, assume universal numeric minima, or claim coverage from snippets.',
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
    execute: async (args) => {
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
    description: 'Run bounded multidisciplinary research with institution-aware academic queries, relevance filtering and partial-failure diagnostics. Empty or blocked provider results are explicit: avoid repeating equivalent searches. Returns leads, not verified claims.',
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
