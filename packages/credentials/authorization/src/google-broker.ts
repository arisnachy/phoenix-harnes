/**
 * Google Workspace OAuth compatibility boundary.
 *
 * The established broker implementation remains in `google-broker-legacy.ts`.
 * This module tightens the browser ceremony without widening the credential
 * boundary: the loopback page stays pending until the authorization-code
 * exchange actually succeeds, and provider exchange failures preserve a short
 * diagnostic instead of collapsing to an opaque HTTP-only error.
 */

import { createServer, type Server, type ServerResponse } from 'node:http'
import { AuthorizationError } from './index.ts'
import GoogleApiBroker, { internals } from './google-broker-legacy.ts'

export * from './google-broker-legacy.ts'
export default GoogleApiBroker

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const LOOPBACK_HOST = '127.0.0.1'
const CALLBACK_PATH = '/oauth2/callback'
const MAX_PROVIDER_ERROR = 500

interface PendingBrowserExchange {
  readonly code: string
  readonly response: ServerResponse
  settled: boolean
}

interface LoopbackReceiver {
  readonly redirectUri: string
  readonly code: Promise<string>
  close(): Promise<void>
}

/** Test seam for the real provider request made by the OAuth compatibility layer. */
export const googleOauthCompatInternals: { fetch: typeof fetch } = { fetch: globalThis.fetch }

const pendingByCode = new Map<string, PendingBrowserExchange>()

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function finishBrowser(pending: PendingBrowserExchange, status: number, text: string): void {
  if (pending.settled || pending.response.writableEnded) return
  pending.settled = true
  pendingByCode.delete(pending.code)
  pending.response.statusCode = status
  pending.response.setHeader('content-type', 'text/plain; charset=utf-8')
  pending.response.setHeader('cache-control', 'no-store')
  pending.response.setHeader('x-content-type-options', 'nosniff')
  pending.response.end(text)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, LOOPBACK_HOST)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await closeServer(server)
    throw new AuthorizationError('Google loopback receiver did not bind an IP port', 'GOOGLE_CALLBACK_BIND')
  }
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

/**
 * Hold the browser callback open until the token exchange confirms the login.
 * A successful authorization code is not yet a connected Google account.
 */
async function openVerifiedLoopback(expectedState: string, signal: AbortSignal): Promise<LoopbackReceiver> {
  const settled = Promise.withResolvers<string>()
  let finished = false
  let pendingCode: string | undefined

  const server = createServer((request, response) => {
    const finish = (status: number, text: string): void => {
      response.statusCode = status
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.setHeader('x-content-type-options', 'nosniff')
      response.end(text)
    }
    if (request.method !== 'GET' || request.url === undefined) {
      finish(404, 'Not found')
      return
    }
    const callback = new URL(request.url, `http://${LOOPBACK_HOST}`)
    if (callback.pathname !== CALLBACK_PATH) {
      finish(404, 'Not found')
      return
    }
    if (finished) {
      finish(409, 'Authorization already completed. Return to PHOENIX.')
      return
    }
    if (callback.searchParams.get('state') !== expectedState) {
      finished = true
      finish(400, 'Authorization rejected. Return to PHOENIX and try again.')
      settled.reject(new AuthorizationError('Google OAuth state did not match', 'GOOGLE_STATE_MISMATCH'))
      return
    }
    const providerError = callback.searchParams.get('error')
    if (providerError !== null) {
      finished = true
      const description = callback.searchParams.get('error_description')
      finish(400, 'Google authorization was not completed. Return to PHOENIX.')
      const detail = description === null ? providerError : `${providerError}: ${description}`
      settled.reject(new AuthorizationError(
        `Google authorization was declined or refused (${detail.slice(0, MAX_PROVIDER_ERROR)})`,
        'GOOGLE_AUTH_REFUSED',
      ))
      return
    }
    const code = callback.searchParams.get('code')
    if (!nonEmpty(code)) {
      finished = true
      finish(400, 'Authorization response was incomplete. Return to PHOENIX.')
      settled.reject(new AuthorizationError('Google returned no authorization code', 'GOOGLE_CODE_MISSING'))
      return
    }

    finished = true
    pendingCode = code
    pendingByCode.set(code, { code, response, settled: false })
    // Deliberately do not complete the HTTP response yet. The exchange wrapper
    // below resolves this page only after Google has accepted the code + PKCE.
    settled.resolve(code)
  })

  const port = await listen(server)
  const onAbort = (): void => {
    if (!finished) {
      finished = true
      settled.reject(signal.reason ?? new Error('Google authorization cancelled'))
    }
    if (pendingCode !== undefined) {
      const pending = pendingByCode.get(pendingCode)
      if (pending !== undefined) {
        finishBrowser(pending, 499, 'Google authorization was cancelled. Return to PHOENIX.')
      }
    }
    void closeServer(server)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  return {
    redirectUri: `http://${LOOPBACK_HOST}:${String(port)}${CALLBACK_PATH}`,
    code: settled.promise.finally(() => { signal.removeEventListener('abort', onAbort) }),
    close: async () => {
      if (pendingCode !== undefined) {
        const pending = pendingByCode.get(pendingCode)
        if (pending !== undefined) {
          finishBrowser(pending, 500, 'Google authorization did not finish. Return to PHOENIX and try again.')
        }
      }
      await closeServer(server)
    },
  }
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function formBody(body: BodyInit | null | undefined): URLSearchParams | undefined {
  if (body instanceof URLSearchParams) return body
  if (typeof body === 'string') return new URLSearchParams(body)
  return undefined
}

function shortProviderError(value: unknown, status: number): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const code = nonEmpty(record['error']) ? record['error'].trim() : undefined
    const description = nonEmpty(record['error_description']) ? record['error_description'].trim() : undefined
    const joined = [code, description].filter((part): part is string => part !== undefined).join(': ')
    if (joined !== '') return joined.replace(/\s+/gu, ' ').slice(0, MAX_PROVIDER_ERROR)
  }
  return `HTTP ${String(status)}`
}

