/**
 * Authenticated-by-source scholarly metadata: public Europe PMC REST response,
 * not a model-derived citation or a made-up API account connection.
 */
import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Original Europe PMC bibliographic record with source identity and retrieval time. */
export interface ScholarlyRecord {
  key: string
  title: string
  authors: string
  year: string
  journal: string
  url: string
  doi?: string
  pmid?: string
  pmcid?: string
  abstract?: string
  source: string
  firstPublished?: string
  isOpenAccess?: boolean
}

/**
 * Safely project provider metadata to bounded real source citations.
 * @param input - untrusted Europe PMC response payload.
 * @returns citation records that include provider-supplied identifiers.
 */
export function projectEuropePmcRecords(input: unknown): ScholarlyRecord[] {
  if (typeof input !== 'object' || input === null) return []
  const root = input as { resultList?: { result?: unknown } }
  if (!Array.isArray(root.resultList?.result)) return []
  const out: ScholarlyRecord[] = []
  const seen = new Set<string>()
  for (const raw of root.resultList.result.slice(0, 30)) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const title = typeof item.title === 'string' ? item.title.replace(/<[^>]*>/gu, '').trim().slice(0, 350) : ''
    const authors = typeof item.authorString === 'string' ? item.authorString.slice(0, 600) : ''
    const year = typeof item.pubYear === 'string' ? item.pubYear : ''
    const doi = typeof item.doi === 'string' && /^10\.\d{4,9}\/\S+$/u.test(item.doi) ? item.doi : undefined
    const pmid = typeof item.pmid === 'string' && /^\d{5,10}$/u.test(item.pmid) ? item.pmid : undefined
    const pmcid = typeof item.pmcid === 'string' && /^PMC\d+$/u.test(item.pmcid) ? item.pmcid : undefined
    if (!title || !authors || !/^(19|20)\d{2}$/u.test(year) || !(doi || pmid || pmcid)) continue
    const identity = doi ? 'doi:' + doi.toLowerCase() : pmid ? 'pmid:' + pmid : 'pmcid:' + (pmcid ?? '')
    if (seen.has(identity)) continue
    seen.add(identity)
    // Research publisher accepts only citation-safe [@key] identifiers.
    const key = pmid ? 'pmid' + pmid : pmcid ? pmcid.toLowerCase() : 'doi' + (doi ?? '').replace(/[^A-Za-z0-9]/gu, '_').slice(0, 61)
    out.push({
      key,
      title,
      authors,
      year,
      journal: typeof item.journalTitle === 'string' ? item.journalTitle.slice(0, 220) : '',
      url: doi ? 'https://doi.org/' + encodeURI(doi) : pmid
        ? 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/'
        : 'https://europepmc.org/articles/' + (pmcid ?? ''),
      ...(doi ? { doi } : {}),
      ...(pmid ? { pmid } : {}),
      ...(pmcid ? { pmcid } : {}),
      ...(typeof item.abstractText === 'string'
        ? { abstract: item.abstractText.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').slice(0, 3500) } : {}),
      source: typeof item.source === 'string' ? item.source.slice(0, 24) : 'Europe PMC',
      ...(typeof item.firstPublicationDate === 'string' ? { firstPublished: item.firstPublicationDate.slice(0, 15) } : {}),
      ...(typeof item.isOpenAccess === 'string' ? { isOpenAccess: item.isOpenAccess.toUpperCase() === 'Y' } : {}),
    })
  }
  return out
}

/**
 * Retrieve official Europe PMC metadata without API keys. This does not imply
 * full text or clinical reliability; article type and study quality are assessed separately.
 * @param query - search terms sent to Europe PMC.
 * @param limit - maximum records per page.
 * @param signal - optional cancellation signal.
 * @param request - injectable HTTP client for deterministic tests.
 * @param cursorMark - opaque continuation token from the previous response.
 * @returns provider metadata, pagination and explicit unavailable state.
 */
export async function searchEuropePmc(
  query: string, limit = 5, signal?: AbortSignal, request: typeof fetch = fetch,
  cursorMark?: string,
): Promise<{
  state: 'ok' | 'empty' | 'unavailable'
  source: string
  retrievedAt: string
  records: ScholarlyRecord[]
  nextCursorMark?: string
  hitCount?: number
  error?: string
}> {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 400
    || !Number.isInteger(limit) || limit < 1 || limit > 30
    || (cursorMark !== undefined && (cursorMark.length < 1 || cursorMark.length > 500
      || /[\x00-\x20]/u.test(cursorMark)))) {
    throw new ToolArgsError(['La búsqueda requiere 3 a 400 caracteres, 1 a 30 resultados y cursor válido.'])
  }
  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search')
  url.searchParams.set('query', query.trim())
  url.searchParams.set('format', 'json')
  url.searchParams.set('resultType', 'core')
  url.searchParams.set('pageSize', String(limit))
  if (cursorMark !== undefined) url.searchParams.set('cursorMark', cursorMark)
  const retrievedAt = new Date().toISOString()
  try {
    const response = await request(url.href, {
      headers: { Accept: 'application/json' },
      signal: signal === undefined ? AbortSignal.timeout(20000)
        : AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    })
    if (!response.ok) throw new Error('provider HTTP ' + String(response.status))
    const body = await response.text()
    if (body.length > 1800000) throw new Error('provider response exceeded safe length')
    const parsed = JSON.parse(body) as {
      resultList?: { result?: unknown[] }
      nextCursorMark?: unknown
      hitCount?: unknown
    }
    const records = projectEuropePmcRecords(parsed).slice(0, limit)
    const nextCursorMark = typeof parsed.nextCursorMark === 'string'
      && parsed.nextCursorMark !== cursorMark && records.length > 0
      ? parsed.nextCursorMark : undefined
    const hitCount = typeof parsed.hitCount === 'number' ? parsed.hitCount
      : typeof parsed.hitCount === 'string' && /^\d+$/u.test(parsed.hitCount)
        ? Number(parsed.hitCount) : undefined
    return { state: records.length ? 'ok' : 'empty', source: url.origin, retrievedAt, records,
      ...(nextCursorMark ? { nextCursorMark } : {}), ...(hitCount !== undefined ? { hitCount } : {}) }
  } catch (error) {
    if (signal?.aborted) throw error
    return { state: 'unavailable', source: url.origin, retrievedAt, records: [],
      error: error instanceof Error ? error.message.slice(0, 200) : 'provider unavailable' }
  }
}

