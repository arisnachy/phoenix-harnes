/** Telegram Bot API gateway: owner-paired long polling to the real Phoenix Agent inbox.
 * There is intentionally no Codex microphone or realtime voice activity here.
 */
import { randomInt, randomUUID } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { TelegramBotSnapshot } from './types.ts'

export const TELEGRAM_BOT_TOKEN_REF = 'PHOENIX_TELEGRAM_BOT_TOKEN'
const OWNER_REF = 'PHOENIX_TELEGRAM_OWNER_CHAT_ID'
const OFFSET_REF = 'PHOENIX_TELEGRAM_UPDATE_OFFSET'
const SESSION_REF = 'PHOENIX_TELEGRAM_SESSION_ID'
const BOT_TOKEN_PATTERN = /^[0-9]{6,16}:[A-Za-z0-9_-]{25,}$/
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/
const POLL_WAIT_SECONDS = 15
const PAIR_TTL_MS = 15 * 60_000
const MAX_TEXT = 12_000

interface Credentials {
  describe(ref: ReturnType<typeof credentialRef>): Promise<{ configured: boolean }>
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>
  set(ref: ReturnType<typeof credentialRef>, value: string): Promise<void>
  unset(ref: ReturnType<typeof credentialRef>): Promise<void>
}

function vault(ctx: Context): Credentials | undefined {
  return (ctx.get as (name: string) => unknown)('credentials') as Credentials | undefined
}
function ref(value: string): ReturnType<typeof credentialRef> { return credentialRef(value) }
async function stored(creds: Credentials, key: string): Promise<string | undefined> {
  return (await creds.resolve(ref(key)))?.value
}
async function persist(creds: Credentials, key: string, value: string): Promise<void> {
  await creds.set(ref(key), value)
}

type TelegramApiResponse = { ok: boolean; result?: unknown; description?: string; error_code?: number }
interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    text?: string
    from?: { id?: number; is_bot?: boolean }
    chat?: { id?: number; type?: string }
  }
}

/** One pinned Bot API call. Telegram requires its token in the path; never log URLs. */
async function botApi(
  token: string, method: 'getMe' | 'getUpdates' | 'sendMessage',
  params: Record<string, unknown>, signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<TelegramApiResponse> {
  if (!BOT_TOKEN_PATTERN.test(token)) throw new Error('telegram-invalid-token')
  let response: Response
  try {
    response = await request(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: signal ?? AbortSignal.timeout(10_000),
    })
  } catch {
    if (signal?.aborted) throw new Error('telegram-aborted')
    throw new Error('telegram-unreachable')
  }
  if (response.status === 401 || response.status === 404) throw new Error('telegram-invalid-token')
  let payload: unknown
  try { payload = await response.json() } catch { throw new Error('telegram-unreachable') }
  if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
    throw new Error('telegram-invalid-response')
  }
  const parsed = payload as TelegramApiResponse
  if (parsed.ok !== true) {
    if (parsed.error_code === 409) throw new Error('telegram-webhook-conflict')
    throw new Error(method === 'getUpdates' ? 'telegram-poll-failed' : 'telegram-unreachable')
  }
  if (!response.ok) throw new Error('telegram-unreachable')
  return parsed
}

/** Guard against invalid bot responses instead of mistaking HTTP success for identity proof. */
export async function verifyTelegramBotToken(
  token: string, request: typeof fetch = fetch,
): Promise<{ username?: string }> {
  const data = await botApi(token, 'getMe', {}, undefined, request)
  const result = data.result
  if (typeof result !== 'object' || result === null
    || !('is_bot' in result) || result.is_bot !== true) throw new Error('telegram-invalid-token')
  const username = 'username' in result ? result.username : undefined
  return typeof username === 'string' && USERNAME_PATTERN.test(username)
    ? { username } : {}
}
function phase(error: unknown): TelegramBotSnapshot['phase'] {
  if (error instanceof Error && error.message === 'telegram-invalid-token') return 'invalid-token'
  return 'unreachable'
}
function eligible(update: TelegramUpdate): { id: number; text: string } | undefined {
  const m = update.message
  const id = m?.chat?.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0
    || m?.chat?.type !== 'private' || m?.from?.is_bot === true || m?.from?.id !== id) return undefined
  const text = m.text?.trim()
  return text ? { id, text: text.slice(0, MAX_TEXT) } : undefined
}

