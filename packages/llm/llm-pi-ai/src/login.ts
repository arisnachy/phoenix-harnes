/**
 * Authorization flows for the pi-ai providers that ship a login. This is the
 * whole of the translation between the harness's neutral notice/prompt
 * vocabulary and pi-ai's `AuthInteraction`; nothing above it knows which
 * library ran the conversation.
 *
 * @module dsh-llm-pi-ai/login
 */

import { createModels } from '@earendil-works/pi-ai'
import type { AuthEvent, AuthPrompt, AuthType, Provider } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationMethod, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { recordKeyFor } from './auth.ts'
import type { PiAiAuthInjection } from './adapter.ts'

/**
 * Providers whose subscription/session authentication is owned by a native
 * product bridge rather than by pi-ai.
 *
 * `openai-codex` is intentionally excluded from the generic pi-ai OAuth flow.
 * Codex access tokens are an implementation detail of Codex-managed ChatGPT
 * authentication and are not a stable host API: refreshed or opaque tokens do
 * not necessarily expose `chatgpt_account_id`, while pi-ai's Codex Responses
 * path has historically attempted to derive that field from the token. PHOENIX
 * therefore delegates ChatGPT/Codex subscription auth to the official Codex
 * CLI/app-server provider, which owns login, persistence and refresh.
 *
 * OpenAI API-key usage is a separate provider path and remains available.
 */
export const NATIVE_SESSION_AUTH_PROVIDERS = new Set<string>(['openai-codex'])

/** Whether a catalog provider may register its login through pi-ai. */
export function usesPiAiLogin(providerId: string): boolean {
  return !NATIVE_SESSION_AUTH_PROVIDERS.has(providerId)
}

function loginMethods(provider: Provider | undefined): AuthorizationMethod[] {
  const methods: AuthorizationMethod[] = []
  const oauth = provider?.auth.oauth
  if (oauth !== undefined) methods.push({ id: 'oauth', label: oauth.loginLabel ?? oauth.name })
  const apiKey = provider?.auth.apiKey
  if (apiKey?.login !== undefined) methods.push({ id: 'api-key', label: apiKey.name })
  return methods
}

function relay(event: AuthEvent, session: AuthorizationSession): void {
  switch (event.type) {
    case 'info': {
      const link = event.links?.[0]
      session.notify({ message: event.message, ...link === undefined ? {} : { url: link.url } })
      return
    }
    case 'auth_url':
      session.notify({
        message: event.instructions ?? 'Open this page to continue signing in.',
        url: event.url,
      })
      return
    case 'device_code':
      session.notify({
        message: 'Enter this code on the verification page to finish signing in.',
        url: event.verificationUri,
        code: event.userCode,
      })
      return
    case 'progress':
      session.notify({ message: event.message })
      return
    default:
      session.notify({ message: 'Signing in…' })
  }
}

function restate(prompt: AuthPrompt): AuthorizationPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  switch (prompt.type) {
    case 'select':
      return { ...signal, kind: 'select', message: prompt.message, options: prompt.options }
    case 'secret':
      return {
        ...signal,
        kind: 'secret',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    default:
      return {
        ...signal,
        kind: 'text',
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
  }
}

/**
 * Register one authorization flow per installed provider that ships a login.
 * Native-session providers are deliberately omitted here and are expected to
 * expose authentication through their own product bridge.
 */
export function registerPiAiFlows(ctx: Context, auth: PiAiAuthInjection): void {
  for (const providerId of catalogProviderIds()) {
    if (!usesPiAiLogin(providerId)) {
      ctx.logger.info(
        'llm-pi-ai: provider "%s" uses native session authentication; generic pi-ai login is disabled',
        providerId,
      )
      continue
    }
    const provider = catalogProvider(providerId)
    const [first, ...rest] = loginMethods(provider)
    if (provider === undefined || first === undefined) continue
    if (!isCredentialKeySegment(providerId)) {
      ctx.logger.warn(
        'llm-pi-ai: catalog provider "%s" cannot address a credential record; its sign-in is not offered',
        providerId)
      continue
    }
    ctx.authorization.registerFlow({
      key: recordKeyFor(providerId),
      label: provider.name,
      methods: [first, ...rest],
      async run(session) {
        const models = createModels(auth)
        models.setProvider(provider)
        const type: AuthType = session.method === 'oauth' ? 'oauth' : 'api_key'
        await models.login(providerId, type, {
          signal: session.signal,
          notify: (event) => { relay(event, session) },
          prompt: prompt => session.prompt(restate(prompt)),
        })
      },
    })
  }
}
