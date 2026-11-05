/**
 * Shared topic and geography screening for PHOENIX research, regardless of subject.
 * Deterministic evidence triage: this is NOT factual verification or a model answer.
 */
import type { WebSearchSource } from '@phoenix-ai/dsh-web'

const STOP = new Set((
  'que cual cuales como cuando donde quien quienes porque sobre entre para desde hasta antes despues'
  + ' sera seran habra hubo pueden podria proximo proximos durante segun ante acerca aquello'
  + ' datos informacion informacion estudio estudios investigaciones buscar busqueda investigar'
  + ' fuente fuentes evidencia resultados pronostico tendencia semana semanal mensual anual'
  + ' ultimamente ultimo ultimos ultimas noticia noticias actual actualizacion reciente'
  + ' los las una uno unos unas del por con sin al desde esta este estos estas esos aquellas'
  + ' son fue han ha haya tener tiene tienen casos caso numero cifras cantidad reporte'
  + ' the and for from when what which why how about latest with into after before where'
  + ' study data sources report reports research updated current year years does have been'
  + ' united republic republica dominicana dominican country pais world mundo global'
).split(/\s+/u))

/**
 * Canonicalize search text without confusing Spanish and English accents.
 * @param value - Untrusted search text.
 * @returns Normalized comparison string.
 */
export function normalizeResearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/%[0-9a-f]{2}/giu, match => {
      try { return decodeURIComponent(match) } catch { return match }
    })
    .replace(/[_./?&+=:-]/gu, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/**
 * Extract meaningful words while retaining the user's specific subject.
 * @param question - Original question.
 * @returns Deduplicated keywords suitable for a bounded query.
 */
export function researchFocus(question: string): string[] {
  const normalized = normalizeResearchText(question)
  const tokens = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []
  // Chinese text typically has no spaces; overlapping bigrams retain topical
  // overlap without discarding the entire question as non-Latin characters.
  const terms = tokens.flatMap(token =>
    /[\p{Script=Han}]{3,}/u.test(token)
      ? Array.from({ length: Math.min(10, token.length - 1) }, (_, i) => token.slice(i, i + 2))
      : [token])
  return [...new Set(terms.filter(token => !STOP.has(token) && !/^\d{4}$/u.test(token)))].slice(0, 12)
}

/**
 * Rewrite verbose questions to short, traceable topic-preserving search terms.
 * @param question - Original question.
 * @returns Concise query with named subject and geography retained.
 */
export function conciseResearchQuery(question: string): string {
  const terms = researchFocus(question)
  const years = [...question.matchAll(/\b(?:19|20)\d{2}\b/gu)].map(match => match[0]).slice(0, 2)
  const location = detectGeography(question)
  const named = /\b[A-ZÁÉÍÓÚ][\p{L}-]{2,}\s+(?:II|III|IV|VI|VII|VIII|IX|X)\b/u.exec(question)
  const words = [...(named ? ['"' + named[0] + '"'] : []), ...terms.slice(0, 7), ...years]
  const result = [...new Set([...words, ...(location ? [location.preferred] : [])])].join(' ').trim()
  return result || question.trim().slice(0, 180)
}

type Geography = { aliases: readonly string[]; preferred: string; officialTld?: string }
const GEOGRAPHY: readonly Geography[] = [
  { aliases: ['republica dominicana', 'dominican republic'], preferred: 'República Dominicana', officialTld: '.gob.do' },
  { aliases: ['estados unidos', 'united states', 'united states of america'], preferred: 'United States', officialTld: '.gov' },
  { aliases: ['mexico'], preferred: 'México', officialTld: '.gob.mx' },
  { aliases: ['colombia'], preferred: 'Colombia', officialTld: '.gov.co' },
  { aliases: ['espana', 'spain'], preferred: 'España', officialTld: '.gob.es' },
  { aliases: ['argentina'], preferred: 'Argentina', officialTld: '.gob.ar' },
  { aliases: ['chile'], preferred: 'Chile', officialTld: '.gob.cl' },
  { aliases: ['peru'], preferred: 'Perú', officialTld: '.gob.pe' },
  { aliases: ['brasil', 'brazil'], preferred: 'Brasil', officialTld: '.gov.br' },
]
function detectGeography(question: string): Geography | undefined {
  const norm = ' ' + normalizeResearchText(question) + ' '
  return GEOGRAPHY.find(item => item.aliases.some(alias => norm.includes(' ' + alias + ' ')))
}
function mentionsGeography(source: string, hostname: string, geo: Geography): boolean {
  return geo.aliases.some(alias => source.includes(alias))
    || (geo.officialTld !== undefined && hostname.toLowerCase().endsWith(geo.officialTld))
}
function phraseAnchor(question: string): string | undefined {
  const quoted = /["“]([^"”]{5,80})["”]/u.exec(question)?.[1]
  if (quoted && researchFocus(quoted).length > 0) return normalizeResearchText(quoted)
  // Roman numeral or numeric designation is part of the identity, not an
  // interchangeable time period (Artemis II vs Artemis III).
  const named = /\b([A-ZÁÉÍÓÚ][\p{L}\d-]{2,})\s+((?:II|III|IV|VI|VII|VIII|IX|X|[2-9]))\b/u.exec(question)
  return named ? normalizeResearchText(named[0]) : undefined
}
function aliasesForPhrase(phrase: string): string[] {
  const equivalents: Record<string, string> = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }
  const parts = phrase.split(' ')
  if (parts.length !== 2) return [phrase]
  const digit = equivalents[parts[1] ?? '']
  return digit ? [phrase, parts[0] + ' ' + digit] : [phrase]
}

