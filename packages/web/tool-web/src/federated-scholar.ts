/** Bounded, anonymous, parallel scholarly discovery. Provider metadata is not a claim of study quality. */
import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { searchEuropePmc, type ScholarlyRecord } from './scholarly.ts'

export const FEDERATED_SOURCES = ['europepmc', 'crossref', 'openalex', 'datacite', 'semanticscholar'] as const
export type FederatedSource = typeof FEDERATED_SOURCES[number]
export interface FederatedRecord extends ScholarlyRecord {
  providers: string[]
}
export interface FederatedResponse {
  state: 'ok' | 'partial' | 'empty' | 'unavailable'
  retrievedAt: string
  query: string
  records: FederatedRecord[]
  sources: Array<{ id: FederatedSource; state: 'ok' | 'empty' | 'unavailable'; count: number; error?: string }>
  note: string
}
const validDoi = (input: unknown): string | undefined => {
  if (typeof input !== 'string') return undefined
  const doi = input.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '')
  return /^10\.\d{4,9}\/[^\s<>]{1,180}$/u.test(doi) ? doi : undefined
}
const clean = (x: unknown, max = 350): string =>
  typeof x === 'string' ? x.replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim().slice(0, max) : ''
const first = (x: unknown): unknown => Array.isArray(x) ? x[0] : undefined
const row = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? x as Record<string, unknown> : {}
const list = (x: unknown): unknown[] => Array.isArray(x) ? x : []
const year = (x: unknown): string => {
  if (typeof x === 'number' && Number.isInteger(x) && x >= 1800 && x <= 2100) return String(x)
  if (typeof x === 'string' && /^(18|19|20)\d{2}$/u.test(x)) return x
  return ''
}
const createRecord = (source: string, titleValue: unknown, authors: string, pubYear: unknown,
  journal: unknown, doiRaw: unknown, altUrl: string, altKey: string, abstractText?: unknown): ScholarlyRecord | undefined => {
  const title = clean(titleValue)
  const doi = validDoi(doiRaw)
  if (title.length < 5 || (!doi && !altUrl.startsWith('https://'))) return undefined
  return {
    key: doi ? 'doi' + doi.replace(/[^A-Za-z0-9]/gu, '_').slice(0, 61) : altKey,
    title,
    authors: clean(authors, 500),
    year: year(pubYear),
    journal: clean(journal, 160),
    url: doi ? 'https://doi.org/' + encodeURI(doi) : altUrl,
    ...(doi ? { doi } : {}),
    ...(clean(abstractText, 3000) ? { abstract: clean(abstractText, 3000) } : {}),
    source,
  }
}
/** Each adapter only projects provider-supplied fields; absent metadata stays absent. */
export function projectFederatedRecords(source: Exclude<FederatedSource, 'europepmc'>, payload: unknown): ScholarlyRecord[] {
  const root = row(payload)
  const records: ScholarlyRecord[] = []
  if (source === 'crossref') {
    for (const item of list(row(root.message).items)) {
      const x = row(item)
      const authors = list(x.author).map(a => { const p = row(a); return clean([p.given, p.family].filter(v => typeof v === 'string').join(' ')) }).filter(Boolean).join('; ')
      const parts = first(row(x.published)['date-parts'])
      const pubYear = first(parts)
      const out = createRecord('Crossref', first(x.title), authors, pubYear, first(x['container-title']), x.DOI, '', '')
      if (out) records.push(out)
    }
  } else if (source === 'openalex') {
    for (const item of list(root.results)) {
      const x = row(item)
      const authors = list(x.authorships).map(a => clean(row(row(a).author).display_name)).filter(Boolean).join('; ')
      const id = clean(x.id, 100)
      const alternate = /^https:\/\/openalex\.org\/W\d+$/u.test(id) ? id : ''
      const out = createRecord('OpenAlex', x.title, authors, x.publication_year,
        row(row(x.primary_location).source).display_name, x.doi, alternate, id.replace(/[^A-Za-z0-9]/gu, ''))
      if (out) records.push(out)
    }
  } else if (source === 'datacite') {
    for (const item of list(root.data)) {
      const x = row(row(item).attributes)
      const authors = list(x.creators).map(a => clean(row(a).name)).filter(Boolean).join('; ')
      const out = createRecord('DataCite', row(first(x.titles)).title, authors,
        x.publicationYear, x.publisher, x.doi, '', '')
      if (out) records.push(out)
    }
  } else {
    for (const item of list(root.data)) {
      const x = row(item)
      const ids = row(x.externalIds)
      const paperId = clean(x.paperId, 64)
      const alt = /^[a-f0-9]{40}$/iu.test(paperId)
        ? 'https://www.semanticscholar.org/paper/' + paperId : ''
      const authors = list(x.authors).map(a => clean(row(a).name)).filter(Boolean).join('; ')
      const out = createRecord('Semantic Scholar', x.title, authors, x.year,
        x.venue, ids.DOI, alt, paperId, x.abstract)
      if (out) records.push(out)
    }
  }
  return records.slice(0, 15)
}
const endpoints: Record<Exclude<FederatedSource, 'europepmc'>, (q: string, limit: number) => URL> = {
  crossref: (q, limit) => {
    const u = new URL('https://api.crossref.org/works')
    u.searchParams.set('query', q); u.searchParams.set('rows', String(limit))
    u.searchParams.set('select', 'DOI,title,author,published,container-title')
    return u
  },
  openalex: (q, limit) => {
    const u = new URL('https://api.openalex.org/works')
    u.searchParams.set('search', q); u.searchParams.set('per-page', String(limit))
    return u
  },
  datacite: (q, limit) => {
    const u = new URL('https://api.datacite.org/dois')
    u.searchParams.set('query', q); u.searchParams.set('page[size]', String(limit))
    return u
  },
  semanticscholar: (q, limit) => {
    const u = new URL('https://api.semanticscholar.org/graph/v1/paper/search')
    u.searchParams.set('query', q); u.searchParams.set('limit', String(limit))
    u.searchParams.set('fields', 'title,year,authors,externalIds,venue,abstract')
    return u
  },
}
async function requestRecords(source: FederatedSource, query: string, limit: number,
  signal: AbortSignal, fetcher: typeof fetch): Promise<ScholarlyRecord[]> {
  if (source === 'europepmc') {
    const response = await searchEuropePmc(query, limit, signal, fetcher)
    if (response.state === 'unavailable') throw new Error(response.error ?? 'Europe PMC unavailable')
    return response.records.map(r => ({ ...r, source: 'Europe PMC' }))
  }
  const url = endpoints[source](query, limit)
  const response = await fetcher(url.href, { signal, redirect: 'error',
    headers: { Accept: 'application/json', 'User-Agent': 'PHOENIX-Research/1.0 (public scholarly metadata)' } })
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('HTTP ' + String(response.status)) }
  const raw = await response.text()
  if (raw.length > 900_000) throw new Error('response exceeds size budget')
  return projectFederatedRecords(source, JSON.parse(raw) as unknown)
}
/** Federate provider search concurrently; do not swallow individual outages or invent references. */
export async function searchFederatedScholar(
  query: string, sources: readonly FederatedSource[] = FEDERATED_SOURCES, perSource = 6,
  signal?: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<FederatedResponse> {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 350
    || !Number.isInteger(perSource) || perSource < 1 || perSource > 15
    || sources.length < 1 || sources.length > 5
    || sources.some(source => !FEDERATED_SOURCES.includes(source))) {
    throw new ToolArgsError(['Query must have 3–350 characters, per_source 1–15, and 1–5 approved sources.'])
  }
  const selected = [...new Set(sources)]
  const scopedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(14_000)])
    : AbortSignal.timeout(14_000)
  const results = await Promise.all(selected.map(async source => {
    try {
      const records = await requestRecords(source, query.trim(), perSource, scopedSignal, fetcher)
      return { id: source, state: records.length ? 'ok' as const : 'empty' as const, records }
    } catch (error) {
      return { id: source, state: 'unavailable' as const, records: [] as ScholarlyRecord[],
        error: error instanceof Error ? error.message.slice(0, 140) : 'unavailable' }
    }
  }))
  if (signal?.aborted) throw signal.reason ?? new Error('research aborted')
  const sourcesStatus = results.map(result => ({
    id: result.id, state: result.state, count: result.records.length,
    ...('error' in result ? { error: result.error } : {}),
  }))
  const records: FederatedRecord[] = []
  const aliases = new Map<string, number>()
  for (let i = 0; i < perSource; i++) {
    for (const result of results) {
      const item = result.records[i]
      if (!item) continue
      const keys = [
        ...(item.doi ? ['doi:' + item.doi.toLowerCase()] : []),
        ...(item.pmid ? ['pmid:' + item.pmid] : []),
        'title:' + item.title.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
          .replace(/[^a-z0-9]/giu, '').toLowerCase() + ':' + item.year,
      ]
      const duplicate = keys.map(k => aliases.get(k)).find(k => k !== undefined)
      if (duplicate !== undefined) {
        const existing = records[duplicate]
        if (existing && !existing.providers.includes(item.source)) existing.providers.push(item.source)
        for (const key of keys) aliases.set(key, duplicate)
      } else {
        const position = records.length
        records.push({ ...item, providers: [item.source] })
        for (const key of keys) aliases.set(key, position)
      }
    }
  }
  const hasFailure = sourcesStatus.some(s => s.state === 'unavailable')
  const hasSuccess = sourcesStatus.some(s => s.state !== 'unavailable')
  return {
    state: records.length ? hasFailure ? 'partial' : 'ok' : hasSuccess ? 'empty' : 'unavailable',
    retrievedAt: new Date().toISOString(),
    query: query.trim(),
    records: records.slice(0, 45),
    sources: sourcesStatus,
    note: 'Metadatos de proveedores públicos; no son texto completo, evaluación metodológica ni evidencia clínica contrastada. Verificar DOI/PMID, fecha, diseño, retractación y lectura antes de concluir.',
  }
}
/** Model-facing parallel academic source search with explicit provider health. */
export function createFederatedScholarTool(): ToolDefinition {
  return defineTool({
    name: 'research_federated',
    description: 'Busca artículos y productos académicos reales EN PARALELO en Europe PMC, Crossref, OpenAlex, DataCite y Semantic Scholar sin API key. Deduplica DOI/PMID/título, conserva fuentes y reporta fallos por proveedor. Para medicina complementa con research_scholar/MeSH y ensayos clínicos. Metadatos NO son evidencia verificada. Consulta research_catalog para otras disciplinas y bases oficiales.',
    timeoutMs: 20000,
    parameters: {
      query: { type: 'string', required: true, description: 'Pregunta académica concisa o concepto científico 3–350 caracteres.' },
      per_source: { type: 'integer', description: 'Resultados por proveedor, 1–15; por defecto 6.' },
      sources: { type: 'array', items: { type: 'string' },
        description: 'Proveedores opcionales: europepmc, crossref, openalex, datacite, semanticscholar.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const sources = args.sources === undefined ? FEDERATED_SOURCES
        : args.sources as FederatedSource[]
      const response = await searchFederatedScholar(args.query, sources, args.per_source ?? 6, exec.signal)
      return response as unknown as Record<string, JsonValue>
    },
    presentCall(args) {
      return { card: 'generic', title: 'Investigación académica · ' + args.query.slice(0, 80), kind: 'search' }
    },
  })
}
