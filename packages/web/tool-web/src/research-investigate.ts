/**
 * Evidence-first research execution, built on existing PHOENIX governed web tools.
 * Search -> relevance -> retrieve -> read -> report gaps. No paid key, bypass,
 * fabricated citation or automated claim-of-truth is introduced here.
 */
import type { Context } from '@phoenix-ai/cordis'
import type { ResearchOutcome, ResearchPlan } from './research.ts'
import { assessResearchRelevance, isBlockedResearchBody, normalizeResearchText,
  readableResearchExcerpt, researchFocus } from './research-relevance.ts'

/** Preserved user objective and explicit coverage request. */
/** Dependency-injected planner keeps execution independent from tool registration. */
export type InvestigationPlanner = (question: string, domain?: string, batch?: number) => ResearchPlan
/** Existing search provider and its relevance gate; no duplicate HTTP implementation. */
export type InvestigationSearcher = (ctx: Pick<Context,'web'>, plan: ResearchPlan, max: number, signal: AbortSignal) => Promise<ResearchOutcome>

export interface InvestigationInput {
  readonly question: string
  readonly domain?: string
  readonly depth?: 'standard' | 'deep'
}

/** Every candidate is classified by retrieval outcome, not by search rank alone. */
export interface InvestigationDocument {
  readonly url: string
  readonly title: string
  readonly snippet?: string
  readonly publishedAt?: string
  readonly status: 'read_relevant' | 'read_off_topic' | 'challenge' | 'unavailable' | 'not_checked'
  readonly relevanceScore: number
  readonly httpStatus?: number
  readonly accessedAt?: string
  /** Extracted from retrieved text, not a generated factual claim. */
  readonly excerpt?: string
  readonly detail?: string
}

/** Inspectable output: links, read evidence, failures and next steps never conflated. */
export interface InvestigationReport {
  readonly kind: 'research_investigation'
  readonly question: string
  readonly domain: string
  readonly depth: 'standard' | 'deep'
  readonly searchedAt: string
  readonly batchesSearched: number
  readonly queries: string[]
  readonly failedQueries: string[]
  readonly offTopicDropped: number
  readonly sources: InvestigationDocument[]
  readonly readRelevantCount: number
  readonly challengesCount: number
  readonly evidenceStatus: 'retrieved_unverified' | 'search_results_only' | 'no_evidence'
  readonly limitations: string[]
  readonly nextActions: string[]
}

function safeDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n\t]/gu, ' ').slice(0, 180)
}
function sourceKey(url: string): string {
  try { const parsed = new URL(url); parsed.hash = ''; return parsed.toString() }
  catch { return url }
}
function relevantExcerpt(content: string, question: string): string {
  const terms = researchFocus(question).slice(0, 6)
  const normalized = normalizeResearchText(content)
  const index = terms.map(term => normalized.indexOf(term))
    .filter(location => location >= 0).sort((a, b) => a - b)[0]
  const start = index === undefined ? 0 : Math.max(0, index - 120)
  return content.slice(start, start + 1450)
}
function hasReadableSubject(question: string, url: string, excerpt: string): boolean {
  // The URL path may contain the keyword even when the actual page is irrelevant.
  // Validate against the READ body, using only the origin for the geography TLD.
  return assessResearchRelevance(question, { url: new URL('/', url).toString(), snippet: excerpt }, 'general').relevant
}

/**
 * Read a ranked lead through the safe existing HTTP(S) fetch provider.
 * @param ctx - PHOENIX web service preserving robots, SSRF and cancellation policy.
 * @param question - Original user objective for body relevance checks.
 * @param source - Ranked search lead, not yet evidence.
 * @param signal - Cooperative cancellation.
 * @returns Evidence with an honest retrieval classification.
 */