async function providerError(response: Response): Promise<string> {
  try {
    return shortProviderError(await response.clone().json(), response.status)
  } catch {
    try {
      const text = (await response.clone().text()).replace(/\s+/gu, ' ').trim()
      return text === '' ? `HTTP ${String(response.status)}` : text.slice(0, MAX_PROVIDER_ERROR)
    } catch {
      return `HTTP ${String(response.status)}`
    }
  }
}

async function validSuccessfulTokenResponse(response: Response): Promise<boolean> {
  try {
    const value = await response.clone().json() as Record<string, unknown>
    return nonEmpty(value['access_token'])
      && typeof value['expires_in'] === 'number'
      && Number.isFinite(value['expires_in'])
      && value['expires_in'] > 0
      && nonEmpty(value['token_type'])
      && value['token_type'].toLowerCase() === 'bearer'
      && nonEmpty(value['scope'])
  } catch {
    return false
  }
}

const verifiedFetch: typeof fetch = async (input, init) => {
  const body = formBody(init?.body)
  const isAuthorizationCodeExchange = requestUrl(input) === GOOGLE_TOKEN_ENDPOINT
    && (init?.method ?? 'GET').toUpperCase() === 'POST'
    && body?.get('grant_type') === 'authorization_code'
  if (!isAuthorizationCodeExchange) return googleOauthCompatInternals.fetch(input, init)

  const code = body?.get('code') ?? undefined
  const pending = code === undefined ? undefined : pendingByCode.get(code)
  let response: Response
  try {
    response = await googleOauthCompatInternals.fetch(input, init)
  } catch (error: unknown) {
    if (pending !== undefined) {
      finishBrowser(pending, 502, 'Google token exchange could not reach Google. Return to PHOENIX and try again.')
    }
    throw new AuthorizationError(
      `Google token exchange failed before a response was received: ${error instanceof Error ? error.message : String(error)}`,
      'GOOGLE_TOKEN_EXCHANGE',
      { cause: error },
    )
  }

  if (!response.ok) {
    const detail = await providerError(response)
    if (pending !== undefined) {
      finishBrowser(pending, 400, `Google token exchange failed (${detail}). Return to PHOENIX and try again.`)
    }
    throw new AuthorizationError(
      `Google token exchange failed (${detail})`,
      'GOOGLE_TOKEN_EXCHANGE',
    )
  }

  if (pending !== undefined) {
    if (await validSuccessfulTokenResponse(response)) {
      finishBrowser(pending, 200, 'Google authorization completed. PHOENIX is connected; you can close this tab.')
    } else {
      finishBrowser(pending, 502, 'Google returned an incomplete token response. Return to PHOENIX and try again.')
    }
  }
  return response
}

// Patch only the process-local seams consumed by the preserved broker. Tests
// remain free to replace either seam after importing the module.
internals.openLoopback = openVerifiedLoopback
internals.fetch = verifiedFetch
