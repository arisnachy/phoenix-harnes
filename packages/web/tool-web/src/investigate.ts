/**
 * PHOENIX Universal Evidence Research: bounded retrieval, not an ungrounded answer generator.
 * Uses only the already configured search/fetch seam; never bypasses site controls.
 */
import type { Context } from '@phoenix-ai/cordis'
import type { WebRuntime, WebSearchSource } from '@phoenix-ai/dsh-web'
import { defineTool } from '@phoenix-ai/dsh-tools'
import { planResearch } from './research.ts'

import { challengeText, safePublicUrl, researchFocus, scoreResearchLead } from './source-relevance.ts'
export { normalizeResearchText, researchFocus, scoreResearchLead } from './source-relevance.ts'

/**
 * Produce few, high-information queries with subject preservation.
 * @param question - Full natural-language research goal.
 * @param domain - Optional explicit research catalogue domain.
 * @returns One recall query and up to two site-scoped, topic-preserving queries.
 */
export function planEvidenceQueries(question: string, domain?: string): string[] {
  const plan = planResearch(question, domain, 0)
  const focus = researchFocus(question)
  const country = rdFocus(question) ? 'República Dominicana' : ''
  const year = (question.match(/\b(?:19|20)\d{2}\b/gu) ?? []).slice(0, 2).join(' ')
  // Roman-numeral suffixes ("Artemis II", "World War II") are part of
  // the named entity and must not be lost by token cleanup.
  const named = question.match(/\b([A-Za-z]{4,})\s+(I{1,3}|IV|V|VI{0,3}|IX|X)\b/u)?.[0] ?? ''
  const compact = [named, focus.slice(0, 7).join(' '), country, year].filter(Boolean).join(' ').slice(0, 185) || question
  const scoped = plan.queries.slice(1).map(query => {
    const host = query.match(/site:([\w.-]+)/u)?.[1]
    return host ? [compact, 'site:' + host].join(' ') : query
  })
  const alternatives = scoped.length ? scoped : [compact + ' fuente primaria oficial', compact + ' official source data']
  return [...new Set([compact, ...alternatives])].slice(0, 3)
}

type ReadStatus = 'read' | 'blocked' | 'unavailable' | 'off_topic'
interface EvidenceDocument {
  url: string
  title: string
  retrievedAt: string
  excerpt: string
  /** Relevance is lexical support, not a probability of correctness. */
  relevanceScore: number
  verification: 'retrieved_unverified'
}
interface DocumentAttempt { url: string; status: ReadStatus; reason: string }

/** Bounded research receipt. Sources are never silently upgraded to authenticated facts. */
export interface EvidenceInvestigation {
  kind: 'research_investigation'
  question: string
  domain: string
  status: 'evidence_retrieved' | 'leads_only' | 'blocked'
  queries: string[]
  failedQueries: string[]
  rejectedSearchHits: number
  /** Unopened, unverified leads retained for authorized follow-up. */
  leads: WebSearchSource[]
  /** Source directory candidates are hints, never implied retrieved or verified. */
  sourceOptions: Array<{ name: string; host: string; access: string }>
  /** Independent hosts with successfully retrieved content, not independent studies. */
  retrievedHosts: number
  /** HTTP-fetched content corroborated for topical relevance, not factual truth. */
  documents: EvidenceDocument[]
  attempts: DocumentAttempt[]
  observedAt: string
  nextStep: string
}

function pageText(body: string, kind: 'html' | 'text'): string {
  const content = kind === 'html' ? body.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/giu, ' ')
    .replace(/<[^>]{0,500}>/gu, ' ') : body
  return content.replace(/&#(x[\da-f]+|\d+);/giu, (matched, code: string) => {
    const n = code.toLowerCase().startsWith('x') ? Number.parseInt(code.slice(1),16) : Number.parseInt(code,10)
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : matched
  }).replace(/&(?:nbsp|amp|quot|lt|gt);/giu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 24000)
}
function extractEvidence(question: string, content: string): string {
  const focus = researchFocus(question)
  const normal = normalizeResearchText(content)
  const offsets = focus.map(word => normal.indexOf(word)).filter(x=>x >= 0)
  const start = offsets.length > 0 ? Math.max(0, Math.min(...offsets) - 140) : 0
  return content.slice(start, start + 650)
}

