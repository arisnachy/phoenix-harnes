import {
  siAlibabacloud,
  siAnthropic,
  siDeepseek,
  siGooglegemini,
  siHuggingface,
  siKimi,
  siMeta,
  siMistralai,
  siMoonshotai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
} from 'simple-icons'

/** Presentation-only metadata for one Host-advertised model row. */
export interface ModelPresentation {
  readonly displayName: string
  readonly description?: string
  readonly badge?: 'Preview'
}

interface SimpleIconData {
  readonly hex: string
  readonly path: string
  readonly slug: string
}

/** Official provider mark data used by the offline model selector. */
export interface ProviderMark {
  readonly aliases: readonly string[]
  readonly hex: string
  readonly path: string
  readonly slug: string
}

const openAiMark: ProviderMark = {
  aliases: ['openai', 'codex'],
  hex: '10A37F',
  path: 'M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a.08.08 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681z',
  slug: 'openai',
}

const providerMark = (aliases: readonly string[], icon: SimpleIconData): ProviderMark => ({
  aliases,
  hex: icon.hex,
  path: icon.path,
  slug: icon.slug,
})

/** Known marks come from packaged official paths; unknown ids use a monogram. */
const PROVIDER_MARKS: readonly ProviderMark[] = [
  openAiMark,
  providerMark(['openrouter'], siOpenrouter),
  providerMark(['deepseek'], siDeepseek),
  providerMark(['google', 'gemini', 'vertex'], siGooglegemini),
  providerMark(['anthropic', 'claude'], siAnthropic),
  providerMark(['mistral'], siMistralai),
  providerMark(['meta', 'llama'], siMeta),
  providerMark(['nvidia'], siNvidia),
  providerMark(['huggingface', 'hugging face'], siHuggingface),
  providerMark(['ollama'], siOllama),
  providerMark(['perplexity'], siPerplexity),
  providerMark(['qwen'], siQwen),
  providerMark(['kimi'], siKimi),
  providerMark(['moonshot'], siMoonshotai),
  providerMark(['alibaba'], siAlibabacloud),
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
 * @param name Adapter-provided model label.
 * @param description Optional adapter-provided description.
 * @returns Presentation-only model metadata.
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

const providerAliasMatches = (haystack: string, alias: string): boolean => {
  const tokens = haystack.split(/\s+/)
  return alias.toLowerCase().split(/\s+/).every(token => tokens.includes(token))
}

/**
 * Resolve a provider id/name to its packaged official mark, if known.
 * @param providerId Adapter-provided provider id.
 * @param providerName Adapter-provided provider display name.
 * @returns Packaged provider mark, or undefined for an unknown provider.
 */
export function providerBrandMark(providerId: string, providerName: string): ProviderMark | undefined {
  const haystack = providerHaystack(providerId, providerName)
  return PROVIDER_MARKS.find(candidate => candidate.aliases.some(alias => providerAliasMatches(haystack, alias)))
}

/**
 * Return the offline fallback glyph for an unknown provider.
 * @param providerName Provider display name.
 * @returns The first alphanumeric character, or '?' when none exists.
 */
export function providerInitial(providerName: string): string {
  return providerName.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'
}
