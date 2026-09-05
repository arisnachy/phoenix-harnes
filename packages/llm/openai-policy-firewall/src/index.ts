/**
 * Provider-scoped policy firewall for OpenAI-backed PHOENIX routes.
 *
 * PHOENIX remains provider-agnostic: this plugin does not impose OpenAI-specific
 * restrictions on unrelated providers. It applies a narrow, high-confidence
 * OpenAI contract gate only when the selected route is OpenAI/Codex, while a
 * provider-neutral credential-egress guard protects generated context sent to
 * every provider.
 *
 * The firewall is defense in depth, not a replacement for provider-side policy
 * enforcement. It deliberately avoids broad keyword censorship: a request is
 * blocked only when a prohibited OpenAI objective is expressed with a
 * high-confidence action pattern.
 *
 * @module @phoenix-ai/dsh-openai-policy-firewall
 */

import type { Context } from '@phoenix-ai/cordis'
import { LlmError } from '@phoenix-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, StreamChunk, ToolSchema } from '@phoenix-ai/dsh-llm'

export const name = 'openai-policy-firewall'
export const inject = ['llm']

/** Stable machine code used when an OpenAI contract boundary blocks a request. */
export const OPENAI_POLICY_BLOCKED = 'OPENAI_POLICY_BLOCKED'
/** Stable machine code used when generated context appears to contain a live credential. */
export const CREDENTIAL_EGRESS_BLOCKED = 'CREDENTIAL_EGRESS_BLOCKED'
/** Legacy browser-session transport intentionally unsupported by PHOENIX core. */
export const LEGACY_CHATGPT_WEB_PROVIDER = 'chatgpt-web'

/** One policy decision suitable for logs without echoing request content. */
export interface PolicyViolation {
  readonly code: typeof OPENAI_POLICY_BLOCKED | typeof CREDENTIAL_EGRESS_BLOCKED
  readonly rule:
    | 'unauthorized-chatgpt-web-transport'
    | 'reverse-engineering-or-model-extraction'
    | 'safeguard-or-rate-limit-bypass'
    | 'automated-output-harvesting'
    | 'competing-model-development'
    | 'credential-transfer'
    | 'generated-secret-egress'
  readonly message: string
}

const OPENAI_ROUTE_SEGMENT = /(?:^|[-_.])(openai|codex|chatgpt)(?:$|[-_.])/i

/** Extra custom route ids operators explicitly declare as OpenAI-backed. */
function configuredOpenAiRoutes(): ReadonlySet<string> {
  const value = process.env.PHOENIX_OPENAI_POLICY_PROVIDERS ?? ''
  return new Set(value.split(',').map(route => route.trim().toLowerCase()).filter(Boolean))
}

/** Whether this exact selected provider route is governed by the OpenAI overlay. */
export function isOpenAiRoute(provider: string): boolean {
  const normalized = provider.trim().toLowerCase()
  return OPENAI_ROUTE_SEGMENT.test(normalized) || configuredOpenAiRoutes().has(normalized)
}

function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-call':
      return `${block.name}\n${block.arguments}`
    case 'tool-result':
      return block.content.map(blockText).join('\n')
    default:
      return ''
  }
}

function messageText(message: Message): string {
  return message.content.map(blockText).filter(Boolean).join('\n')
}

function toolText(tool: ToolSchema): string {
  return `${tool.name}\n${tool.description}\n${JSON.stringify(tool.parameters)}`
}

/** User-originated intent only; generated policy text cannot trip intent rules. */
function userIntentText(options: GenerateOptions): string {
  return options.messages
    .filter(message => message.source.kind === 'user')
    .map(messageText)
    .filter(Boolean)
    .join('\n')
    .normalize('NFKC')
    .toLowerCase()
}

/**
 * Context produced by PHOENIX itself rather than typed directly by the user.
 * Secrets found here indicate an internal boundary failure and are refused
 * before any provider receives the request.
 */
