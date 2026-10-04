/** Durable email enrollment; ambiguous signup is never automatically repeated. */
import { SessionId } from '@phoenix-ai/dsh-session'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import type { MailAccount } from './assistant-mail-types.ts'
import { MailFile, mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'
import { AgentMailHttpError, agentMailDeleteInbox, agentMailRequest } from './assistant-mail-agentmail.ts'

interface Enrollment extends MailAccount {
  readonly signupUsername?: string
  readonly newInboxRequest?: { readonly username: string; readonly clientId: string }
  readonly challengeHash?: string
  readonly challengeExpires?: number
  readonly challengeAttempts?: number
}
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
    ...(data.signupUsername === undefined ? {} : { signupUsername: mailString(data.signupUsername) }),
    ...(data.newInboxRequest === undefined ? {} : { newInboxRequest: {
      username: mailString(mailRecord(data.newInboxRequest).username),
      clientId: mailString(mailRecord(data.newInboxRequest).clientId),
    } }),
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
  private active: Promise<MailAccount> | undefined
  private exclusively(operation: () => Promise<MailAccount>): Promise<MailAccount> {
    if (this.active !== undefined) return Promise.reject(new Error('mail enrollment operation is already in progress'))
    this.active = operation().finally(() => { this.active = undefined })
    return this.active
  }
  constructor(private readonly options: OnboardingOptions) {
    this.file = new MailFile<Enrollment>(options.path, () => ({ state: 'not-configured', contacts: [] }), enrollment)
  }
  /** Read secret-free enrollment status.
   * @returns Enrollment state and actual inbox.
   */
  async status(): Promise<MailAccount> {
    const {
      challengeHash: _privateChallenge, challengeExpires: _expiry, challengeAttempts: _attempts,
      signupUsername: _username, newInboxRequest: _newInbox, ...account
    } = await this.file.read()
    return account
  }
  /** Discard a stale enrollment so Phoenix can start a genuinely new mailbox flow.
   * When the stored credential still works, the old provider inbox is deleted first to release quota.
   * If provider access is already lost, local state is still cleared so the broken enrollment cannot
   * permanently trap Phoenix.
   * @returns Empty enrollment ready for a new signup.
   */
  discard(): Promise<MailAccount> {
    return this.exclusively(async () => {
      const previous = await this.file.read()
      const key = await this.options.resolveKey?.()
      if (previous.inboxId !== undefined && key !== undefined) {
        try {
          await agentMailDeleteInbox(previous.inboxId, key, this.options.timeoutMs, this.options.fetch ?? fetch)
        } catch {
          // Lost/invalid access must not make a stale local enrollment undeletable.
          // The remote inbox may remain at AgentMail, but Phoenix stops using it.
        }
      }
      await this.file.change(() => ({ state: 'not-configured', contacts: [] }))
      return this.status()
    })
  }

  /** Create a free-domain account once; persist ambiguity before contacting the provider.
   * @param ownerEmail Human owner receiving verification.
   * @param username Requested free-domain local part.
   * @returns Actual provider inbox, pending verification.
   */
  signup(ownerEmail: string, username: string): Promise<MailAccount> {
    return this.exclusively(async () => {
      const owner = mailAddress(ownerEmail)
      if (!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(username)) throw new Error('invalid inbox name')
      const previous = await this.file.read()
      if (previous.state !== 'not-configured') throw new Error('existing enrollment; recover the same owner instead of repeating signup')
      return this.enroll(previous, owner, username)
    })
  }
  /** Recover the same owner's provider organization through official idempotent signup.
   * @returns Existing provider inbox pending owner OTP verification, with its rotated key stored securely.
   */
  recover(): Promise<MailAccount> {
    return this.exclusively(async () => {
      const previous = await this.file.read()
      if (!['signup-ambiguous', 'pending-verification', 'ready'].includes(previous.state) || previous.ownerEmail === undefined) {
        throw new Error('mail recovery requires an existing owner enrollment')
      }
      return this.enroll(previous, previous.ownerEmail, previous.signupUsername ?? `kira-${randomUUID().slice(0, 8)}`)
    })
  }
  private async enroll(previous: Enrollment, owner: string, username: string): Promise<MailAccount> {
    await this.file.change(current => ({ ...current, state: 'signup-ambiguous', ownerEmail: owner, signupUsername: username }))
    let data: Record<string, unknown>
    try { data = mailRecord(await agentMailRequest('/agent/sign-up', undefined, this.options.timeoutMs, this.options.fetch ?? fetch,
      { human_email: owner, username, source: 'phoenix-local' })) } catch (error) {
      if (error instanceof AgentMailHttpError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        await this.file.change(current => ({ ...current, state: previous.state }))
        throw error
      }
      throw new Error('signup result ambiguous; use owner-bound recovery to continue')
    }
    const key = mailString(data.api_key, 8192)
    const inboxId = mailAddress(mailString(data.inbox_id))
    await this.options.saveKey(key)
    await this.file.change((current) => {
      const { challengeHash: _challenge, challengeExpires: _expiry, challengeAttempts: _attempts, ...account } = current
      return { ...account, state: 'pending-verification', inboxId }
    })
    return this.status()
  }
  /** Create a separate included-domain inbox after owner verification; uncertain creation is reconciled, never blindly repeated.
   * @returns Account using the confirmed new inbox while preserving owner, contacts and workspace.
   */
  createInbox(): Promise<MailAccount> {
    return this.exclusively(async () => {
      const account = await this.file.read()
      if (account.state !== 'ready' || account.ownerEmail === undefined || account.inboxId === undefined) throw new Error('verify the owner before creating another inbox')
      const key = await this.options.resolveKey?.()
      if (key === undefined) throw new Error('mail credential unavailable; recover the existing account first')
      const request = account.newInboxRequest ?? { username: `kira-${randomUUID().slice(0, 8)}`, clientId: randomUUID() }
      if (account.newInboxRequest !== undefined) {
        try {
          const found = mailRecord(await agentMailRequest(`/inboxes/${encodeURIComponent(`${request.username}@agentmail.to`)}`, key,
            this.options.timeoutMs, this.options.fetch ?? fetch))
          return await this.finishInbox(found, request)
        } catch (error) {
          // A confirmed absent address permits retrying that exact creation, never a new address.
          if (!(error instanceof AgentMailHttpError) || error.status !== 404) throw error
        }
      } else {
        await this.file.change(current => ({ ...current, newInboxRequest: request }))
      }
      let result: Record<string, unknown>
      try { result = mailRecord(await agentMailRequest('/inboxes', key, this.options.timeoutMs, this.options.fetch ?? fetch,
        { username: request.username, domain: 'agentmail.to', display_name: 'Kira', client_id: request.clientId })) } catch (error) {
        if (error instanceof AgentMailHttpError && error.status >= 400 && error.status < 500
          && error.status !== 408 && error.status !== 409) {
          await this.file.change((current) => { const { newInboxRequest: _request, ...retained } = current; return retained })
          throw error
        }
        throw new Error('new inbox confirmation is ambiguous; retry to check it, without creating another inbox')
      }
      return this.finishInbox(result, request)
    })
  }
  private async finishInbox(
    result: Record<string, unknown>,
    request: { readonly username: string; readonly clientId: string },
  ): Promise<MailAccount> {
    const inboxId = mailAddress(mailString(result.inbox_id))
    if (inboxId !== `${request.username}@agentmail.to` || result.client_id !== request.clientId) throw new Error('new inbox identity mismatch; the existing inbox remains active')
    await this.file.change((current) => { const { newInboxRequest: _request, ...retained } = current; return { ...retained, inboxId } })
    return this.status()
  }
  /** Connect an existing account and challenge the nominated owner before accepting jobs.
   * @param ownerEmail Human owner.
   * @param inboxId Existing provider inbox.
   * @param apiKey Secret stored only in the credential service.
   * @returns Pending owner verification.
   */
  connect(ownerEmail: string, inboxId: string, apiKey: string): Promise<MailAccount> {
    return this.exclusively(async () => {
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
    })
  }
  /** Verify the provider signup OTP or local existing-account ownership challenge.
   * @param code Human-supplied verification code.
   * @returns Ready enrollment only after verification succeeds.
   */
  verify(code: string): Promise<MailAccount> {
    return this.exclusively(async () => {
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
    })
  }
  /** Bind the first execution workspace without replacing owner-selected state.
   * @param sessionId Automatically nominated persisted session.
   * @returns Account retaining current contacts and any explicit workspace selection.
   */
  async bindSessionIfUnset(sessionId: SessionId): Promise<MailAccount> {
    const session = SessionId(mailString(sessionId))
    await this.file.change(current => current.sessionId === undefined ? { ...current, sessionId: session } : current)
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
