/**
 * Real-time bibliographic metadata checks against fixed public providers.
 * Never equate an absent retraction flag with proof that the work is sound.
 */
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

export type ReferenceCandidate = { key: string; title: string; authors?: string; year?: string; doi?: string; pmid?: string }
type SourceResult = {
  key: string
  doi: string | null
  pmid: string | null
  status: 'verified_metadata' | 'mismatch' | 'unverified'
  retraction: 'flagged' | 'no_flag_found' | 'not_checked'
  checked: string[]
  warnings: string[]
  title_from_provider?: string
  provider_links: string[]
}
type Fetcher = typeof fetch
const DOI = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/u
const PMID = /^\d{1,12}$/u

function normalizeTitle(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\s+/gu, ' ')
}
function matchingTitle(expected: string, actual: string): boolean {
  const a = normalizeTitle(expected)
  const b = normalizeTitle(actual)
  if (a === b) return true
  if (!a || !b) return false
  const sa = new Set(a.split(' '))
  const sb = new Set(b.split(' '))
  const intersection = [...sa].filter(word => sb.has(word)).length
  return 2 * intersection / (sa.size + sb.size) >= 0.83
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
async function queryJson(url: string, fetcher: Fetcher, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'PhoenixResearchStudio/1.0 (academic metadata validation)' },
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response.ok) throw new Error('provider HTTP ' + response.status)
    const body = await response.text()
    if (body.length > 1_000_000) throw new Error('provider response too large')
    return object(JSON.parse(body))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
function retractionFromCrossref(record: Record<string, unknown>): boolean {
  const updates = record['update-to']
  const entries = Array.isArray(updates) ? updates : updates ? [updates] : []
  return entries.some(update => {
    const type = String(object(update).type ?? '').toLowerCase()
    return /retract|withdraw/iu.test(type)
  })
}
function retractionFromEuropePmc(record: Record<string, unknown>): boolean {
  if (record.isRetracted === true || record.isRetracted === 'Y') return true
  const corrections = object(record.commentCorrectionList).commentCorrection
  return Array.isArray(corrections) && corrections.some(value => {
    const correction = object(value)
    return /retract/iu.test(String(correction.type ?? ''))
  })
}
/**
 * Audit supplied scholarly references against Crossref and Europe PMC public metadata.
 * @param references - already cited, structured work identifiers.
 * @param fetcher - injectable transport for reproducible tests.
 * @param signal - cancellation requested by the active task.
 * @returns evidence and explicit uncertainty for each candidate.
 */
