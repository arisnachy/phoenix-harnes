/**
 * The one credential-shape incompatibility this adapter repairs itself.
 *
 * pi-ai's ChatGPT Codex backend authenticates with a ChatGPT OAuth access JWT
 * and derives the ChatGPT account from its claims; any other credential shape
 * — a platform `sk-…` key above all — dies inside wire code before any HTTP
 * request (`Failed to extract accountId from token`). A route may legitimately
 * resolve such a key, so rather than failing every request, the adapter serves
 * the same model id over the standard OpenAI Responses protocol, which accepts
 * a platform key as a plain Bearer credential.
 *
 * @module dsh-llm-pi-ai/codex-platform
 */

import type { Api, Model } from '@earendil-works/pi-ai'

/** The platform OpenAI endpoint that serves Responses models with an API key. */
export const OPENAI_PLATFORM_RESPONSES_BASE_URL = 'https://api.openai.com/v1'

/** The JWT claim namespace OpenAI stamps ChatGPT account facts under. */
const CHATGPT_AUTH_CLAIM = 'https://api.openai.com/auth'

/**
 * Decode one base64url JWT segment. Node accepts the URL-safe alphabet and
 * missing padding natively, so no hand normalization is needed.
 */
function decodeJwtSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown
}

/**
 * Whether a resolved credential can authenticate pi-ai's ChatGPT Codex
 * backend: that backend demands the OAuth access JWT, whose base64url JSON
 * header always starts `eyJ`. Any other shape cannot name an account.
 * @param credential - the resolved credential value.
 * @returns true when the value decodes as a three-segment JWT.
 */
export function isChatGptAccessJwt(credential: string): boolean {
  const segments = credential.split('.')
  const [header] = segments
  return segments.length === 3
    && segments.every(segment => segment.length > 0)
    && header?.startsWith('eyJ') === true
}

/**
 * Whether the credential is a ChatGPT access JWT that actually names a
 * ChatGPT account — the shape check plus the account claim the Codex wire
 * derives its `chatgpt-account-id` header from. A JWT that passes the shape
 * check but misses the claim dies inside pi-ai before any HTTP request with
 * an opaque extraction error, so callers use this to recognize the failure
 * before it happens and say what to do instead.
 * @param credential - the resolved credential value.
 * @returns true when the payload carries a non-empty `chatgpt_account_id`.
 */
export function isChatGptAccountJwt(credential: string): boolean {
  if (!isChatGptAccessJwt(credential)) return false
  try {
    const payload = decodeJwtSegment(credential.split('.')[1] ?? '')
    const auth = payload as { [CHATGPT_AUTH_CLAIM]?: { chatgpt_account_id?: unknown } }
    const accountId = auth[CHATGPT_AUTH_CLAIM]?.chatgpt_account_id
    return typeof accountId === 'string' && accountId.length > 0
  } catch {
    return false
  }
}

/**
 * The same model served over the platform Responses protocol.
 * @param model - the codex-route model descriptor.
 * @param baseURL - an explicitly configured route endpoint to keep honoring,
 *   or undefined for the platform default.
 * @returns the model view to stream when Codex auth is impossible.
 */
export function codexPlatformFallbackModel(model: Model<Api>, baseURL: string | undefined): Model<Api> {
  return { ...model, api: 'openai-responses', baseUrl: baseURL ?? OPENAI_PLATFORM_RESPONSES_BASE_URL }
}
