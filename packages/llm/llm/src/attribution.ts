/**
 * Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
 * adapters from drifting. See
 * `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
 *
 * App-attribution vocabulary for provider requests.
 * @module @phoenix-ai/dsh-llm/attribution
 */

import { createRequire } from 'node:module'

// The package's own manifest is the single source of the version so the
// User-Agent cannot drift from what is published (`./package.json` is an
// export of this package; the relative path resolves from both `src/` and
// the bundled `lib/`).
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
export interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  url: string
}

/**
 * PHOENIX's own identity: the default every adapter sends. Deployments that
 * need a white-label identity pass their own {@link AppIdentity} to the
 * attribution helpers — omission falls back to this default; nothing can
 * suppress attribution entirely.
 */
export const APP_IDENTITY: AppIdentity = {
  product: 'phoenix-harness',
  version,
  url: 'https://github.com/arisnachy/phoenix-harnes',
}

/**
 * The standard `User-Agent` value: `product/version (+url)`. The
 * parenthesized `+url` comment is the conventional self-identification form
 * (RFC 9110 §10.1.5 product + comment syntax).
 * @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
 * @returns the ready-to-send header value.
 */
export function userAgent(identity: AppIdentity = APP_IDENTITY): string {
  return `${identity.product}/${identity.version} (+${identity.url})`
}

/**
 * Build the provider-neutral attribution headers every adapter sends.
 * @param identity - the identity to send; defaults to {@link APP_IDENTITY}.
 * @returns the provider-neutral application identity headers.
 */
export function attributionHeaders(
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return { 'user-agent': userAgent(identity) }
}

/**
 * Build the OpenRouter app-attribution header set. OpenRouter uses the app URL
 * and title to group traffic under the public application identity; keeping
 * this provider-specific prevents those headers leaking to unrelated providers.
 * @param identity - the identity to publish; defaults to PHOENIX.
 * @returns PHOENIX `User-Agent`, app URL, and app title headers.
 */
export function openRouterAttributionHeaders(
  identity: AppIdentity = APP_IDENTITY,
): Record<string, string> {
  return {
    ...attributionHeaders(identity),
    'HTTP-Referer': identity.url,
    'X-Title': identity.product,
  }
}