/** Finite sender; no session audio is started by message receipt. */
export class TelegramInbox {
  private controller: AbortController | undefined
  private worker: Promise<void> | undefined
  private token: string | undefined
  private phase: 'idle' | 'polling' | 'failed' = 'idle'
  private failure: string | undefined
  private lastPoll = 0
  private pairCode: string | undefined
  private pairUntil = 0
  private pairFailures = 0
  private agent: Agent | undefined
  private agentPromise: Promise<Agent> | undefined
  constructor(private readonly ctx: Context) {}

  /** Start once for this Host; it tolerates absent credentials until configured. */
  start(): void {
    if (this.worker !== undefined) return
    const controller = new AbortController()
    this.controller = controller
    const work = this.loop(controller.signal)
    this.worker = work
    void work.catch((error: unknown) => {
      // Credential storage and Agent services may be temporarily unavailable;
      // never let a background poller rejection crash the Phoenix Host.
      this.failure = error instanceof Error ? error.message.replace(/\d{6,}:[A-Za-z0-9_-]+/g, '[redacted]') : 'telegram-runtime-error'
      this.phase = 'failed'
    }).finally(() => {
      if (this.worker === work) this.worker = undefined
      if (this.controller === controller) this.controller = undefined
      if (controller.signal.aborted) this.phase = 'idle'
    })
  }
  stop(): void {
    this.controller?.abort()
    this.token = undefined
    this.phase = 'idle'
    this.lastPoll = 0
  }
  /** Called only when a changed bot token has already been verified and stored. */
  restart(): void {
    this.stop()
    const prior = this.worker
    if (prior === undefined) this.start()
    else void prior.finally(() => { if (this.worker === undefined) this.start() })
  }
  /** Not activated just because an old user has chatted with the bot. */
  async pairing(): Promise<string> {
    const creds = vault(this.ctx)
    if (creds === undefined || await stored(creds, TELEGRAM_BOT_TOKEN_REF) === undefined) {
      throw new Error('telegram-not-configured')
    }
    this.pairCode = String(randomInt(100_000, 1_000_000))
    this.pairUntil = Date.now() + PAIR_TTL_MS
    this.pairFailures = 0
    return this.pairCode
  }
  isPolling(): boolean {
    return this.phase === 'polling' && Date.now() - this.lastPoll < 50_000
  }
  error(): string | undefined { return this.failure }
  async isPaired(): Promise<boolean> {
    const creds = vault(this.ctx)
    if (creds === undefined) return false
    return /^\d+$/.test(await stored(creds, OWNER_REF) ?? '')
  }
  private async sleep(signal: AbortSignal, duration: number): Promise<void> {
    if (signal.aborted) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve() }, duration)
      const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
      signal.addEventListener('abort', done, { once: true })
    })
  }
  private async loop(signal: AbortSignal): Promise<void> {
    let offset: number | undefined
    while (!signal.aborted) {
      const creds = vault(this.ctx)
      if (creds === undefined) { await this.sleep(signal, 4_000); continue }
      const token = await stored(creds, TELEGRAM_BOT_TOKEN_REF)
      if (signal.aborted) return
      if (token === undefined) {
        this.phase = 'idle'
        await this.sleep(signal, 4_000)
        continue
      }
      if (token !== this.token) {
        this.token = token
        const saved = await stored(creds, OFFSET_REF)
        offset = saved !== undefined && /^\d+$/.test(saved) ? Number(saved) : undefined
      }
      try {
        const deadline = AbortSignal.timeout(28_000)
        const linked = AbortSignal.any([signal, deadline])
        const result = await botApi(token, 'getUpdates', {
          ...(offset === undefined ? {} : { offset }),
          timeout: POLL_WAIT_SECONDS, limit: 20, allowed_updates: ['message'],
        }, linked)
        if (!Array.isArray(result.result)) throw new Error('telegram-invalid-response')
        this.phase = 'polling'
        this.failure = undefined
        this.lastPoll = Date.now()
        for (const candidate of result.result as TelegramUpdate[]) {
          if (signal.aborted) return
          if (!Number.isSafeInteger(candidate.update_id) || candidate.update_id < 0) continue
          if (offset !== undefined && candidate.update_id < offset) continue
          await this.process(candidate, token, creds)
          offset = candidate.update_id + 1
          await persist(creds, OFFSET_REF, String(offset))
        }
      } catch (error) {
        if (signal.aborted) return
        this.phase = 'failed'
        this.failure = error instanceof Error ? error.message : 'telegram-poll-failed'
        await this.sleep(signal, this.failure === 'telegram-webhook-conflict' ? 15_000 : 3_000)
      }
    }
  }
  private async send(token: string, chatId: number, text: string): Promise<void> {
    for (let i = 0; i < text.length; i += 3_800) {
      await botApi(token, 'sendMessage', { chat_id: chatId, text: text.slice(i, i + 3_800) })
    }
  }
  private async process(update: TelegramUpdate, token: string, creds: Credentials): Promise<void> {
    const incoming = eligible(update)
    if (incoming === undefined) return
    const owner = await stored(creds, OWNER_REF)
    if (owner === undefined) {
      if (this.pairCode === undefined || Date.now() > this.pairUntil || this.pairFailures >= 5) return
      const match = /^\/(?:start|vincular)\s+(\d{6})$/i.exec(incoming.text)
      if (match === null) return
      if (match[1] !== this.pairCode) { this.pairFailures += 1; return }
      await persist(creds, OWNER_REF, String(incoming.id))
      this.pairCode = undefined
      await this.send(token, incoming.id, 'Vinculación confirmada. Soy Kira en Phoenix. Puedes enviarme instrucciones por escrito.')
      return
    }
    if (owner !== String(incoming.id)) return
    if (incoming.text === '/start') {
      await this.send(token, incoming.id, 'Soy Kira. Envíame lo que necesitas y lo ejecutaré en Phoenix cuando el harness esté disponible.')
      return
    }
    // Process one user turn fully before confirming its update offset.
    // Telegram retains later messages in its queue during longer Agent turns;
    // we never mark an instruction consumed before the harness has settled.
    await this.dispatch(incoming.id, incoming.text, token, creds)
  }
  private async liveAgent(creds: Credentials): Promise<Agent> {
    if (this.agent !== undefined) return this.agent
    if (this.agentPromise !== undefined) return this.agentPromise
    const task = (async () => {
      const agents = (this.ctx.get as (name: string) => unknown)('agents') as
        | { get(id: ReturnType<typeof SessionId>): Agent | undefined; create(options: { sessionId: ReturnType<typeof SessionId> }): Promise<{ agent: Agent; dispose(): Promise<void> }>; resume(options: { resumeSessionId: ReturnType<typeof SessionId> }): Promise<{ agent: Agent }> }
        | undefined
      if (agents === undefined) throw new Error('Phoenix Agent registry unavailable')
      const existingId = await stored(creds, SESSION_REF)
      if (existingId !== undefined) {
        const current = agents.get(SessionId(existingId))
        if (current !== undefined) { this.agent = current; return current }
        const resumed = await agents.resume({ resumeSessionId: SessionId(existingId) })
        this.agent = resumed.agent
        return resumed.agent
      }
      const sessionId = SessionId(randomUUID())
      const created = await agents.create({ sessionId })
      this.agent = created.agent
      await persist(creds, SESSION_REF, String(sessionId))
      return created.agent
    })()
    this.agentPromise = task
    try { return await task } finally { this.agentPromise = undefined }
  }
  private async dispatch(chat: number, text: string, token: string, creds: Credentials): Promise<void> {
    try {
      const agent = await this.liveAgent(creds)
      const before = agent.session.deriveMessages().length
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
      await this.send(token, chat, 'Recibido. Kira está trabajando en tu solicitud.')
      await agent.whenIdle()
      const lastAnswer = agent.session.deriveMessages().slice(before)
        .filter(m => m.role === 'assistant' && m.source.kind === 'model').at(-1)
      const result = lastAnswer?.content.filter(part => part.type === 'text')
        .map(part => part.text).join('\n').trim() ?? ''
      await this.send(token, chat, result || 'La ejecución terminó sin una respuesta de texto. Revisa el historial de Phoenix.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      // No secrets, model traces or stack details should be sent to Telegram.
      this.ctx.logger('telegram').warn('Telegram dispatch failed: ' + message.replace(/\d{6,}:[A-Za-z0-9_-]+/g, '[redacted]'))
      try { await this.send(token, chat, 'No pude completar esta orden en Phoenix. Comprueba que el harness y tu proveedor de modelos estén operativos.') } catch { /* no recursive retry */ }
      this.agent = undefined
      this.agentPromise = undefined
    }
  }
}

