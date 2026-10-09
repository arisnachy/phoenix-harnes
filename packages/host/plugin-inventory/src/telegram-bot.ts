/** Native Telegram Bot API setup. No MCP impersonation and no automatic inbox activation. */
import type { Context } from '@phoenix-ai/cordis'
import type { TelegramBotSnapshot } from './types.ts'

export const TELEGRAM_BOT_TOKEN_REF = 'PHOENIX_TELEGRAM_BOT_TOKEN'
const BOT_TOKEN_PATTERN = /^[0-9]{6,16}:[A-Za-z0-9_-]{25,}$/
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

type Credentials = {
  describe(ref: string): Promise<{ configured: boolean }>
  resolve(ref: string): Promise<{ value: string } | undefined>
  set(ref: string, secret: string): Promise<void>
  unset(ref: string): Promise<void>
}

/** A missing credential provider is not a success state. */
function credentials(ctx: Context): Credentials | undefined {
  return (ctx.get as (name: string) => unknown)('credentials') as Credentials | undefined
}

/** Pinned HTTPS destination; token never goes into query params or browser logs. */
export async function verifyTelegramBotToken(
  token: string,
  request: typeof fetch = fetch,
): Promise<{ username?: string }> {
  if (!BOT_TOKEN_PATTERN.test(token)) throw new Error('telegram-invalid-token')
  let response: Response
  try {
    response = await request(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('telegram-unreachable')
  }
  if (response.status === 401 || response.status === 404) throw new Error('telegram-invalid-token')
  if (!response.ok) throw new Error('telegram-unreachable')
  let payload: unknown
  try { payload = await response.json() } catch { throw new Error('telegram-unreachable') }
  if (typeof payload !== 'object' || payload === null
    || !('ok' in payload) || payload.ok !== true
    || !('result' in payload) || typeof payload.result !== 'object' || payload.result === null
    || !('is_bot' in payload.result) || payload.result.is_bot !== true) {
    throw new Error('telegram-invalid-token')
  }
  const result = payload.result as { username?: unknown }
  return typeof result.username === 'string' && USERNAME_PATTERN.test(result.username)
    ? { username: result.username }
    : {}
}

function phase(error: unknown): TelegramBotSnapshot['phase'] {
  return error instanceof Error && error.message === 'telegram-invalid-token'
    ? 'invalid-token' : 'unreachable'
}

/** Credential presence and real getMe proof; never reports message delivery as active. */
export async function readTelegramBotState(ctx: Context): Promise<TelegramBotSnapshot> {
  const vault = credentials(ctx)
  if (vault === undefined) return { configured: false, verified: false, phase: 'credentials-unavailable', inboxActive: false }
  const info = await vault.describe(TELEGRAM_BOT_TOKEN_REF)
  if (!info.configured) return { configured: false, verified: false, phase: 'unconfigured', inboxActive: false }
  const token = await vault.resolve(TELEGRAM_BOT_TOKEN_REF)
  if (token === undefined) return { configured: false, verified: false, phase: 'unconfigured', inboxActive: false }
  try {
    const result = await verifyTelegramBotToken(token.value)
    return { configured: true, verified: true, phase: 'verified', inboxActive: false, ...result }
  } catch (error) {
    return { configured: true, verified: false, phase: phase(error), inboxActive: false }
  }
}

/** Refuses invalid credentials without overwriting a previously working bot. */
export async function saveTelegramBot(ctx: Context, value: string): Promise<TelegramBotSnapshot> {
  const vault = credentials(ctx)
  if (vault === undefined) throw new Error('Telegram credential storage is not available')
  const token = value.trim()
  const result = await verifyTelegramBotToken(token)
  await vault.set(TELEGRAM_BOT_TOKEN_REF, token)
  return { configured: true, verified: true, phase: 'verified', inboxActive: false, ...result }
}

/** Local disconnect is explicit, idempotent and never claims to revoke Telegram's token. */
export async function removeTelegramBot(ctx: Context): Promise<TelegramBotSnapshot> {
  const vault = credentials(ctx)
  if (vault === undefined) throw new Error('Telegram credential storage is not available')
  await vault.unset(TELEGRAM_BOT_TOKEN_REF)
  return { configured: false, verified: false, phase: 'unconfigured', inboxActive: false }
}
