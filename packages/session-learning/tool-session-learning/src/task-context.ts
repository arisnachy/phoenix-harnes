/** Bounded task fingerprinting used to keep learned procedures context-relevant. */

const MAX_SOURCE_CHARS = 8_192
const MAX_TOKENS = 64

/** Minimum deterministic lexical relevance required for automatic procedural recall. */
export const TASK_RELEVANCE_THRESHOLD = 0.3

const STOP_WORDS = new Set([
  'about', 'again', 'al', 'algo', 'algun', 'alguna', 'algunas', 'algunos', 'and', 'anterior', 'antes', 'another',
  'como', 'con', 'continue', 'cuando', 'de', 'del', 'desde', 'do', 'el', 'ella', 'en', 'es', 'esta', 'este', 'esto',
  'for', 'from', 'hacer', 'haz', 'la', 'las', 'last', 'lo', 'los', 'me', 'mi', 'more', 'otro', 'otra', 'para', 'parecido',
  'please', 'previous', 'problema', 'problem', 'que', 'resuelve', 'resolver', 'same', 'similar', 'the', 'this', 'to', 'un',
  'una', 'with', 'y', 'ya',
])

/** Compact, secret-free lexical identity for one task or reusable procedure. */
export interface TaskFingerprint {
  readonly normalized: string
  readonly tokens: readonly string[]
}

/**
 * Convert task text into a bounded deterministic fingerprint.
 * @param source - Current task text or procedure-identifying fragments.
 * @returns Normalized lexical fingerprint suitable for relevance matching.
 */
export function fingerprintTask(source: string | readonly string[]): TaskFingerprint {
  const joined = (Array.isArray(source) ? source.join(' ') : source).slice(0, MAX_SOURCE_CHARS)
  const normalized = normalize(joined)
  const tokens = [...new Set(normalized
    .split(/[^a-z0-9._/-]+/u)
    .map(token => token.replace(/^[-./_]+|[-./_]+$/gu, ''))
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token)))]
    .slice(0, MAX_TOKENS)
  return { normalized, tokens }
}

/**
 * Score task relevance without embeddings or hidden reasoning.
 * @param query - Current-task fingerprint or source text.
 * @param candidate - Stored-procedure fingerprint or source text.
 * @returns Similarity in the inclusive range 0..1.
 */
export function taskSimilarity(
  query: TaskFingerprint | string,
  candidate: TaskFingerprint | string,
): number {
  const left = typeof query === 'string' ? fingerprintTask(query) : query
  const right = typeof candidate === 'string' ? fingerprintTask(candidate) : candidate
  if (left.tokens.length === 0 || right.tokens.length === 0) return 0
  const rightSet = new Set(right.tokens)
  const overlap = left.tokens.reduce((count, token) => count + (rightSet.has(token) ? 1 : 0), 0)
  if (overlap === 0) return 0
  const containment = overlap / Math.min(left.tokens.length, right.tokens.length)
  const union = new Set([...left.tokens, ...right.tokens]).size
  const jaccard = overlap / union
  const exactPhraseBonus = left.normalized.length >= 12 && right.normalized.includes(left.normalized)
    || right.normalized.length >= 12 && left.normalized.includes(right.normalized)
    ? 0.08
    : 0
  return Math.min(1, (containment * 0.72) + (jaccard * 0.28) + exactPhraseBonus)
}

/**
 * Validate an untrusted persisted fingerprint before reuse.
 * @param value - Decoded JSON value.
 * @returns A bounded fingerprint or undefined when malformed.
 */
export function decodeTaskFingerprint(value: unknown): TaskFingerprint | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.normalized !== 'string' || record.normalized.length > MAX_SOURCE_CHARS) return undefined
  if (!Array.isArray(record.tokens) || record.tokens.length > MAX_TOKENS) return undefined
  if (!record.tokens.every(token => typeof token === 'string' && token.length > 0 && token.length <= 160)) return undefined
  return { normalized: record.normalized, tokens: record.tokens }
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}
