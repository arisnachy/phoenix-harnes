import { SessionId } from '@phoenix-ai/dsh-session'
import { existsSync } from 'node:fs'
import type {} from '@phoenix-ai/dsh-subprocess'
import { ProactivityDeferredError } from './proactivity-engine.ts'
import { mailStartupSpec } from './assistant-mail-startup.ts'
/** Local mailbox lifecycle, human-only configuration RPC and home-feed projection. */
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { Service, type Context } from '@phoenix-ai/cordis'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import { AgentMailHttpError, AgentMailTransport, agentMailRequest } from './assistant-mail-agentmail.ts'
import { MailOnboarding } from './assistant-mail-onboarding.ts'
import { MailJournal } from './assistant-mail-journal.ts'
import { MailOutbox } from './assistant-mail-outbox.ts'
import { MailReceiver } from './assistant-mail-receiver.ts'
import { createMailExecutor } from './assistant-mail-executor.ts'
import { mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'
import type { MailAccount, MailDelivery, MailOutgoingOwnership, MailOutgoingMessage } from './assistant-mail-types.ts'
import type { ProactivityAttentionItem, ProactivityRuntimeConfig } from './proactivity-runtime.ts'

/** Local mail runtime deployment settings. */
export interface AssistantMailConfig { readonly directory: string
  readonly credentialRef: string
  readonly pollMs: number
  readonly timeoutMs: number
  readonly workTimeoutMs: number
  /** Revalidate the persisted task and occurrence before every provider attempt, including background recovery.
   * @param ownership Durable task identity, occurrence, recipient and provider key.
   * @returns Whether the task still authorizes this delivery; false suppresses IO without discarding evidence.
   */
  readonly authorizeOutgoing: (ownership: MailOutgoingOwnership) => Promise<boolean>
  /** Resolve the already-connected owner email used for automatic first-run enrollment. */
  readonly resolveOwnerEmail?: () => Promise<string | undefined> }
/** Secret-free Kira mailbox identity exposed to model-facing tools. */
export interface AssistantMailIdentity {
  readonly state: MailAccount['state']
  readonly inboxId?: string
  readonly connection: string
  readonly ownerEmail?: string
}

/** Host service used by Kira to inspect or create her own mailbox without touching Gmail setup. */
export interface AssistantMailControl {
  /** Read the current Kira mailbox identity. */
  status(): Promise<AssistantMailIdentity>
  /** Create the free Kira mailbox once when absent, or reuse the existing enrollment.
   * @param ownerEmail Optional explicit owner email when no connected account identity is available.
   */
  ensure(ownerEmail?: string): Promise<AssistantMailIdentity>
  /** Recover the persisted owner account without a manually supplied key.
   * @returns Existing inbox in the strongest provider state Phoenix can prove.
   */
  recover(): Promise<AssistantMailIdentity>
  /** Correct the human email attached to an unverified AgentMail organization.
   * @param ownerEmail Correct owner email that should receive the OTP.
   * @returns Existing or fresh inbox pending verification for that owner.
   */
  changeOwner(ownerEmail: string): Promise<AssistantMailIdentity>
  /** Create a separate included-domain inbox for the verified owner, subject to provider quota.
   * @returns Confirmed new inbox identity.
   */
  createInbox(): Promise<AssistantMailIdentity>
  /** Discard a stale or unrecoverable mailbox enrollment so a new one can be created.
   * This action is destructive and must only follow an explicit owner request.
   */
  discard(): Promise<AssistantMailIdentity>
  /** Replace a stale mailbox with a fresh enrollment while retaining the known owner identity.
   * @param ownerEmail Optional replacement owner when the old enrollment has none.
   */
  replace(ownerEmail?: string): Promise<AssistantMailIdentity>
  /** Activate the existing mailbox using the owner's one-time verification code.
   * @param code Six-digit code received by the owner.
   * @returns Verified mailbox identity.
   */
  verify(code: string): Promise<AssistantMailIdentity>
  /** Request immediate incoming reconciliation without waiting for mail missions.
   * @returns Current mailbox identity and connection status.
   */
  refresh(): Promise<AssistantMailIdentity>
  /** Send an explicitly requested message only to the verified mailbox owner.
   * @param subject Message subject.
   * @param text Exact message body.
   * @param idempotencyKey Stable originating chat call identity.
   * @returns Confirmed provider receipt with actual sender and recipient.
   */
  sendToOwner(subject: string, text: string, idempotencyKey: string): Promise<MailDelivery & { from: string; to: string }>
}

class AssistantMailControlService extends Service implements AssistantMailControl {
  constructor(ctx: Context,
    private readonly read: () => Promise<AssistantMailIdentity>,
    private readonly create: (ownerEmail?: string) => Promise<AssistantMailIdentity>,
    private readonly activate: AssistantMailControl['verify'],
    private readonly reconcile: AssistantMailControl['refresh'],
    private readonly send: AssistantMailControl['sendToOwner'],
    private readonly restore: AssistantMailControl['recover'],
    private readonly repairOwner: AssistantMailControl['changeOwner'],
    private readonly replaceInbox: AssistantMailControl['createInbox'],
    private readonly discardEnrollment: AssistantMailControl['discard'],
    private readonly replaceEnrollment: AssistantMailControl['replace']) {
    super(ctx, 'assistantMail')
  }
  status(): Promise<AssistantMailIdentity> { return this.read() }
  ensure(ownerEmail?: string): Promise<AssistantMailIdentity> { return this.create(ownerEmail) }
  recover(): Promise<AssistantMailIdentity> { return this.restore() }
  changeOwner(ownerEmail: string): Promise<AssistantMailIdentity> { return this.repairOwner(ownerEmail) }
  createInbox(): Promise<AssistantMailIdentity> { return this.replaceInbox() }
  discard(): Promise<AssistantMailIdentity> { return this.discardEnrollment() }
  replace(ownerEmail?: string): Promise<AssistantMailIdentity> { return this.replaceEnrollment(ownerEmail) }
  verify(code: string): Promise<AssistantMailIdentity> { return this.activate(code) }
  refresh(): Promise<AssistantMailIdentity> { return this.reconcile() }
  sendToOwner(subject: string, text: string, key: string): Promise<MailDelivery & { from: string; to: string }> {
    return this.send(subject, text, key)
  }
}

/** Mail host projection consumed by normal home attention. */
export interface AssistantMailRuntime {
  /** Read material blocked/completed mail outcomes.
   * @returns Browser-safe home feed rows.
   */
  attention(): Promise<ProactivityAttentionItem[]>
  /** Check verified sender availability and recover persisted delivery without regenerating its body.
   * @param idempotencyKey Occurrence identity whose existing payload must be reused.
   * @returns Confirmed body, or undefined when no message was persisted.
   */
  preflight(idempotencyKey: string): Promise<string | undefined>
  /** Send a new idempotent message from Kira's verified mailbox.
   * @param input Authorized recipient, subject, body and stable deduplication key.
   */
  send(input: Omit<MailOutgoingMessage, 'inboxId'>): Promise<void>
  /** Stop socket, timers and owned work, then await cleanup. */
  dispose(): Promise<void>
}

/** Install the mailbox in the resident host; browser closure does not own it.
 * @param ctx Owning host plugin context.
 * @param config Local deployment settings.
 * @param workConfig Existing coordinator/provider policy.
 * @returns Owned lifecycle and home-feed projection.
 */
export function installAssistantMail(ctx: Context,
  config: AssistantMailConfig,
  workConfig: ProactivityRuntimeConfig): AssistantMailRuntime {
  for (const value of [config.pollMs, config.timeoutMs, config.workTimeoutMs]) if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error('mail intervals must be positive bounded integers')
  if (typeof config.authorizeOutgoing !== 'function') throw new Error('mail requires scheduled occurrence authorization')
  const ref = credentialRef(config.credentialRef)
  const installRoot = process.env.PHOENIX_INSTALL_ROOT
  const startupPath = process.env.APPDATA === undefined ? undefined : join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'PHOENIX Assistant.lnk')
  const startupSupported = process.platform === 'win32' && installRoot !== undefined && existsSync(join(installRoot, 'scripts', 'phoenix-assistant-startup.ps1'))
  const resolveKey = async (): Promise<string | undefined> => (await ctx.get('credentials')?.resolve(ref))?.value
  const onboarding = new MailOnboarding({ path: join(config.directory, 'account.json'), timeoutMs: config.timeoutMs, resolveKey, saveKey: async (key) => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) throw new Error('mail setup requires the credential service')
    await credentials.set(ref, key)
  } })
  let enrolling: Promise<void> | undefined
  const ensureEnrollment = (explicitOwnerEmail?: string, requireOwner = false): Promise<void> => {
    if (enrolling !== undefined) return enrolling
    enrolling = (async () => {
      const account = await onboarding.status()
      if (account.state === 'pending-verification' && requireOwner) {
        await onboarding.recover()
        return
      }
      if (account.state !== 'not-configured') return
      // Never create the provider account until Phoenix can durably retain the returned key.
      if (ctx.get('credentials') === undefined) throw new Error('secure credential storage is unavailable')
      const resolvedOwner = explicitOwnerEmail?.trim() || await config.resolveOwnerEmail?.()
      if (resolvedOwner === undefined || resolvedOwner.length === 0) {
        if (requireOwner) throw new Error('owner email required for one-time mailbox verification')
        return
      }
      const owner = mailAddress(resolvedOwner)
      // AgentMail creates the mailbox without a pre-existing API key. The signup
      // response returns the new key, which Phoenix stores immediately in credentials.
      // signup persists signup-ambiguous before provider IO, so a timeout is never
      // silently retried and cannot rotate/lose the first account key.
      await onboarding.signup(owner, `kira-${randomUUID().slice(0, 8)}`)
    })().finally(() => { enrolling = undefined })
    return enrolling
  }
  const journal = new MailJournal(join(config.directory, 'jobs.json'))
  const executor = createMailExecutor(ctx, journal, () => onboarding.status(), workConfig, config.workTimeoutMs)
  let receiver: MailReceiver | undefined
  let socketDispose: (() => void) | undefined
  let transportInbox: string | undefined
  let status = 'not-configured'
  const providerStatus = (error: unknown): string => {
    if (error instanceof AgentMailHttpError) {
      if (error.reason === 'verification-required') return 'verification-required'
      if (error.reason === 'credential-rejected' || error.reason === 'permission-missing') return 'recovery-required'
      if (error.reason === 'limit-exceeded' || error.status === 429) return 'quota-reached'
      if (error.reason === 'message-rejected') return 'message-rejected'
    }
    return error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
  }
  let automaticCredentialRecoveryAttempted = false
  const handleProviderFailure = async (error: unknown, recoverVerification = true): Promise<void> => {
    status = providerStatus(error)
    if (!recoverVerification || !(error instanceof AgentMailHttpError)) return
    if (error.reason === 'verification-required') {
      // The provider, not local state, proved that OTP verification is required.
      // Re-enter verification explicitly; ordinary credential recovery must not demote ready mailboxes.
      try {
        await onboarding.reverify()
        status = 'verification-required'
      } catch {
        // Keep the actionable status. Manual Recover remains available if provider recovery is refused.
      }
      return
    }
    if (!['credential-rejected', 'permission-missing'].includes(error.reason ?? '') || automaticCredentialRecoveryAttempted) return
    automaticCredentialRecoveryAttempted = true
    // A stale/rejected stored key is recoverable without a manually pasted API key:
    // AgentMail's owner-bound sign-up rotates the credential idempotently, and
    // restoreCredential proves the replacement against the exact persisted inbox.
    try {
      await onboarding.restoreCredential()
      status = 'connecting'
    } catch {
      status = 'recovery-required'
    }
  }
  const withCredentialRecovery = async <T>(
    inboxId: string,
    operation: (transport: AgentMailTransport) => Promise<T>,
  ): Promise<T> => {
    const transport = new AgentMailTransport(resolveKey, inboxId, config.timeoutMs, fetch, controller.signal)
    try {
      return await operation(transport)
    } catch (error) {
      await handleProviderFailure(error)
      const recoverable = error instanceof AgentMailHttpError
        && (error.reason === 'credential-rejected' || error.reason === 'permission-missing')
        && status === 'connecting'
      if (!recoverable) throw error
      try {
        const result = await operation(new AgentMailTransport(resolveKey, inboxId, config.timeoutMs, fetch, controller.signal))
        automaticCredentialRecoveryAttempted = false
        return result
      } catch (retryError) {
        await handleProviderFailure(retryError, false)
        throw retryError
      }
    }
  }
  let resetting = false
  let disposed = false
  const controller = new AbortController()
  const sends = new Set<Promise<unknown>>()
  const assertActive = (): void => { if (disposed) throw new Error('assistant mail runtime is disposed') }
  const owned = <T>(operation: () => Promise<T>): Promise<T> => {
    if (disposed) return Promise.reject(new Error('assistant mail runtime is disposed'))
    const pending = operation()
    sends.add(pending)
    void pending.then(() => { sends.delete(pending) }, () => { sends.delete(pending) })
    return pending
  }
  const isDisposed = (): boolean => disposed
  let pumping: Promise<void> | undefined
  let repumpRequested = false
  const hasQueuedWake = (): boolean => repumpRequested
  const outbox = new MailOutbox(join(config.directory, 'outbox.json'), async (reply) => {
    assertActive()
    const account = await onboarding.status()
    assertActive()
    if (account.state !== 'ready' || account.inboxId !== reply.inboxId || ![account.ownerEmail, ...account.contacts].includes(reply.to)) throw new Error('mail sender authorization revoked')
    return withCredentialRecovery(reply.inboxId, transport => transport.reply(reply))
  }, Date.now, async (message) => {
    assertActive()
    const account = await onboarding.status()
    assertActive()
    if (account.state !== 'ready' || account.inboxId !== message.inboxId
      || ![account.ownerEmail, ...account.contacts].includes(message.to)) throw new ProactivityDeferredError('mail sender authorization is unavailable')
    if (!await config.authorizeOutgoing(message)) throw new ProactivityDeferredError('mail task authorization is no longer active')
    assertActive()
    return withCredentialRecovery(message.inboxId,
      transport => transport.send(message.to, message.subject, message.text, message.idempotencyKey))
  }, ownership => config.authorizeOutgoing(ownership))
  const ownerOutbox = new MailOutbox(join(config.directory, 'owner-outbox.json'),
    () => Promise.reject(new Error('owner outbox does not accept incoming replies')), Date.now, async (message) => {
      assertActive()
      const account = await onboarding.status()
      assertActive()
      if (account.state !== 'ready' || account.inboxId !== message.inboxId || account.ownerEmail !== message.to) {
        throw new ProactivityDeferredError('Kira mailbox owner verification is required')
      }
      return withCredentialRecovery(message.inboxId,
        transport => transport.send(message.to, message.subject, message.text, message.idempotencyKey))
    }, async (message) => {
      const account = await onboarding.status()
      return account.state === 'ready' && account.ownerEmail === message.to
    })
  const sendToOwner: AssistantMailControl['sendToOwner'] = (subject, text, key) => owned(async () => {
    const account = await onboarding.status()
    assertActive()
    if (account.state !== 'ready' || account.inboxId === undefined || account.ownerEmail === undefined) {
      throw new ProactivityDeferredError('Verify the existing Kira mailbox with the owner code before sending')
    }
    if (await resolveKey() === undefined) throw new ProactivityDeferredError('Kira mailbox credential is unavailable')
    const previous = (await ownerOutbox.list()).find(row => row.reply.idempotencyKey === key)
    await ownerOutbox.enqueueMessage({ inboxId: account.inboxId, to: account.ownerEmail,
      taskId: mailString(key), scheduledFor: previous !== undefined && 'scheduledFor' in previous.reply
        ? previous.reply.scheduledFor : new Date().toISOString(),
      subject: mailString(subject, 1024), text: mailString(text, 64_000), idempotencyKey: mailString(key) })
    assertActive()
    await ownerOutbox.flush()
    const row = (await ownerOutbox.list()).find(row => row.reply.idempotencyKey === key)
    if (row?.state === 'ambiguous') throw new Error('mail delivery requires owner review; do not resend with another identity')
    if (row?.state !== 'sent' || row.delivery === undefined) {
      throw new ProactivityDeferredError('Email is retained for retry; provider confirmation is pending. Do not claim it was sent or create another send.')
    }
    return { ...row.delivery, from: account.inboxId, to: account.ownerEmail }
  })
  const delivery = async (key: string): Promise<string | undefined> => {
    const row = (await outbox.list()).find(row => row.reply.idempotencyKey === key)
    if (row === undefined) return undefined
    if (!('subject' in row.reply)) throw new Error('mail occurrence identity belongs to an incoming reply')
    if (row.state === 'ambiguous') {
      throw new Error('mail delivery requires manual review: provider confirmation missing beyond its retry window')
    }
    if (row.state !== 'sent') throw new ProactivityDeferredError('mail delivery confirmation is pending')
    return row.reply.text
  }
  const preflight = (key: string): Promise<string | undefined> => owned(async () => {
    const account = await onboarding.status()
    assertActive()
    if (account.state !== 'ready' || account.inboxId === undefined || await resolveKey() === undefined) throw new ProactivityDeferredError('Kira mail is not verified or its credential is unavailable')
    assertActive()
    await outbox.flush()
    return delivery(key)
  })
  const recover = async (): Promise<void> => {
    if (resetting) return
    await ensureEnrollment()
    const account = await onboarding.status()
    if (isDisposed() || account.state !== 'ready' || account.inboxId === undefined) return
    status = 'connecting'
    const root = ctx.get('agents')?.roots()[0]
    if (account.sessionId === undefined && root !== undefined) await onboarding.bindSessionIfUnset(root.id)
    await ownerOutbox.flush()
    if (receiver === undefined || transportInbox !== account.inboxId || socketDispose === undefined) {
      socketDispose?.()
      await receiver?.stop()
      const transport = new AgentMailTransport(resolveKey, account.inboxId, config.timeoutMs, fetch, controller.signal)
      receiver = new MailReceiver(transport, journal, outbox, () => onboarding.status(), job => executor.run(job))
      transportInbox = account.inboxId
      await receiver.reconcile()
      if (isDisposed()) return
      socketDispose = await transport.subscribe(() => { void pump() }, () => {
        if (isDisposed()) return
        socketDispose?.(); socketDispose = undefined
        status = 'disconnected'
      })
    } else {
      await receiver.reconcile()
    }
    if (status === 'connecting') status = 'connected'
    automaticCredentialRecoveryAttempted = false
  }
  const pump = (): Promise<void> => {
    if (isDisposed()) return Promise.resolve()
    if (pumping !== undefined) {
      repumpRequested = true
      return pumping
    }
    pumping = (async () => {
      do {
        repumpRequested = false
        try { await recover() } catch (error) {
          await handleProviderFailure(error)
          socketDispose?.(); socketDispose = undefined
          // A successfully rotated credential should be consumed immediately instead of
          // waiting for the next poll. Other failures keep durable work for later recovery.
          if (status === 'connecting') repumpRequested = true
        }
      } while (hasQueuedWake() && !isDisposed())
    })().finally(() => {
      pumping = undefined
      // A notification may land between the final loop check and promise settlement.
      if (hasQueuedWake() && !isDisposed()) void pump()
    })
    return pumping
  }
  const identity = async (): Promise<AssistantMailIdentity> => {
    const account = await onboarding.status()
    return {
      state: account.state,
      ...(account.inboxId === undefined ? {} : { inboxId: account.inboxId }),
      connection: status,
      ...(account.ownerEmail === undefined ? {} : { ownerEmail: account.ownerEmail }),
    }
  }
  const recoverEnrollment = async (): Promise<AssistantMailIdentity> => {
    const account = await onboarding.recover()
    status = account.state === 'ready' ? 'connecting' : 'verification-required'
    if (account.state === 'ready') void pump()
    return identity()
  }
  const repairOwnerEnrollment = async (ownerEmail: string): Promise<AssistantMailIdentity> => {
    const account = await onboarding.changeOwner(ownerEmail)
    status = account.state === 'ready' ? 'connecting' : 'verification-required'
    if (account.state === 'ready') void pump()
    return identity()
  }
  const discardEnrollment = async (): Promise<AssistantMailIdentity> => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) throw new Error('secure credential storage is unavailable')
    if (resetting) throw new Error('mail reset is already in progress')
    resetting = true
    try {
      socketDispose?.()
      socketDispose = undefined
      await receiver?.stop()
      receiver = undefined
      transportInbox = undefined
      await onboarding.discard()
      await credentials.unset(ref)
      status = 'not-configured'
      automaticCredentialRecoveryAttempted = false
      repumpRequested = false
      return await identity()
    } finally {
      resetting = false
    }
  }
  const replaceEnrollment = async (explicitOwnerEmail?: string): Promise<AssistantMailIdentity> => {
    const previous = await onboarding.status()
    const resolvedOwner = explicitOwnerEmail?.trim() || previous.ownerEmail || await config.resolveOwnerEmail?.()
    if (resolvedOwner === undefined || resolvedOwner.length === 0) throw new Error('owner email required for one-time mailbox verification')
    const owner = mailAddress(resolvedOwner)
    await discardEnrollment()
    await ensureEnrollment(owner, true)
    const account = await onboarding.status()
    const root = ctx.get('agents')?.roots()[0]
    if (account.sessionId === undefined && root !== undefined) await onboarding.bindSessionIfUnset(root.id)
    if (account.state === 'ready') void pump()
    return identity()
  }
  const serviceContext = ctx as unknown as { readonly reflect?: unknown }
  if (serviceContext.reflect !== undefined) {
    new AssistantMailControlService(
      ctx,
      identity,
      async (ownerEmail) => {
        await ensureEnrollment(ownerEmail, true)
        const account = await onboarding.status()
        const root = ctx.get('agents')?.roots()[0]
        if (account.sessionId === undefined && root !== undefined) {
          await onboarding.bindSessionIfUnset(root.id)
        }
        if (account.state === 'ready') void pump()
        return identity()
      },
      async (code) => { await onboarding.verify(code); void pump(); return identity() },
      async () => { void pump(); return identity() },
      sendToOwner,
      recoverEnrollment,
      repairOwnerEnrollment,
      async () => { await onboarding.createInbox(); void pump(); return identity() },
      discardEnrollment,
      replaceEnrollment,
    )
  }
  let connection: HostConnectionHandle | undefined
  let rpcDispose: (() => Promise<void>) | undefined
  const syncRpc = (): void => {
    const next = ctx.get('connection')
    if (connection === next) return
    void rpcDispose?.()
    connection = next
    rpcDispose = next?.rpc.handle('/phoenix-mail', async (endpoint, input) => {
      try {
        const args = input === undefined ? {} : mailRecord(input)
        if (endpoint === 'claim') {
          if (Object.keys(args).length > 0) throw new Error('mail claim does not accept parameters')
          const account = await onboarding.status()
          if (account.state !== 'pending-verification' || account.inboxId === undefined) {
            throw new Error('only an unverified Kira mailbox can be claimed')
          }
          const key = await resolveKey()
          if (key === undefined) {
            throw new Error('Phoenix no longer has the original AgentMail signup key; this receive-only inbox cannot be claimed with the local credential')
          }
          const claimKey = mailString(key, 8192)
          if (!claimKey.startsWith('am_us_')) {
            throw new Error('AgentMail Console claiming is only available for US-region agent inboxes')
          }
          if (process.platform !== 'win32') {
            throw new Error('secure AgentMail claim clipboard handoff is currently available only on Windows')
          }
          const subprocess = ctx.get('subprocess')
          if (subprocess === undefined) throw new Error('secure clipboard handoff is unavailable on this host')
          const systemRoot = process.env.SystemRoot ?? process.env.WINDIR
          const powershell = systemRoot === undefined
            ? 'powershell.exe'
            : join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
          const child = subprocess.spawn({
            argv: [powershell, '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
              'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
            cwd: config.directory,
            stdio: {
              stdin: { data: claimKey },
              stdout: { maxBytes: 1024 },
              stderr: { maxBytes: 4096 },
            },
            graceMs: 1500,
            signal: AbortSignal.timeout(10_000),
          })
          const outcome = await child.done
          if (outcome.exitCode !== 0) throw new Error('could not copy the saved AgentMail key to the Windows clipboard')
          // The secret never crosses the browser RPC or appears in ordinary status projection.
          return { ok: true as const, value: {
            copied: true,
            inboxId: account.inboxId,
            claimUrl: 'https://console.agentmail.to/claim',
          } }
        }
        if (endpoint === 'console-key-check') {
          if (Object.keys(args).some(key => key !== 'apiKey') || args.apiKey === undefined) {
            throw new Error('AgentMail Console key check requires only apiKey')
          }
          const candidate = mailString(args.apiKey, 8192)
          let auth: Record<string, unknown>
          try {
            auth = mailRecord(await agentMailRequest('/auth/me', candidate, config.timeoutMs, fetch))
          } catch (error) {
            if (error instanceof AgentMailHttpError
              && (error.reason === 'credential-rejected' || error.status === 401 || error.status === 403)) {
              throw new Error('AgentMail rejected this API key; create a new key in Console and try again')
            }
            throw error
          }
          const scopeType = mailString(auth.scope_type)
          if (!['organization', 'pod', 'inbox'].includes(scopeType)) {
            throw new Error('AgentMail returned an invalid API key scope')
          }
          const account = await onboarding.status()
          if (account.state !== 'ready' && scopeType !== 'organization') {
            throw new Error('a new Kira inbox requires an organization-scoped AgentMail API key')
          }
          if (account.state === 'ready' && scopeType === 'inbox'
            && (account.inboxId === undefined || auth.inbox_id !== account.inboxId)) {
            throw new Error('this inbox-scoped AgentMail API key belongs to a different inbox')
          }
          return { ok: true as const, value: await onboarding.inspectConsoleKey(candidate) }
        }
        if (endpoint === 'signup') await onboarding.signup(mailString(args.ownerEmail), args.username === undefined ? `kira-${randomUUID().slice(0, 8)}` : mailString(args.username))
        else if (endpoint === 'recover') {
          if (Object.keys(args).length > 0) throw new Error('mail recovery uses only the persisted owner')
          await recoverEnrollment()
        }
        else if (endpoint === 'claim-status') {
          if (Object.keys(args).length > 0) throw new Error('mail claim confirmation does not accept parameters')
          await onboarding.confirmClaim()
        }
        else if (endpoint === 'console-key') {
          if (Object.keys(args).some(key => key !== 'apiKey' && key !== 'ownerEmail') || args.apiKey === undefined) {
            throw new Error('AgentMail Console recovery requires apiKey and optionally ownerEmail')
          }
          const candidate = mailString(args.apiKey, 8192)
          let auth: Record<string, unknown>
          try {
            auth = mailRecord(await agentMailRequest('/auth/me', candidate, config.timeoutMs, fetch))
          } catch (error) {
            if (error instanceof AgentMailHttpError
              && (error.reason === 'credential-rejected' || error.status === 401 || error.status === 403)) {
              throw new Error('AgentMail rejected this API key; create a new key in Console and try again')
            }
            throw error
          }
          const scopeType = mailString(auth.scope_type)
          if (!['organization', 'pod', 'inbox'].includes(scopeType)) {
            throw new Error('AgentMail returned an invalid API key scope')
          }
          const before = await onboarding.status()
          if (before.state !== 'ready' && scopeType !== 'organization') {
            throw new Error('a new Kira inbox requires an organization-scoped AgentMail API key')
          }
          if (before.state === 'ready' && scopeType === 'inbox'
            && (before.inboxId === undefined || auth.inbox_id !== before.inboxId)) {
            throw new Error('this inbox-scoped AgentMail API key belongs to a different inbox')
          }
          const account = await onboarding.adoptConsoleKey(
            candidate,
            args.ownerEmail === undefined ? undefined : mailString(args.ownerEmail),
          )
          if (account.state === 'ready') {
            socketDispose?.()
            socketDispose = undefined
            await receiver?.stop()
            receiver = undefined
            transportInbox = undefined
            status = 'connecting'
            void pump()
          }
        }
        else if (endpoint === 'owner') {
          if (Object.keys(args).some(key => key !== 'ownerEmail') || args.ownerEmail === undefined) {
            throw new Error('mail owner repair requires only ownerEmail')
          }
          await repairOwnerEnrollment(mailString(args.ownerEmail))
        }
        else if (endpoint === 'create-inbox') {
          if (Object.keys(args).length > 0) throw new Error('mail inbox creation uses only the persisted owner')
          await onboarding.createInbox()
        }
        else if (endpoint === 'discard') {
          if (Object.keys(args).length > 0) throw new Error('mail discard does not accept parameters')
          await discardEnrollment()
        }
        else if (endpoint === 'replace') {
          if (Object.keys(args).some(key => key !== 'ownerEmail')) throw new Error('mail replacement accepts only an optional owner email')
          await replaceEnrollment(args.ownerEmail === undefined ? undefined : mailString(args.ownerEmail))
        }
        else if (endpoint === 'connect') await onboarding.connect(mailString(args.ownerEmail), mailString(args.inboxId), mailString(args.apiKey, 8192))
        else if (endpoint === 'verify') await onboarding.verify(mailString(args.code))
        else if (endpoint === 'configure') {
          if (!Array.isArray(args.contacts) || args.contacts.some(value => typeof value !== 'string')) throw new Error('invalid authorized contacts')
          await onboarding.configure(args.contacts as string[],
            args.sessionId === undefined ? undefined : SessionId(mailString(args.sessionId)))
        } else if (endpoint === 'startup') {
          const subprocess = ctx.get('subprocess')
          if (!startupSupported || subprocess === undefined || typeof args.enabled !== 'boolean') throw new Error('local Windows startup is unavailable in this installation')
          const child = subprocess.spawn(mailStartupSpec(installRoot, args.enabled, process.env))
          const outcome = await child.done
          if (outcome.exitCode !== 0) throw new Error('could not configure local Windows startup')
        } else if (endpoint !== 'status' && endpoint !== 'refresh') throw new Error('unknown mail operation')
        if (endpoint !== 'status' && endpoint !== 'discard' && endpoint !== 'replace' && endpoint !== 'recover' && endpoint !== 'owner') {
          const account = await onboarding.status()
          const root = ctx.get('agents')?.roots()[0]
          if (account.sessionId === undefined && root !== undefined) await onboarding.bindSessionIfUnset(root.id)
          if (endpoint === 'refresh') await pump()
          else void pump()
        }
        const jobs = await journal.list()
        return { ok: true as const,
          value: { account: await onboarding.status(),
            connection: status,
            startup: { supported: startupSupported,
              enabled: startupPath !== undefined && existsSync(startupPath) },
            jobs: jobs.map(job => ({ id: job.id,
              sessionId: job.sessionId,
              title: job.message.subject,
              state: job.state,
              summary: job.summary,
              error: job.error })) } }
      } catch (error) {
        await handleProviderFailure(error,
          endpoint !== 'recover' && endpoint !== 'claim' && endpoint !== 'claim-status'
          && endpoint !== 'console-key' && endpoint !== 'console-key-check')
        // Provider bodies and fetch/socket errors never cross this secret-free status projection.
        const message = error instanceof Error && !/fetch|network|socket/iu.test(error.message) ? error.message : 'mail connection failed; check the local setup'
        return { ok: false as const, error: { code: 'internal', message, details: {} } }
      }
    }, { authority: 'loopback' })
  }
  syncRpc()
  const unbind = ctx.on('internal/service', (name) => {
    if (name === 'connection') syncRpc()
    if (name === 'agents' || name === 'sessionPersistence' || name === 'credentials') void pump()
  })
  const unbindCreated = ctx.on('agent/created', () => { void pump() })
  const timer = setInterval(() => { void pump() }, config.pollMs)
  void pump()
  let disposing: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (disposing !== undefined) return disposing
    disposed = true
    controller.abort()
    clearInterval(timer)
    unbind()
    unbindCreated()
    socketDispose?.()
    // Stop reception before cancellation; both disposal callers share the same cleanup settlement.
    const outboxStopped = Promise.all([outbox.stop(), ownerOutbox.stop()])
    const receiverStopped = receiver?.stop().catch(() => { /* The pump already owns reporting transport failure. */ })
    disposing = (async () => {
      await executor.stop()
      await receiverStopped
      await pumping
      await Promise.allSettled([...sends])
      await outboxStopped
      await rpcDispose?.()
    })()
    return disposing
  }
  ctx.effect(() => dispose, 'assistant-mail: owned local receiver')
  return { dispose, preflight,
    send(input) { return owned(async () => {
      const account = await onboarding.status()
      assertActive()
      if (account.state !== 'ready' || account.inboxId === undefined) throw new ProactivityDeferredError('Kira mail is not verified yet')
      const to = mailAddress(input.to)
      if (![account.ownerEmail, ...account.contacts].includes(to)) throw new Error('mail recipient is not authorized')
      if (!await config.authorizeOutgoing({ ...input, to })) throw new ProactivityDeferredError('mail task authorization is no longer active')
      assertActive()
      await outbox.enqueueMessage({ inboxId: account.inboxId, to, taskId: mailString(input.taskId),
        scheduledFor: mailString(input.scheduledFor), subject: mailString(input.subject, 1024),
        text: mailString(input.text, 64_000), idempotencyKey: mailString(input.idempotencyKey) })
      assertActive()
      await outbox.flush()
      await delivery(input.idempotencyKey)
    }) },
    async attention() {
      const rows: ProactivityAttentionItem[] = []
      for (const job of await journal.list()) {
        if (job.state !== 'replied' && job.state !== 'blocked') continue
        const detail = job.state === 'replied' ? job.summary : job.error
        if (detail === undefined) continue
        const revision = createHash('sha256').update(JSON.stringify([job.state, detail])).digest('hex')
        rows.push({ id: `mail:${job.id}`, revision, taskId: job.id, kind: job.state === 'replied' ? 'result' : 'failure', title: job.message.subject, detail: detail.slice(0, 320), at: job.updatedAt, score: job.state === 'blocked' ? 130 : 100 })
      }
      return rows
    } }
}