function generatedContextText(options: GenerateOptions): string {
  const generatedMessages = options.messages
    .filter(message => message.source.kind !== 'user')
    .map(messageText)
  return [
    options.system ?? '',
    ...generatedMessages,
    ...(options.tools ?? []).map(toolText),
  ].filter(Boolean).join('\n')
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/,
  /\bBearer\s+eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{12,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]

function containsGeneratedSecret(options: GenerateOptions): boolean {
  const text = generatedContextText(options)
  return SECRET_PATTERNS.some(pattern => pattern.test(text))
}

const REVERSE_ENGINEERING = [
  /\b(?:reverse engineer|decompile|model extraction|model stealing|extract (?:the )?(?:model )?weights?|steal (?:the )?model|clone (?:the )?model|reconstruct (?:the )?model)\b/i,
  /\b(?:ingenier[ií]a inversa|extraer (?:los )?pesos|extracci[oó]n (?:del )?modelo|robar (?:el )?modelo|clonar (?:el )?modelo|reconstruir (?:el )?modelo)\b/i,
]
const SAFEGUARD_BYPASS = [
  /\b(?:bypass|circumvent|evade)\b.{0,80}\b(?:safety|safeguards?|guardrails?|rate[ -]?limits?|usage limits?|protective measures?)\b/i,
  /\b(?:eludir|evadir|saltarse|sortear)\b.{0,80}\b(?:seguridad|salvaguardas?|l[ií]mites? (?:de )?(?:uso|frecuencia|solicitudes)|restricciones?|medidas? de protecci[oó]n)\b/i,
]
const OUTPUT_HARVESTING = [
  /\b(?:scrape|harvest|extract|collect)\b.{0,80}\b(?:chatgpt|openai|codex|gpt)\b.{0,100}\b(?:outputs?|responses?)\b.{0,80}\b(?:bulk|mass|massive|at scale|systematic)\b/i,
  /\b(?:extraer|recolectar|raspar)\b.{0,80}\b(?:chatgpt|openai|codex|gpt)\b.{0,100}\b(?:salidas?|respuestas?)\b.{0,80}\b(?:masiv|a escala|sistem[aá]tic)\w*/i,
]
const COMPETING_MODEL = [
  /\b(?:train|fine[ -]?tune|distill|develop)\b.{0,120}\b(?:competing|competitor|clone)\b.{0,80}\bmodel\b.{0,120}\b(?:openai|chatgpt|codex|gpt|outputs?|responses?)\b/i,
  /\b(?:entrenar|ajustar|destilar|desarrollar)\b.{0,120}\b(?:competidor|competitivo|clon)\w*\b.{0,80}\bmodelo\b.{0,120}\b(?:openai|chatgpt|codex|gpt|salidas?|respuestas?)\b/i,
]
const CREDENTIAL_TRANSFER = [
  /\b(?:copy|export|forward|send|sell|transfer|steal)\b.{0,80}\b(?:openai|chatgpt|codex)\b.{0,80}\b(?:api key|oauth token|access token|refresh token|credential)\b/i,
  /\b(?:copiar|exportar|reenviar|enviar|vender|transferir|robar)\b.{0,80}\b(?:openai|chatgpt|codex)\b.{0,80}\b(?:clave api|token oauth|token de acceso|token de actualizaci[oó]n|credencial)\b/i,
]

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}

/**
 * Evaluate one fully assembled request before adapter dispatch.
 *
 * The legacy browser-session route is refused unconditionally. Credential
 * egress protection is provider-neutral. OpenAI contractual rules are then
 * applied only to an OpenAI-backed route, preserving universal-provider use.
 */
export function evaluateProviderPolicy(options: GenerateOptions): PolicyViolation | undefined {
  if (options.provider.trim().toLowerCase() === LEGACY_CHATGPT_WEB_PROVIDER) {
    return {
      code: OPENAI_POLICY_BLOCKED,
      rule: 'unauthorized-chatgpt-web-transport',
      message: 'PHOENIX blocks the legacy ChatGPT Web browser-session transport; use the native official Codex app-server bridge or the OpenAI API.',
    }
  }

  if (containsGeneratedSecret(options)) {
    return {
      code: CREDENTIAL_EGRESS_BLOCKED,
      rule: 'generated-secret-egress',
      message: 'PHOENIX blocked provider egress because generated system/tool context appears to contain a live credential.',
    }
  }

  if (!isOpenAiRoute(options.provider)) return undefined
  const text = userIntentText(options)

  if (matchesAny(text, REVERSE_ENGINEERING)) {
    return {
      code: OPENAI_POLICY_BLOCKED,
      rule: 'reverse-engineering-or-model-extraction',
      message: 'PHOENIX blocked an OpenAI request whose stated objective is model extraction or reverse engineering.',
    }
  }
  if (matchesAny(text, SAFEGUARD_BYPASS)) {
    return {
      code: OPENAI_POLICY_BLOCKED,
      rule: 'safeguard-or-rate-limit-bypass',
      message: 'PHOENIX blocked an OpenAI request whose stated objective is bypassing safeguards, restrictions, or usage/rate limits.',
    }
  }
  if (matchesAny(text, OUTPUT_HARVESTING)) {
    return {
      code: OPENAI_POLICY_BLOCKED,
      rule: 'automated-output-harvesting',
      message: 'PHOENIX blocked an OpenAI request whose stated objective is systematic automated harvesting of OpenAI output.',
    }
  }
  if (matchesAny(text, COMPETING_MODEL)) {
    return {
      code: OPENAI_POLICY_BLOCKED,
      rule: 'competing-model-development',
      message: 'PHOENIX blocked an OpenAI request whose stated objective is using OpenAI output to develop a competing model.',
    }
  }
  if (matchesAny(text, CREDENTIAL_TRANSFER)) {
    return {
      code: OPENAI_POLICY_BLOCKED,
      rule: 'credential-transfer',
      message: 'PHOENIX blocked an OpenAI request whose stated objective is transferring OpenAI account or API credentials.',
    }
  }
  return undefined
}

function denied(violation: PolicyViolation): AsyncIterable<StreamChunk> {
  return {
    async * [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
      throw new LlmError(violation.message, violation.code)
    },
  }
}

/** Install the firewall on the provider-neutral LLM waterfall. */
export function apply(ctx: Context): void {
  ctx.on('llm/stream', (options, next) => {
    const violation = evaluateProviderPolicy(options)
    if (violation !== undefined) {
      ctx.logger.warn('provider policy blocked request: provider=%s rule=%s', options.provider, violation.rule)
      return denied(violation)
    }
    return next()
  })
}
