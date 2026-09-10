/** Presentation-only metadata for one Host-advertised model row. */
export interface ModelPresentation {
  readonly displayName: string
  readonly description?: string
  readonly badge?: 'Preview'
}

interface ProviderMark {
  readonly aliases: readonly string[]
  readonly slug: string
}

/**
 * Provider marks are deliberately conservative. Phoenix only emits an external
 * request when a configured provider can be matched to a known company alias;
 * arbitrary gateway ids never become speculative network requests.
 */
const PROVIDER_MARKS: readonly ProviderMark[] = [
  { aliases: ['openai', 'codex'], slug: 'openai' },
  { aliases: ['deepseek'], slug: 'deepseek' },
  { aliases: ['google', 'gemini', 'vertex'], slug: 'google' },
  { aliases: ['anthropic', 'claude'], slug: 'anthropic' },
  { aliases: ['mistral'], slug: 'mistralai' },
  { aliases: ['meta', 'llama'], slug: 'meta' },
  { aliases: ['nvidia'], slug: 'nvidia' },
  { aliases: ['huggingface', 'hugging face'], slug: 'huggingface' },
  { aliases: ['ollama'], slug: 'ollama' },
  { aliases: ['perplexity'], slug: 'perplexity' },
  { aliases: ['cohere'], slug: 'cohere' },
  { aliases: ['groq'], slug: 'groq' },
  { aliases: ['azure', 'microsoft'], slug: 'microsoftazure' },
  { aliases: ['aws', 'amazon bedrock', 'bedrock'], slug: 'amazonwebservices' },
]

const canonicalToken = (token: string): string => {
  const lower = token.toLowerCase()
  if (lower === 'deepseek') return 'DeepSeek'
  if (lower === 'gemini') return 'Gemini'
  if (lower === 'gpt') return 'GPT'
  if (lower === 'flash') return 'Flash'
  if (lower === 'lite') return 'Lite'
  if (lower === 'vision') return 'Vision'
  if (lower === 'pro') return 'Pro'
  if (lower === 'max') return 'Max'
  if (lower === 'computer') return 'Computer'
  if (lower === 'use') return 'Use'
  if (lower === 'deep') return 'Deep'
  if (lower === 'research') return 'Research'
  if (/^v\d+(?:\.\d+)*$/i.test(token)) return token.toUpperCase()
  return token.length === 0 ? token : `${token[0]?.toUpperCase() ?? ''}${token.slice(1)}`
}

const stripPresentationSuffixes = (name: string): { name: string; preview: boolean; experimental: boolean } => {
  let value = name.trim()
  const preview = /(?:^|[\s-])preview(?:$|[\s-(])/i.test(value)
  const experimental = /(?:^|[\s-])(?:exp|experimental)(?:$|[\s-(])/i.test(value)

  value = value
    .replace(/\s+Preview(?:\s*\([^)]*\))?\s*$/i, '')
    .replace(/-preview(?:-\d{1,4}){1,3}\s*$/i, '')
    .replace(/(?:-|\s)+(?:exp|experimental)\s*$/i, '')
    .trim()

  return { name: value, preview, experimental }
}

/**
 * Convert adapter-oriented catalog labels into compact human-facing copy.
 * Provider/model ids remain untouched; this function is display-only.
 */
export function presentModel(name: string, description?: string): ModelPresentation {
  const stripped = stripPresentationSuffixes(name)
  const tokens = stripped.name.split('-').filter(Boolean).map(canonicalToken)
  let displayName = tokens.join(' ').replace(/\s+/g, ' ').trim()
  // GPT family names conventionally keep the family/version dash while most
  // catalog ids become easier to scan as words.
  displayName = displayName.replace(/^GPT\s+(?=\d)/, 'GPT-')
  if (displayName.length === 0) displayName = name.trim()

  const lower = displayName.toLowerCase()
  let inferred: string | undefined
  if (lower.includes('deep research')) inferred = 'Research'
  else if (lower.includes('computer use')) inferred = 'Computer use'
  else if (lower.includes('flash lite')) inferred = 'Lightweight · Fast'
  else if (lower.includes('vision')) inferred = stripped.experimental ? 'Vision · Experimental' : 'Vision'
  else if (lower.includes('deepseek') && lower.includes(' pro')) inferred = 'Advanced reasoning'
  else if (lower.includes('gpt-5.6 sol')) inferred = 'Advanced reasoning'
  else if (lower.includes('flash') || lower.includes('gpt-5.6 luna')) inferred = 'Fast'
  else if (stripped.experimental) inferred = 'Experimental'

  const explicit = description?.trim()
  return {
    displayName,
    ...(explicit !== undefined && explicit.length > 0
      ? { description: explicit }
      : inferred === undefined ? {} : { description: inferred }),
    ...(stripped.preview ? { badge: 'Preview' as const } : {}),
  }
}

const providerHaystack = (providerId: string, providerName: string): string =>
  `${providerId} ${providerName}`.toLowerCase().replace(/[_./-]+/g, ' ')

/**
 * Resolve a known provider to a lazy Simple Icons CDN URL. Unknown providers
 * return undefined so private/custom ids never cause guessed external traffic.
 */
export function providerLogoUrl(providerId: string, providerName: string): string | undefined {
  const haystack = providerHaystack(providerId, providerName)
  const mark = PROVIDER_MARKS.find(candidate => candidate.aliases.some(alias => {
    const normalized = alias.toLowerCase()
    return haystack.split(/\s+/).includes(normalized) || haystack.includes(normalized)
  }))
  return mark === undefined ? undefined : `https://cdn.simpleicons.org/${mark.slug}`
}

/** Local fallback glyph rendered before, during, and after any logo request. */
export function providerInitial(providerName: string): string {
  return providerName.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'
}