export async function verifyResearchSources(
  references: readonly ReferenceCandidate[], fetcher: Fetcher = fetch, signal?: AbortSignal,
): Promise<{ state: 'AUDITED' | 'PARTIAL'; checked_at: string; sources: SourceResult[]; disclaimer: string }> {
  if (references.length < 1 || references.length > 50) throw new ToolArgsError(['Verifica de 1 a 50 referencias por lote.'])
  const keys = new Set<string>()
  for (const ref of references) {
    if (!ref || !/^[A-Za-z0-9_-]{1,64}$/u.test(ref.key) || keys.has(ref.key)
      || typeof ref.title !== 'string' || !ref.title.trim() || ref.title.length > 450) {
      throw new ToolArgsError(['Cada referencia necesita key único y título real.'])
    }
    keys.add(ref.key)
    if (ref.doi !== undefined && !DOI.test(ref.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, ''))) {
      throw new ToolArgsError(['DOI inválido para ' + ref.key])
    }
    if (ref.pmid !== undefined && !PMID.test(ref.pmid)) throw new ToolArgsError(['PMID inválido para ' + ref.key])
  }
  const checkedAt = new Date().toISOString()
  const out: SourceResult[] = []
  for (const ref of references) {
    if (signal?.aborted) throw new Error('Verificación cancelada')
    const doi = ref.doi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '') ?? null
    const pmid = ref.pmid ?? null
    const row: SourceResult = { key: ref.key, doi, pmid, status: 'unverified',
      retraction: 'not_checked', checked: [], warnings: [], provider_links: [] }
    let matches = 0
    let mismatches = 0
    let retractionQueried = false
    if (doi !== null) {
      try {
        const url = 'https://api.crossref.org/works/' + encodeURIComponent(doi)
        const result = await queryJson(url, fetcher, signal)
        const work = object(result.message)
        row.checked.push('Crossref')
        row.provider_links.push('https://doi.org/' + doi)
        const providerTitle = String((Array.isArray(work.title) ? work.title[0] : '') ?? '')
        if (providerTitle) {
          row.title_from_provider = providerTitle
          if (matchingTitle(ref.title, providerTitle)) matches++
          else { mismatches++; row.warnings.push('El título no coincide con Crossref.') }
        } else row.warnings.push('Crossref no proporcionó título.')
        if (typeof work.DOI === 'string' && work.DOI.toLowerCase() !== doi.toLowerCase()) {
          mismatches++; row.warnings.push('El DOI de Crossref no coincide.')
        }
        if (retractionFromCrossref(work)) row.retraction = 'flagged'
        else row.retraction = 'no_flag_found'
        retractionQueried = true
      } catch (error) { row.warnings.push('Crossref no disponible o DOI sin registro: ' + String(error).slice(0,100)) }
    }
    if (pmid !== null) {
      try {
        const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query='
          + encodeURIComponent('EXT_ID:' + pmid + ' AND SRC:MED') + '&format=json&resultType=core&pageSize=1'
        const result = await queryJson(url, fetcher, signal)
        const items = object(result.resultList).result
        const record = Array.isArray(items) ? object(items[0]) : {}
        if (String(record.id ?? '') !== pmid) throw new Error('PMID not matched')
        row.checked.push('Europe PMC')
        row.provider_links.push('https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/')
        const providerTitle = String(record.title ?? '')
        if (providerTitle) {
          row.title_from_provider = providerTitle
          if (matchingTitle(ref.title, providerTitle)) matches++
          else { mismatches++; row.warnings.push('El título no coincide con Europe PMC.') }
        }
        if (doi && typeof record.doi === 'string' && record.doi.toLowerCase() !== doi.toLowerCase()) {
          mismatches++; row.warnings.push('El DOI y el PMID identifican obras diferentes.')
        }
        if (retractionFromEuropePmc(record)) row.retraction = 'flagged'
        else if (row.retraction !== 'flagged') row.retraction = 'no_flag_found'
        retractionQueried = true
      } catch (error) { row.warnings.push('Europe PMC sin confirmación del PMID: ' + String(error).slice(0,100)) }
    }
    if (!doi && !pmid) row.warnings.push('Sin DOI ni PMID: no hay coincidencia de identificador comprobada.')
    if (retractionQueried && row.retraction === 'no_flag_found') {
      row.warnings.push('Ninguna alerta encontrada no demuestra ausencia de retractaciones.')
    }
    row.status = mismatches > 0 ? 'mismatch' : matches > 0 ? 'verified_metadata' : 'unverified'
    out.push(row)
  }
  return { state: out.every(row => row.status === 'verified_metadata' && row.retraction !== 'flagged')
    ? 'AUDITED' : 'PARTIAL', checked_at: checkedAt, sources: out,
    disclaimer: 'Se verifican identificadores y metadatos consultables, no resultados ni validez científica. La detección de retractaciones es parcial y nunca constituye una garantía.' }
}
/**
 * Provide real metadata and retraction flag checks to the orchestrated research workflow.
 * @returns a bounded, cancellable research-source verification tool.
 */
export function createResearchSourceVerifierTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_research_verify_sources',
    description: 'Comprueba DOI con Crossref y PMID con Europe PMC en tiempo real, compara títulos, identifica alertas de retractación cuando estén publicadas y devuelve incertidumbres de manera explícita. No inventes resultados si los proveedores fallan. Un resultado sin alertas NO garantiza que un estudio no esté retractado. Ejecutar antes de redactar la bibliografía final. Entradas references:[{key,title,doi?,pmid?,authors?,year?}]. Solo consulta proveedores públicos HTTPS fijos.',
    timeoutMs: 240000,
    parameters: {
      references: { type: 'array', required: true, description: 'Hasta 50 fuentes con DOI o PMID cuando estén disponibles.', items: { type: 'object', additionalProperties: true } },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text',
        text: 'Auditoría de fuentes: ' + String(value.state) + ' — ' + JSON.stringify(value.sources),
      }] },
    async execute(args, exec) { return await verifyResearchSources(args.references as ReferenceCandidate[], fetch, exec.signal) },
    presentCall() { return { card: 'generic', title: 'Verificar DOI, PMID y retractaciones', kind: 'execute' } },
  })
}