/** Isolated Host lifecycle. Remote Settings and the worker share this instance. */
const inboxes = new WeakMap<Context, TelegramInbox>()
export function telegramInbox(ctx: Context): TelegramInbox {
  let inbox = inboxes.get(ctx)
  if (inbox === undefined) {
    inbox = new TelegramInbox(ctx)
    inboxes.set(ctx, inbox)
  }
  return inbox
}
export async function readTelegramBotState(ctx: Context): Promise<TelegramBotSnapshot> {
  const creds = vault(ctx)
  if (creds === undefined) return { configured: false, verified: false, phase: 'credentials-unavailable', inboxActive: false, paired: false }
  const token = await stored(creds, TELEGRAM_BOT_TOKEN_REF)
  if (token === undefined) return { configured: false, verified: false, phase: 'unconfigured', inboxActive: false, paired: false }
  const worker = telegramInbox(ctx)
  const paired = await worker.isPaired()
  const reason = worker.error()
  try {
    const bot = await verifyTelegramBotToken(token)
    return { configured: true, verified: true, phase: 'verified', inboxActive: worker.isPolling(), paired, ...bot,
      ...(reason === undefined ? {} : { reason }) }
  } catch (error) {
    return { configured: true, verified: false, phase: phase(error), inboxActive: false, paired,
      ...(reason === undefined ? {} : { reason }) }
  }
}
export async function saveTelegramBot(ctx: Context, value: string): Promise<TelegramBotSnapshot> {
  const creds = vault(ctx)
  if (creds === undefined) throw new Error('Telegram credential storage unavailable')
  const token = value.trim()
  const verified = await verifyTelegramBotToken(token)
  const previous = await stored(creds, TELEGRAM_BOT_TOKEN_REF)
  if (previous !== token) {
    for (const key of [OWNER_REF, OFFSET_REF, SESSION_REF]) await creds.unset(ref(key))
  }
  await persist(creds, TELEGRAM_BOT_TOKEN_REF, token)
  telegramInbox(ctx).restart()
  return { configured: true, verified: true, phase: 'verified', inboxActive: false, paired: previous === token && await telegramInbox(ctx).isPaired(), ...verified }
}
export async function removeTelegramBot(ctx: Context): Promise<TelegramBotSnapshot> {
  const creds = vault(ctx)
  if (creds === undefined) throw new Error('Telegram credential storage unavailable')
  telegramInbox(ctx).stop()
  for (const key of [TELEGRAM_BOT_TOKEN_REF, OWNER_REF, OFFSET_REF, SESSION_REF]) await creds.unset(ref(key))
  return { configured: false, verified: false, phase: 'unconfigured', inboxActive: false, paired: false }
}