/** Auditable screening result. A relevant search hit still must be opened. */
export interface ResearchRelevance {
  readonly relevant: boolean
  readonly score: number
  readonly reason: 'matched' | 'off_topic' | 'wrong_geography' | 'wrong_entity' | 'blocked_page'
}

/**
 * Screen a search lead for the actual user's topic, entity, and geography.
 * @param question - Unmodified original user question.
 * @param source - Search hit with untrusted metadata.
 * @param domain - Classified research topic, used for authority tie-break only.
 * @returns Topic-relevance diagnostics without claiming source truth.
 */
export function assessResearchRelevance(question: string, source: WebSearchSource, domain = 'general'): ResearchRelevance {
  let url: URL
  try { url = new URL(source.url) } catch { return { relevant: false, score: 0, reason: 'off_topic' } }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { relevant: false, score: 0, reason: 'off_topic' }
  const raw = [source.title ?? '', source.snippet ?? '', url.pathname].join(' ')
  if (/(?:captcha|just a moment|verify you are human|unusual traffic|access denied|robot check|challenge-platform|cf-chl)/iu.test(raw))
    return { relevant: false, score: 0, reason: 'blocked_page' }
  const haystack = normalizeResearchText(raw)
  const named = phraseAnchor(question)
  if (named && !aliasesForPhrase(named).some(alias => (' ' + haystack + ' ').includes(' ' + alias + ' ')))
    return { relevant: false, score: 0, reason: 'wrong_entity' }
  const geo = detectGeography(question)
  if (geo && !mentionsGeography(haystack, url.hostname, geo))
    return { relevant: false, score: 0, reason: 'wrong_geography' }
  const focus = researchFocus(question)
  // Never count a hostname alone as topical evidence: example.org is not a scientific answer.
  const synonyms: Record<string, readonly string[]> = {
    aps: ['atencion primaria', 'primer nivel', 'primary health care'],
    dolar: ['usd', 'exchange rate', 'tipo de cambio'],
    cambio: ['exchange rate', 'divisa'],
    alzheimer: ['alzheimer disease'],
    futbol: ['football', 'soccer'],
    beisbol: ['baseball', 'mlb'],
    dengue: ['arbovirosis dengue'],
  }
  const supported = focus.filter(token =>
    (' ' + haystack + ' ').includes(' ' + token + ' ')
      || (synonyms[token] ?? []).some(alias => haystack.includes(alias))).length
  const required = focus.length === 0 ? 0 : focus.length >= 5 ? 2 : 1
  if (supported < required && !named) return { relevant: false, score: 0, reason: 'off_topic' }
  // If no topical words exist, we cannot establish match from a URL-only result.
  if (supported === 0 && !named) return { relevant: false, score: 0, reason: 'off_topic' }
  const authority = /(?:^|\.)(?:gov|gov\.do|gob\.do|edu|int)$/u.test(url.hostname)
    || (domain === 'public_health' && /(?:^|\.)(?:paho\.org|who\.int)$/u.test(url.hostname))
  return { relevant: true, score: Math.min(100, supported * 12 + (named ? 20 : 0) + (geo ? 12 : 0) + (authority ? 10 : 0)), reason: 'matched' }
}

/**
 * Detect anti-bot challenge HTML rather than pretending it contains evidence.
 * @param body - Upstream HTML or text.
 * @returns True for known human-verification responses.
 */
export function isBlockedResearchBody(body: string): boolean {
  const start = body.slice(0, 8000)
  return /(?:<title[^>]*>\s*(?:just a moment|captcha|access denied)|cf-chl|g-recaptcha|hcaptcha|verify you are human|checking your browser|unusual traffic|robot verification)/iu.test(start)
}

/**
 * Extract a bounded legible prefix of already-retrieved source text.
 * @param body - Provider-bounded original text.
 * @param kind - Web fetch content type.
 * @param maxChars - Maximum characters returned.
 * @returns Plain text excerpt with script, navigation and markup removed.
 */
export function readableResearchExcerpt(body: string, kind: 'html' | 'text', maxChars = 1600): string {
  const bounded = body.slice(0, 48_000)
  const content = kind === 'html'
    ? bounded.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
      .replace(/<!--[^]*?-->/gu, ' ')
      .replace(/<[^>]*>/gu, ' ')
    : bounded
  const namedEntities: Record<string, string> = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  }
  return content.replace(/&#(\d+);/gu, (_full, n: string) => {
    const code = Number(n)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
  }).replace(/&(?:nbsp|amp|lt|gt|quot);/giu, token => namedEntities[token.toLowerCase()] ?? ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, maxChars)
}
