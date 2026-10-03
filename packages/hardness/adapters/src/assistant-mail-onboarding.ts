/** Durable email enrollment; ambiguous signup is never automatically repeated. */
import { SessionId } from '@phoenix-ai/dsh-session'
import { createHash, randomInt } from 'node:crypto'
import type { MailAccount } from './assistant-mail-types.ts'
import { MailFile, mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'
import { agentMailRequest } from './assistant-mail-agentmail.ts'

interface Enrollment extends MailAccount { readonly challengeHash?: string
  readonly challengeExpires?: number
  readonly challengeAttempts?: number }
interface OnboardingOptions {
  readonly path: string
  readonly timeoutMs: number
  readonly saveKey: (key: string) => Promise<void>
  readonly resolveKey?: () => Promise<string | undefined>
  readonly fetch?: typeof fetch
}
function enrollment(value: unknown): Enrollment {
  const data = mailRecord(value)
  if (!['not-configured', 'signup-ambiguous', 'pending-verification', 'ready'].includes(String(data.state)) || !Array.isArray(data.contacts)) throw new Error('invalid mail enrollment')
  return {
    state: data.state as MailAccount['state'], contacts: data.contacts.map(value => mailAddress(mailString(value))),
    ...(data.ownerEmail === undefined ? {} : { ownerEmail: mailAddress(mailString(data.ownerEmail)) }),
    ...(data.inboxId === undefined ? {} : { inboxId: mailAddress(mailString(data.inboxId)) }),
    ...(data.sessionId === undefined ? {} : { sessionId: SessionId(mailString(data.sessionId)) }),
    ...(typeof data.challengeExpires === 'number' && Number.isFinite(data.challengeExpires) ? { challengeExpires: data.challengeExpires } : {}),
    ...(typeof data.challengeAttempts === 'number' && Number.isInteger(data.challengeAttempts) && data.challengeAttempts >= 0 ? { challengeAttempts: data.challengeAttempts } : {}),
    ...(data.challengeHash === undefined ? {} : { challengeHash: mailString(data.challengeHash) }),
  }
}
function digest(code: string): string { return createHash('sha256').update(code).digest('hex') }

/** One enrollment owner backed by secret-free state and the credential service. */
export class MailOnboarding {
  private readonly file: MailFile<Enrollment>
  constructor(private readonly options: OnboardingOptions) {
    this.file = new MailFile<Enrollment>(options.path, () => ({ state: 'not-configured', contacts: [] }), enrollment)
  }
  /** Read secret-free enrollment status.
   * @returns Enrollment state and actual inbox.
   */
  async status(): Promise<MailAccount> {
    const { challengeHash: _privateChallenge, challengeExpires: _expiry, challengeAttempts: _attempts, ...account } = await this.file.read()
    return account
  }
  /** Create a free-domain account once; persist ambiguity before contacting the provider.
   * @param ownerEmail Human owner receiving verification.
   * @param username Requested free-domain local part.
   * @returns Actual provider inbox, pending verification.
   */
  async signup(ownerEmail: string, username: string): Promise<MailAccount> {
    const owner = mailAddress(ownerEmail)
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(username)) throw new Error('invalid inbox name')
    await this.file.change((current) => {
      if (current.state !== 'not-configured') throw new Error('existing enrollment; connect its key instead of repeating signup')
      return { state: 'signup-ambiguous', ownerEmail: owner, contacts: [] }
    })
    let data: Record<string, unknown>
    try { data = mailRecord(await agentMailRequest('/agent/sign-up', undefined, this.options.timeoutMs, this.options.fetch ?? fetch, { human_email: owner, username, source: 'phoenix-local' })) } catch {
      throw new Error('signup result ambiguous; recover the existing account key instead of repeating signup')
    }
    const key = mailString(data.api_key, 8192)
    await this.options.saveKey(key)
    await this.file.change(current => ({ ...current, state: 'pending-verification', inboxId: mailAddress(mailString(data.inbox_id)) }))
    return this.status()
  }
  /** Connect an existing account and challenge the nominated owner before accepting jobs.
   * @param ownerEmail Human owner.
   * @param inboxId Existing provider inbox.
   * @param apiKey Secret stored only in the credential service.
   * @returns Pending owner verification.
   */
  async connect(ownerEmail: string, inboxId: string, apiKey: string): Promise<MailAccount> {
    const owner = mailAddress(ownerEmail)
    const inbox = mailAddress(inboxId)
    if (!inbox.endsWith('@agentmail.to')) throw new Error('use the included free AgentMail domain')
    const key = mailString(apiKey, 8192)
    const identity = mailRecord(await agentMailRequest(`/inboxes/${encodeURIComponent(inbox)}`, key, this.options.timeoutMs, this.options.fetch ?? fetch))
    if (identity.inbox_id !== inbox) throw new Error('mail inbox identity mismatch')
    await this.options.saveKey(key)
    const code = String(randomInt(100_000, 1_000_000))
    await this.file.change(() => ({ state: 'pending-verification', ownerEmail: owner, inboxId: inbox, contacts: [], challengeHash: digest(code), challengeExpires: Date.now() + 24 * 3_600_000, challengeAttempts: 0 }))
    await agentMailRequest(`/inboxes/${encodeURIComponent(inbox)}/messages/send`, key, this.options.timeoutMs, this.options.fetch ?? fetch, { to: [owner], subject: 'Phoenix: verifica tu correo', text: `Código de verificación de Phoenix: ${code}` })
    return this.status()
  }
  /** Verify the provider signup OTP or local existing-account ownership challenge.
   * @param code Human-supplied verification code.
   * @returns Ready enrollment only after verification succeeds.
   */
  async verify(code: string): Promise<MailAccount> {
    if (!/^\d{6}$/u.test(code)) throw new Error('enter the six-digit verification code')
    const account = await this.file.read()
    if (account.state !== 'pending-verification') throw new Error('mail verification is not pending')
    if (account.challengeHash !== undefined) {
      const result = await this.file.change((current) => {
        if (current.state !== 'pending-verification' || current.challengeHash === undefined || (current.challengeExpires ?? 0) <= Date.now() || (current.challengeAttempts ?? 10) >= 10) throw new Error('verification expired; reconnect to request a new code')
        if (digest(code) !== current.challengeHash) return { ...current, challengeAttempts: (current.challengeAttempts ?? 0) + 1 }
        const { challengeHash: _challenge, challengeExpires: _expiry, challengeAttempts: _attempts, ...ready } = current
        return { ...ready, state: 'ready' }
      })
      if (result.state !== 'ready') throw new Error('invalid verification code')
    } else {
      const key = await this.options.resolveKey?.()
      if (key === undefined) throw new Error('mail credential unavailable')
      const result = mailRecord(await agentMailRequest('/agent/verify', key, this.options.timeoutMs, this.options.fetch ?? fetch, { otp_code: code }))
      if (result.verified !== true) throw new Error('mail verification is incomplete')
      await this.file.change((current) => {
        if (current.state !== 'pending-verification' || current.ownerEmail !== account.ownerEmail || current.inboxId !== account.inboxId || current.challengeHash !== undefined) throw new Error('mail enrollment changed during verification')
        return { ...current, state: 'ready' }
      })
    }
    return this.status()
  }
  /** Configure authorized contacts and the persisted workspace session for background work.
   * @param contacts Owner-authorized senders.
   * @param sessionId Persisted original session identity.
   * @returns Updated account.
   */
  async configure(contacts: readonly string[], sessionId?: SessionId): Promise<MailAccount> {
    const addresses = contacts.map(mailAddress)
    if (addresses.length > 100) throw new Error('too many authorized mail contacts')
    await this.file.change(current => ({ ...current, contacts: addresses,
      ...(sessionId === undefined ? {} : { sessionId: SessionId(mailString(sessionId)) }) }))
    return this.status()
  }
}