/**
 * Search, rerank and READ a small set of actual relevant documents, without
 * paid APIs, unbounded browsing or crossing CAPTCHA/robots restrictions.
 * @param web - Existing governed PHOENIX search+fetch capability.
 * @param question - Precise question from the user.
 * @param domain - Optional declared domain.
 * @param signal - Caller cancellation propagated to both stages.
 * @returns Search and HTTP-reading receipts, failures, uncertainty and next action.
 */
export async function investigateEvidence(
  web: Pick<WebRuntime, 'search' | 'fetch'>,
  question: string,
  domain?: string,
  signal?: AbortSignal,
): Promise<EvidenceInvestigation> {
  const plan = planResearch(question, domain, 0)
  const queries = planEvidenceQueries(question, domain)
  const failedQueries: string[] = []
  const pool = new Map<string, { source: WebSearchSource; score: number }>()
  let rejectedSearchHits = 0
  for (const query of queries) {
    if (signal?.aborted) throw signal.reason ?? new Error('investigation aborted')
    try {
      const outcome = await web.search({ query, maxResults: 10 }, signal)
      for (const lead of outcome.sources) {
        const safe = safePublicUrl(lead.url)
        if (safe === undefined) { rejectedSearchHits++; continue }
        const score = scoreResearchLead(question, { ...lead, url: safe })
        if (score === 0) { rejectedSearchHits++; continue }
        const previous = pool.get(safe)
        if (previous === undefined || score > previous.score) pool.set(safe, { source: { ...lead, url: safe }, score })
      }
      const differentHosts = new Set([...pool.keys()].map(url => new URL(url).hostname))
      // Sufficient discovery: a couple of independently hosted, topical leads.
      if (differentHosts.size >= 2 && pool.size >= 3) break
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      failedQueries.push(query)
      // Avoid repeatedly forcing an anti-bot HTML provider after two failures.
      if (failedQueries.length >= 2 && pool.size === 0) break
    }
  }
  const ranked = [...pool.values()].sort((a,b)=>b.score-a.score)
  const chosen: typeof ranked = []
  const hostSet = new Set<string>()
  for (const item of ranked) {
    const host = new URL(item.source.url).hostname
    if (!hostSet.has(host) && chosen.length < 4) {
      chosen.push(item)
      hostSet.add(host)
    }
  }
  for (const item of ranked) {
    if (chosen.length >= 4) break
    if (!chosen.includes(item)) chosen.push(item)
  }
  const documents: EvidenceDocument[] = []
  const attempts: DocumentAttempt[] = []
  // Up to four bounded fetches, in parallel across independent hosts. Each fetch
  // keeps the built-in SSRF, robots, byte, redirect and timeout safeguards.
  const results = await Promise.allSettled(chosen.slice(0, 4).map(async entry => {
    const url = entry.source.url
    try {
      const fetched = await web.fetch({ url }, signal)
      if (fetched.statusCode !== 200 || fetched.truncated) {
        return { url, status: 'blocked' as ReadStatus, reason: 'HTTP ' + fetched.statusCode + ' o documento truncado' }
      }
      if (challengeText(fetched.body.content)) {
        return { url, status: 'blocked' as ReadStatus, reason: 'CAPTCHA o comprobación de navegador' }
      }
      const content = pageText(fetched.body.content, fetched.body.kind)
      if (content.length < 120 || scoreResearchLead(question, {
        url, title: '', snippet: content.slice(0, 10000),
      }) === 0) {
        return { url, status: 'off_topic' as ReadStatus, reason: 'El documento recuperado no sustenta el tema solicitado' }
      }
      const canonical = safePublicUrl(fetched.url)
      if (canonical === undefined) return { url, status: 'unavailable' as ReadStatus, reason: 'URL final no pública o no segura' }
      return { url, status: 'read' as ReadStatus, reason: 'Documento HTTP recuperado y temáticamente relacionado',
        document: {
          url: canonical, title: (entry.source.title ?? new URL(canonical).hostname).slice(0, 180),
          retrievedAt: new Date().toISOString(), excerpt: extractEvidence(question, content),
          relevanceScore: entry.score, verification: 'retrieved_unverified' as const,
        } }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      return { url, status: 'unavailable' as ReadStatus, reason: 'Lectura bloqueada o fallo de red; consultar fuente alternativa' }
    }
  }))
  for (const result of results) {
    if (result.status === 'rejected') {
      if (signal?.aborted) throw signal.reason ?? result.reason
      continue
    }
    const value = result.value
    attempts.push({ url: value.url, status: value.status, reason: value.reason })
    if ('document' in value && value.document !== undefined) documents.push(value.document)
  }
  const leads = ranked.slice(0, 8).map(x=>x.source)
  const status = documents.length > 0 ? 'evidence_retrieved'
    : leads.length > 0 ? 'leads_only' : 'blocked'
  return {
    kind: 'research_investigation', question: question.trim(), domain: plan.domain, status,
    queries, failedQueries, rejectedSearchHits, leads, documents, attempts,
    sourceOptions: plan.candidates.map(x => ({name:x.name,host:x.host,access:x.access})),
    retrievedHosts: new Set(documents.map(d=>new URL(d.url).hostname)).size,
    observedAt: new Date().toISOString(),
    nextStep: documents.length
      ? 'Contrastar fechas, método, definiciones, datos numéricos y contradicciones antes de concluir. Si solo se recuperó un dominio, buscar corroboración independiente. El texto leído no autentica por sí solo una afirmación.'
      : leads.length
        ? 'Los enlaces son pistas sin evidencia leída: utilizar APIs oficiales, otros dominios autorizados o lectura humana; no citarlos como hechos.'
        : 'No se recuperó evidencia. Reformular términos, usar APIs abiertas o solicitar acceso autorizado; nunca inventar datos.',
  }
}

