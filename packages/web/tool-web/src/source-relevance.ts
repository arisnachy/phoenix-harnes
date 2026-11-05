/** Pure relevance and identity screening shared by all PHOENIX research tools. */
import type { WebSearchSource } from '@phoenix-ai/dsh-web'

const STOP = new Set([
  'para','sobre','entre','desde','hasta','durante','antes','despues','cuales','cuando','donde',
  'como','porque','cual','quien','quienes','estos','estas','dicha','dicho','hacer','tiene',
  'tener','quiero','quieres','puede','podria','podrian','sera','seran','habra','sido',
  'investiga','investigacion','buscar','busqueda','encuentra','encontrar','fuentes','fuente',
  'oficial','oficiales','datos','informacion','estudio','estudios','resumen','explica',
  'comparar','comparacion','resultado','resultados','pronostico','prediccion','futuro',
  'probabilidad','proximos','proximo','proxima','tendencia','semanal','semanales','anual',
  'anuales','ano','anos','mensual','mensuales','numero','duracion','cantidad','diferencia',
  'republica','dominicana','dominicano','dominican','republic','territorio',
  'entre','the','and','for','from','what','when','where','which','will','have','been',
  'with','this','that','there','about','into','official','search','research','study',
  'data','report','reports','latest','current','future','prediction','forecast',
  'what','why','are','has','was','its','por','del','los','las','una','uno','que','con',
  'mis','sus','las','la','el','un','de','en','al','se','es','nos','su','lo','y',
])
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  dolar:['usd','dollar'],dinero:['money'],precio:['price'],inflacion:['inflation'],
  dengue:['arbovirus','arbovirosis'],clima:['weather','meteorology'],
  temperatura:['temperature'],hospital:['healthcare'],salud:['health'],
  futbol:['football','soccer'],beisbol:['baseball'],lanzamiento:['launch'],
  mision:['mission'],espacial:['space'],luna:['moon'],
  lanzada:['launch','launched'],lanzado:['launch','launched'],lanzara:['launch'],
  aps:['atencion primaria','primary care'],
}

/**
 * Normalize text for topic screening without claiming semantic or factual verification.
 * @param value - Original snippet, title or question.
 * @returns Accent-normalized, lowercase searchable text.
 */
export function normalizeResearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
}

/**
 * Extract distinguishing terms from a user question, dropping conversation filler.
 * @param question - User's full question.
 * @returns Bounded list of significant lexical tokens.
 */
export function researchFocus(question: string): string[] {
  const text = normalizeResearchText(question)
  const raw = text.match(/[\p{L}\p{N}]{3,}/gu) ?? []
  return [...new Set(raw.filter(x => !STOP.has(x) && !/^\d+$/u.test(x)))].slice(0, 10)
}
function matchesWord(text: string, token: string): boolean {
  const words = new Set(text.match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  return words.has(token) || (ALIASES[token] ?? []).some(alias => alias.includes(' ') ? text.includes(alias) : words.has(alias))
}
function rdFocus(question: string): boolean {
  return /rep[uú]blica dominicana|dominican republic|\bR\.?D\.?\b/iu.test(question)
}
function sourceCountryMatches(question: string, meta: string, hostname: string): boolean {
  if (!rdFocus(question)) return true
  const value = normalizeResearchText(meta)
  return /republica dominicana|dominican republic|dominicana|dominican|santo domingo/u.test(value)
    || /(?:^|\.)[\w-]+\.gob\.do$/u.test(hostname)
    || /(?:^|\.)gob\.do$/u.test(hostname)
}
/**
 * Identify challenge documents even when served with HTTP 200.
 * @param text - Bounded page text or HTML.
 * @returns Whether the page matches known challenge markers.
 */
export function challengeText(text: string): boolean {
  return /(?:<title[^>]*>\s*(?:just a moment|captcha|access denied|verify you)|cf-chl-|g-recaptcha|hcaptcha|data-sitekey=|verify you are human|unusual traffic)/iu
    .test(text.slice(0, 12000))
}
/**
 * Normalize only publicly addressable HTTPS URLs without credentials or fragments.
 * The actual network fetch separately enforces SSRF and DNS policies.
 * @param raw - Candidate result URL.
 * @returns Sanitized URL or undefined for an unsupported request.
 */
export function safePublicUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return undefined
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$|mc_cid$)/iu.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch { return undefined }
}

/**
 * Score a search lead by actual topic overlap; two unrelated domains are not evidence.
 * @param question - Original user intent with named topic and geography.
 * @param lead - Search provider's unverified URL/title/snippet.
 * @returns Zero for off-topic/blocked; otherwise a positive, relative relevance score.
 */
export function scoreResearchLead(question: string, lead: WebSearchSource): number {
  const url = safePublicUrl(lead.url)
  if (url === undefined) return 0
  const parsed = new URL(url)
  const title = lead.title ?? ''
  const snippet = lead.snippet ?? ''
  // A malformed percent-escape in a search-result path must not crash research.
  let pathname = parsed.pathname
  try { pathname = decodeURIComponent(pathname) } catch { /* keep encoded path */ }
  const combined = title + ' ' + snippet + ' ' + pathname
  if (challengeText(combined)) return 0
  if (!sourceCountryMatches(question, combined, parsed.hostname)) return 0
  const focus = researchFocus(question)
  if (focus.length === 0) return 0
  const text = normalizeResearchText(combined)
  const count = focus.filter(t => matchesWord(text, t)).length
  // Most substantial questions need two independent topic clues, not the words
  // "research", "study", "It", "news", "cases" or a shared year alone.
  // Short, accurate titles may name only the disease or product. Keep them
  // as leads; fetched documents still have to prove the subject independently.
  const minimum = focus.length >= 4 ? 2 : 1
  if (count < minimum) return 0
  const mainSubject = /\b(artemis|dengue)\b/u.exec(normalizeResearchText(question))?.[1]
  if (mainSubject !== undefined && !matchesWord(text, mainSubject)) return 0
  const official = /(?:^|\.)(?:gov|gob\.do|edu|int)$/u.test(parsed.hostname)
    || /(?:^|\.)(?:nasa\.gov|paho\.org|who\.int|epidemiologia\.gob\.do)$/u.test(parsed.hostname)
  const inTitle = focus.filter(t => matchesWord(normalizeResearchText(title),t)).length
  return count * 4 + inTitle * 2 + (official ? 5 : 0)
}