async function readLead(
  ctx: Pick<Context, 'web'>, question: string,
  source: InvestigationDocument, signal: AbortSignal,
): Promise<InvestigationDocument> {
  if (signal.aborted) throw signal.reason ?? new Error('Research cancelled')
  try {
    const result = await ctx.web.fetch({ url: source.url }, signal)
    const accessedAt = new Date().toISOString()
    if (result.statusCode === 403 || result.statusCode === 429 || result.statusCode === 503) {
      return { ...source, status: 'challenge', httpStatus: result.statusCode, accessedAt,
        detail: 'Access restricted; do not retry aggressively or bypass the challenge.' }
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { ...source, status: 'unavailable', httpStatus: result.statusCode, accessedAt,
        detail: 'Source did not return successful HTTP content.' }
    }
    if (isBlockedResearchBody(result.body.content)) {
      return { ...source, status: 'challenge', httpStatus: result.statusCode, accessedAt,
        detail: 'HTML challenge or CAPTCHA despite HTTP success; not evidence.' }
    }
    const content = readableResearchExcerpt(result.body.content, result.body.kind, 18_000)
    if (content.length < 100) {
      return { ...source, status: 'unavailable', httpStatus: result.statusCode, accessedAt,
        detail: 'Content was too short to substantiate research claims.' }
    }
    const excerpt = relevantExcerpt(content, question)
    if (!hasReadableSubject(question, result.url, excerpt)) {
      return { ...source, status: 'read_off_topic', httpStatus: result.statusCode, accessedAt,
        detail: 'The retrieved text does not establish topical relevance; discarded from evidence.' }
    }
    return { ...source, status: 'read_relevant', httpStatus: result.statusCode, accessedAt,
      excerpt, ...(result.truncated ? { detail: 'Source was truncated: verify full text before quoting conclusions.' } : {}) }
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error
    const detail = safeDetail(error)
    return { ...source,
      status: /(?:WEB_ROBOTS_|CAPTCHA|WEB_PROVIDER_RATE_LIMIT|challenge)/iu.test(detail)
        ? 'challenge' : 'unavailable',
      detail,
    }
  }
}

/**
 * Execute a bounded complete research pass and distinguish searched/actually read sources.
 * @param ctx - Host web service, never a raw unaudited HTTP client.
 * @param input - User question, optional domain and depth.
 * @param signal - Caller cancellation.
 * @param plan - Domain-aware existing query planner.
 * @param search - Existing governed search executor.
 * @returns Research report containing real excerpts and explicit access gaps.
 */