/**
 * Expose an investigation tool that actually reads source content, rather than
 * stopping after snippets or pretending that search results are verified.
 * @param ctx - Host tools, system prompt and web seams.
 * @param timeoutMs - The existing bounded research tool-call deadline.
 */
export function applyResearchInvestigation(ctx: Context, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:research_investigate',
    order: 111,
    text: 'RESEARCH INTELLIGENCE: For substantive factual investigation prefer research_investigate before citing search snippets. Preserve the exact entity, location, date and outcome; search concise topic queries, inspect source texts, reject irrelevant pages, and distinguish leads from HTTP-retrieved evidence. Use research_search for further domain batches, research_scholar for literature, and web_fetch on primary documents if more depth is necessary. If CAPTCHA/robots/DNS block a page, switch to an authorized source; never call a snippet a verified fact. Do not repeat searches without new constraints; stop early when sufficient relevant documents are read. For forecasting do NOT activate patient records/HealthIA without a patient-care request, and do not infer probabilities from search snippets.',
  })
  ctx.tools.register(defineTool({
    name: 'research_investigate',
    description: 'Investigación web universal y gratuita: conserva sujeto, lugar y horizonte; realiza búsquedas pertinentes, descarta resultados fuera de tema, abre documentos públicos con permisos y devuelve evidencia recuperada con procedencia, incertidumbre y errores. No inventa cifras ni sortea CAPTCHA.',
    parameters: {
      question: { type: 'string', required: true, description: 'Pregunta de investigación completa, con entidad, lugar y período cuando corresponda.' },
      domain: { type: 'string', description: 'Dominio opcional: public_health, science, software, medicine, sports, weather, economics, general, etc.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type:'text', text:value }] },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await investigateEvidence(ctx.web, args.question, args.domain, exec.signal)
      return JSON.stringify(result)
    },
    presentCall: () => ({card:'generic',title:'PHOENIX · investigación con lectura de fuentes',kind:'search' as const}),
  }))
}