/**
 * Public academic search with provider-authenticated bibliographic metadata.
 * @returns registered academic search tool.
 */
export function createScholarlySearchTool(): ToolDefinition {
  return defineTool({
    name: 'research_scholar',
    description: 'Consulta metadatos REALES de Europe PMC (PubMed/PMC y otros índices). Devuelve DOI/PMID, autores, título, revista, fecha y URL. Busca por SUBTEMA, diseño y período; recupera hasta 30 por lote y usa cursor_mark=nextCursorMark de la respuesta para continuar hasta alcanzar cobertura bibliográfica suficiente de tesis. Deduplica globalmente entre lotes por DOI/PMID. NO confundir metadatos con evidencia clínica verificada o texto completo. Sin API key; unavailable si el proveedor falla.',
    timeoutMs: 25000,
    parameters: {
      query: { type: 'string', required: true, description: 'Consulta académica, 3 a 400 caracteres.' },
      limit: { type: 'integer', description: 'Resultados 1 a 30 por lote, por defecto 5.' },
      cursor_mark: { type: 'string', description: 'Cursor devuelto como nextCursorMark por el lote anterior; permite paginar sin perder fuentes.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const result = await searchEuropePmc(args.query, args.limit ?? 5, exec.signal, fetch, args.cursor_mark)
      return result as unknown as Record<string, JsonValue>
    },
    presentCall(args) {
      return { card: 'generic', title: 'Literatura científica · ' + args.query.slice(0, 80), kind: 'search' }
    },
  })
}