export async function investigateResearch(
  ctx: Pick<Context, 'web'>, input: InvestigationInput, signal: AbortSignal,
  plan: InvestigationPlanner, search: InvestigationSearcher,
): Promise<InvestigationReport> {
  const depth = input.depth === 'deep' ? 'deep' : 'standard'
  const initial = plan(input.question, input.domain, 0)
  // Standard mode widens the search automatically only if the first source
  // batch lacks coverage. Deep mode explores up to three batches.
  const maxBatches = Math.min(initial.totalBatches, depth === 'deep' ? 3 : 2)
  const maxToRead = depth === 'deep' ? 6 : 3
  const outcomes: ResearchOutcome[] = []
  const seen = new Set<string>()
  const leads: InvestigationDocument[] = []
  for (let batch = 0; batch < maxBatches; batch++) {
    if (signal.aborted) throw signal.reason ?? new Error('Research cancelled')
    if (batch > 0) {
      const hosts = new Set(leads.map(lead => new URL(lead.url).hostname))
      if (depth === 'standard' && leads.length >= 3 && hosts.size >= 2) break
      if (depth === 'deep' && batch >= 2 && leads.length >= 8 && hosts.size >= 3) break
    }
    const queryPlan = batch === 0 ? initial : plan(input.question, input.domain, batch)
    const outcome = await search(ctx, queryPlan, 8, signal)
    outcomes.push(outcome)
    for (const source of outcome.sources) {
      const key = sourceKey(source.url)
      if (seen.has(key)) continue
      seen.add(key)
      const check = assessResearchRelevance(input.question, source, queryPlan.domain)
      leads.push({
        url: key, title: source.title ?? new URL(key).hostname,
        ...(source.snippet === undefined ? {} : { snippet: source.snippet }),
        ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
        relevanceScore: check.score, status: 'not_checked',
      })
    }
    // Expansion is gated above by actual source coverage; this prevents
    // wasting provider calls once sufficient independent candidates exist.
  }
  leads.sort((a, b) => b.relevanceScore - a.relevanceScore)
  const chosen: InvestigationDocument[] = []
  const byHost = new Map<string, number>()
  for (const lead of leads) {
    if (chosen.length >= maxToRead) break
    const host = new URL(lead.url).hostname
    const count = byHost.get(host) ?? 0
    if (count >= 2) continue
    byHost.set(host, count + 1)
    chosen.push(lead)
  }
  // Bound concurrent HTTP requests per origin and the overall tool-call budget.
  const checked: InvestigationDocument[] = []
  for (let offset = 0; offset < chosen.length; offset += 2) {
    const group = chosen.slice(offset, offset + 2)
    const current = await Promise.all(group.map(lead => readLead(ctx, input.question, lead, signal)))
    checked.push(...current)
  }
  const inspected = new Map(checked.map(doc => [doc.url, doc]))
  const sources = leads.slice(0, depth === 'deep' ? 16 : 10).map(lead => inspected.get(lead.url) ?? lead)
  const readRelevantCount = sources.filter(doc => doc.status === 'read_relevant').length
  const readHosts = new Set(sources.filter(doc => doc.status === 'read_relevant')
    .map(doc => new URL(doc.url).hostname))
  const challengesCount = sources.filter(doc => doc.status === 'challenge').length
  const failedQueries = outcomes.flatMap(outcome => outcome.failedQueries)
  const limitations = [
    ...(readRelevantCount === 0 ? ['No se recuperó texto primario pertinente; la búsqueda no demuestra los hechos investigados.'] : []),
    ...(readRelevantCount > 0 && readHosts.size < 2
      ? ['Solo hay evidencia legible procedente de un dominio; falta contraste con una fuente institucional independiente.']
      : []),
    ...(challengesCount > 0 ? [`${challengesCount} páginas bloquearon lectura: no intentar eludir CAPTCHA; usar fuentes autorizadas equivalentes.`] : []),
    ...(failedQueries.length > 0 ? [`${failedQueries.length} búsquedas fallaron y se conservaron por trazabilidad.`] : []),
    ...(!sources.some(doc => doc.publishedAt) ? ['La fecha de publicación de las fuentes no se verificó; revisar vigencia.'] : []),
    'La pertinencia textual y el acceso HTTP no autentican los datos, metodología ni independencia de una publicación.',
  ]
  const nextActions = readRelevantCount === 0
    ? ['Probar fuentes oficiales alternativas o APIs públicas sin cambiar la pregunta.', 'Solicitar lectura manual autorizada si el documento indispensable está protegido.']
    : ['Contrastar fechas, cifras y definiciones entre documentos independientes, con citas por URL.',
      'Identificar contradicciones y lagunas; no inventar datos ni pronósticos para resolverlas.']
  return {
    kind: 'research_investigation', question: initial.question, domain: initial.domain, depth,
    searchedAt: new Date().toISOString(), batchesSearched: outcomes.length,
    queries: outcomes.flatMap(outcome => outcome.queries), failedQueries,
    offTopicDropped: outcomes.reduce((sum, outcome) => sum + outcome.offTopicDropped, 0),
    sources, readRelevantCount, challengesCount,
    evidenceStatus: readRelevantCount > 0 ? 'retrieved_unverified'
      : leads.length > 0 ? 'search_results_only' : 'no_evidence',
    limitations, nextActions,
  }
}
