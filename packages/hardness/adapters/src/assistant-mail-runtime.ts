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
import { agentMailRequest, AgentMailTransport } from './assistant-mail-agentmail.ts'
import { MailOnboarding } from './assistant-mail-onboarding.ts'
import { MailJournal } from './assistant-mail-journal.ts'
import { MailOutbox } from './assistant-mail-outbox.ts'
import { MailReceiver } from './assistant-mail-receiver.ts'
import { createMailExecutor } from './assistant-mail-executor.ts'
import { mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'
import type { MailAccount, MailOutgoingOwnership, MailOutgoingMessage } from './assistant-mail-types.ts'
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
}

/** AgentMail Free-plan telemetry retained without exposing provider credentials. */
export interface AssistantMailQuotaSnapshot {
  readonly plan: 'free'
  readonly limits: { readonly inboxes: 3; readonly monthlyEmails: 3000; readonly storageBytes: 3221225472 }
  readonly used: { readonly inboxes: number; readonly monthlyEmails: number; readonly storageBytes: number; readonly storedMessages: number; readonly threads: number }
  readonly remaining: { readonly inboxes: number; readonly monthlyEmails: number; readonly storageBytes: number }
  readonly utilization: { readonly inboxes: number; readonly monthlyEmails: number; readonly storage: number }
  readonly level: 'ok' | 'watch' | 'high' | 'critical'
  readonly measuredAt: string
  readonly resetsAt: string
}

/** Host service used by Kira to inspect or create her own mailbox without touching Gmail setup. */
export interface AssistantMailControl {
  /** Read the current Kira mailbox identity. */
  status(): Promise<AssistantMailIdentity>
  /** Create the free Kira mailbox once when absent, or reuse the existing enrollment.
   * @param ownerEmail Optional explicit owner email when no connected account identity is available.
   */
  ensure(ownerEmail?: string): Promise<AssistantMailIdentity>
  /** Execute one allowlisted AgentMail mailbox operation with the credential retained by the host.
   * @param action Stable operation name exposed by phoenix_agentmail.
   * @param input Secret-free bounded arguments.
   * @returns Provider JSON with credentials removed by construction.
   */
  operate(action: string, input: Record<string, unknown>): Promise<unknown>
}

class AssistantMailControlService extends Service implements AssistantMailControl {
  constructor(ctx: Context, private readonly control: AssistantMailControl) {
    super(ctx, 'assistantMail')
  }
  status(): Promise<AssistantMailIdentity> { return this.control.status() }
  ensure(ownerEmail?: string): Promise<AssistantMailIdentity> { return this.control.ensure(ownerEmail) }
  operate(action: string, input: Record<string, unknown>): Promise<unknown> {
    return this.control.operate(action, input)
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
  const outbox = new MailOutbox(join(config.directory, 'outbox.json'), async (reply) => {
    assertActive()
    const account = await onboarding.status()
    assertActive()
    if (account.state !== 'ready' || account.inboxId !== reply.inboxId || ![account.ownerEmail, ...account.contacts].includes(reply.to)) throw new Error('mail sender authorization revoked')
    const transport = new AgentMailTransport(resolveKey, reply.inboxId, config.timeoutMs, fetch, controller.signal)
    try { return await transport.reply(reply) } catch (error) {
      status = error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
      throw error
    }
  }, Date.now, async (message) => {
    assertActive()
    const account = await onboarding.status()
    assertActive()
    if (account.state !== 'ready' || account.inboxId !== message.inboxId
      || ![account.ownerEmail, ...account.contacts].includes(message.to)) throw new ProactivityDeferredError('mail sender authorization is unavailable')
    if (!await config.authorizeOutgoing(message)) throw new ProactivityDeferredError('mail task authorization is no longer active')
    assertActive()
    const transport = new AgentMailTransport(resolveKey, message.inboxId, config.timeoutMs, fetch, controller.signal)
    try { return await transport.send(message.to, message.subject, message.text, message.idempotencyKey) } catch (error) {
      status = error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
      throw error
    }
  }, ownership => config.authorizeOutgoing(ownership))
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
    await ensureEnrollment()
    const account = await onboarding.status()
    if (isDisposed() || account.state !== 'ready' || account.inboxId === undefined) return
    status = 'connecting'
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
  }
  const pump = (): Promise<void> => {
    if (isDisposed()) return Promise.resolve()
    if (pumping !== undefined) {
      // A provider notification is an edge, not a level. Remember one extra pass so a
      // message arriving after the current listing snapshot cannot wait for the poll timer.
      repumpRequested = true
      return pumping
    }
    pumping = (async () => {
      do {
        repumpRequested = false
        try {
          await recover()
        } catch (error) {
          status = error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
          socketDispose?.(); socketDispose = undefined
          // The durable journal remains authoritative; a queued wake may retry immediately,
          // otherwise the bounded polling interval performs recovery.
        }
      } while (repumpRequested && !isDisposed())
    })().finally(() => {
      pumping = undefined
      // Close the tiny race between the loop condition and finally: if another wake landed
      // while the promise was settling, own a fresh pass instead of dropping that edge.
      if (repumpRequested && !isDisposed()) void pump()
    })
    return pumping
  }
  const identity = async (): Promise<AssistantMailIdentity> => {
    const account = await onboarding.status()
    return {
      state: account.state,
      ...(account.inboxId === undefined ? {} : { inboxId: account.inboxId }),
      connection: status,
    }
  }
  const operationString = (value: unknown, name: string, limit = 64_000): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > limit) throw new Error(`invalid ${name}`)
    return value
  }
  const operationBoolean = (value: unknown, name: string): boolean | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'boolean') throw new Error(`invalid ${name}`)
    return value
  }
  const operationLimit = (value: unknown): number => {
    if (value === undefined) return 25
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100) throw new Error('invalid mail limit')
    return value as number
  }
  const operationStrings = (value: unknown, name: string, max = 50): string[] | undefined => {
    if (value === undefined) return undefined
    if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || item.length === 0 || item.length > 1024)) {
      throw new Error(`invalid ${name}`)
    }
    return value as string[]
  }
  const operationAddresses = (value: unknown, name: string): string[] | undefined => {
    const values = operationStrings(value, name)
    return values?.map(value => mailAddress(value))
  }
  const operationRecord = (value: unknown, name: string): Record<string, unknown> | undefined => {
    if (value === undefined) return undefined
    try { return mailRecord(value) } catch { throw new Error(`invalid ${name}`) }
  }
  const queryValue = (query: URLSearchParams, name: string, value: unknown): void => {
    if (value === undefined) return
    query.set(name, operationString(value, name, 4096))
  }
  const queryArray = (query: URLSearchParams, name: string, value: unknown): void => {
    for (const item of operationStrings(value, name) ?? []) query.append(name, item)
  }
  const listQuery = (input: Record<string, unknown>, searchable = false): string => {
    const query = new URLSearchParams({ limit: String(operationLimit(input.limit)) })
    queryValue(query, 'page_token', input.page_token)
    queryValue(query, 'before', input.before)
    queryValue(query, 'after', input.after)
    const ascending = operationBoolean(input.ascending, 'ascending')
    if (ascending !== undefined) query.set('ascending', String(ascending))
    queryArray(query, 'labels', input.labels)
    if (searchable) {
      queryArray(query, 'from', input.from)
      queryArray(query, 'to', input.to_filter)
      queryArray(query, 'subject', input.subject_filter)
      queryArray(query, 'senders', input.senders)
      queryArray(query, 'recipients', input.recipients)
    }
    return query.toString()
  }
  const authorizeRecipients = (account: MailAccount, ...groups: Array<string[] | undefined>): void => {
    const allowed = new Set([account.inboxId, account.ownerEmail, ...account.contacts]
      .filter((value): value is string => value !== undefined))
    for (const address of groups.flatMap(group => group ?? [])) {
      if (!allowed.has(address)) throw new Error(`mail recipient is not authorized: ${address}`)
    }
  }
  const providerOperation = async (path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown,
    idempotencyKey?: string): Promise<unknown> => {
    assertActive()
    const key = await resolveKey()
    if (key === undefined) throw new Error('mail credential is unavailable')
    return agentMailRequest(path, key, config.timeoutMs, fetch, body, idempotencyKey, controller.signal, method)
  }
  const FREE_INBOX_LIMIT = 3 as const
  const FREE_MONTHLY_EMAIL_LIMIT = 3_000 as const
  const FREE_STORAGE_BYTES = 3 * 1024 * 1024 * 1024 as 3221225472
  const FREE_EMAIL_RESERVE = 100
  const QUOTA_CACHE_MS = 60_000
  let quotaCache: AssistantMailQuotaSnapshot | undefined
  let quotaCacheAt = 0
  const metricValue = (value: unknown, key: string): number => {
    const root = mailRecord(value)
    const series = root[key]
    if (!Array.isArray(series) || series.length === 0) return 0
    let latest = 0
    for (const item of series) {
      const row = mailRecord(item)
      if (typeof row.value === 'number' && Number.isFinite(row.value)) latest = Math.max(latest, row.value)
    }
    return Math.max(0, latest)
  }
  const eventCount = (value: unknown, key: string): number => {
    const root = mailRecord(value)
    const series = root[key]
    if (!Array.isArray(series)) return 0
    return series.reduce((total, item) => {
      const row = mailRecord(item)
      return total + (typeof row.count === 'number' && Number.isFinite(row.count) ? Math.max(0, row.count) : 0)
    }, 0)
  }
  const quotaLevel = (snapshot: Pick<AssistantMailQuotaSnapshot, 'utilization'>): AssistantMailQuotaSnapshot['level'] => {
    const max = Math.max(snapshot.utilization.inboxes, snapshot.utilization.monthlyEmails, snapshot.utilization.storage)
    return max >= 0.95 ? 'critical' : max >= 0.9 ? 'high' : max >= 0.8 ? 'watch' : 'ok'
  }
  const quotaSnapshot = async (force = false): Promise<AssistantMailQuotaSnapshot> => {
    if (!force && quotaCache !== undefined && Date.now() - quotaCacheAt < QUOTA_CACHE_MS) return quotaCache
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const usageQuery = new URLSearchParams({ descending: 'true', limit: '1', period: '86400' })
    for (const type of ['storage_bytes', 'message_count', 'thread_count']) usageQuery.append('usage_types', type)
    const eventQuery = new URLSearchParams({
      start: monthStart.toISOString(),
      end: now.toISOString(),
      period: '86400',
      limit: '40',
    })
    eventQuery.append('event_types', 'message.sent')
    eventQuery.append('event_types', 'message.received')
    const [organizationRaw, usageRaw, eventsRaw] = await Promise.all([
      providerOperation('/organizations'),
      providerOperation(`/metrics/usage?${usageQuery}`),
      providerOperation(`/metrics/events?${eventQuery}`),
    ])
    const organization = mailRecord(organizationRaw)
    const inboxes = typeof organization.inbox_count === 'number' && Number.isFinite(organization.inbox_count)
      ? Math.max(0, organization.inbox_count)
      : 0
    const storageBytes = metricValue(usageRaw, 'storage_bytes')
    const storedMessages = metricValue(usageRaw, 'message_count')
    const threads = metricValue(usageRaw, 'thread_count')
    // Free counts send + receive against the shared monthly email allowance. Using both event
    // streams is intentionally conservative so Kira preserves headroom for inbound work.
    const monthlyEmails = eventCount(eventsRaw, 'message.sent') + eventCount(eventsRaw, 'message.received')
    const utilization = {
      inboxes: inboxes / FREE_INBOX_LIMIT,
      monthlyEmails: monthlyEmails / FREE_MONTHLY_EMAIL_LIMIT,
      storage: storageBytes / FREE_STORAGE_BYTES,
    }
    const base = {
      plan: 'free' as const,
      limits: { inboxes: FREE_INBOX_LIMIT, monthlyEmails: FREE_MONTHLY_EMAIL_LIMIT, storageBytes: FREE_STORAGE_BYTES },
      used: { inboxes, monthlyEmails, storageBytes, storedMessages, threads },
      remaining: {
        inboxes: Math.max(0, FREE_INBOX_LIMIT - inboxes),
        monthlyEmails: Math.max(0, FREE_MONTHLY_EMAIL_LIMIT - monthlyEmails),
        storageBytes: Math.max(0, FREE_STORAGE_BYTES - storageBytes),
      },
      utilization,
      measuredAt: now.toISOString(),
      resetsAt: resetsAt.toISOString(),
    }
    quotaCache = { ...base, level: quotaLevel(base) }
    quotaCacheAt = Date.now()
    return quotaCache
  }
  const assertFreeSendHeadroom = async (): Promise<void> => {
    const quota = await quotaSnapshot()
    if (quota.used.monthlyEmails >= FREE_MONTHLY_EMAIL_LIMIT - FREE_EMAIL_RESERVE) {
      throw new Error(`AgentMail Free guard paused outbound mail at ${quota.used.monthlyEmails}/${FREE_MONTHLY_EMAIL_LIMIT} emails to preserve ${FREE_EMAIL_RESERVE} messages of inbound headroom until ${quota.resetsAt}`)
    }
  }
  const cleanupTrash = async (input: Record<string, unknown>, execute: boolean): Promise<Record<string, unknown>> => {
    const account = await onboarding.status()
    if (account.state !== 'ready' || account.inboxId === undefined) throw new Error('Kira mail is not verified yet')
    const days = input.older_than_days === undefined ? 7 : Number(input.older_than_days)
    const maxDelete = input.max_delete === undefined ? 100 : Number(input.max_delete)
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('older_than_days must be an integer from 1 to 3650')
    if (!Number.isInteger(maxDelete) || maxDelete < 1 || maxDelete > 100) throw new Error('max_delete must be an integer from 1 to 100')
    if (execute && input.confirm_cleanup !== true) throw new Error('cleanup requires confirm_cleanup=true after an explicit user request')
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const query = new URLSearchParams({
      limit: String(maxDelete),
      labels: 'trash',
      before: cutoff,
      ascending: 'true',
      include_trash: 'true',
    })
    const listed = mailRecord(await providerOperation(`/inboxes/${encodeURIComponent(account.inboxId)}/messages?${query}`))
    const messages = Array.isArray(listed.messages) ? listed.messages.map(value => mailRecord(value)) : []
    const candidates = messages.flatMap(row => typeof row.message_id === 'string' ? [{
      messageId: row.message_id,
      subject: typeof row.subject === 'string' ? row.subject.slice(0, 180) : '',
      timestamp: typeof row.timestamp === 'string' ? row.timestamp : undefined,
    }] : [])
    if (!execute) return { mode: 'preview', olderThanDays: days, candidateCount: candidates.length, candidates }
    let deleted = 0
    const failed: string[] = []
    for (const candidate of candidates) {
      try {
        await providerOperation(`/inboxes/${encodeURIComponent(account.inboxId)}/messages/${encodeURIComponent(candidate.messageId)}`, 'DELETE')
        deleted++
      } catch {
        failed.push(candidate.messageId)
      }
    }
    quotaCache = undefined
    quotaCacheAt = 0
    const quota = await quotaSnapshot(true)
    return { mode: 'execute', olderThanDays: days, candidateCount: candidates.length, deleted, failed, quota }
  }
  const readyAccount = async (): Promise<MailAccount & { readonly inboxId: string }> => {
    const account = await onboarding.status()
    if (account.state !== 'ready' || account.inboxId === undefined) throw new Error('Kira mail is not verified yet')
    return account as MailAccount & { readonly inboxId: string }
  }
  const targetInbox = (account: MailAccount & { readonly inboxId: string }, input: Record<string, unknown>): string =>
    input.inbox_id === undefined ? account.inboxId : mailAddress(operationString(input.inbox_id, 'inbox_id', 320))
  const requirePermanent = (input: Record<string, unknown>, resource: string): void => {
    if (input.confirm_permanent !== true) throw new Error(`${resource} deletion requires confirm_permanent=true after an explicit user request`)
  }
  const requireInboxAdmin = (input: Record<string, unknown>): void => {
    if (input.confirm_inbox_admin !== true) {
      throw new Error('inbox administration requires confirm_inbox_admin=true after an explicit owner request')
    }
  }
  const messageBody = (input: Record<string, unknown>, account: MailAccount): Record<string, unknown> => {
    const to = operationAddresses(input.to, 'to')
    const cc = operationAddresses(input.cc, 'cc')
    const bcc = operationAddresses(input.bcc, 'bcc')
    authorizeRecipients(account, to, cc, bcc)
    const labels = operationStrings(input.labels, 'labels')
    const body: Record<string, unknown> = {
      ...(to === undefined ? {} : { to }),
      ...(cc === undefined ? {} : { cc }),
      ...(bcc === undefined ? {} : { bcc }),
      ...(input.subject === undefined ? {} : { subject: operationString(input.subject, 'subject', 1024) }),
      ...(input.text === undefined ? {} : { text: operationString(input.text, 'text') }),
      ...(input.html === undefined ? {} : { html: operationString(input.html, 'html', 128_000) }),
      ...(labels === undefined ? {} : { labels }),
    }
    if (input.track_opens !== undefined) body.track_opens = operationBoolean(input.track_opens, 'track_opens')
    return body
  }
  const operate = async (action: string, input: Record<string, unknown>): Promise<unknown> => {
    const account = await readyAccount()
    const inbox = targetInbox(account, input)
    const encodedInbox = encodeURIComponent(inbox)
    const messageId = (): string => encodeURIComponent(operationString(input.message_id, 'message_id', 2048))
    const threadId = (): string => encodeURIComponent(operationString(input.thread_id, 'thread_id', 2048))
    const draftId = (): string => encodeURIComponent(operationString(input.draft_id, 'draft_id', 2048))
    const attachmentId = (): string => encodeURIComponent(operationString(input.attachment_id, 'attachment_id', 2048))
    const idempotency = input.idempotency_key === undefined ? undefined : operationString(input.idempotency_key, 'idempotency_key', 1024)
    switch (action) {
      case 'list_messages':
        return providerOperation(`/inboxes/${encodedInbox}/messages?${listQuery(input, true)}`)
      case 'search_messages': {
        const query = new URLSearchParams({ q: operationString(input.q, 'q', 4096), limit: String(operationLimit(input.limit)) })
        queryValue(query, 'page_token', input.page_token); queryValue(query, 'before', input.before); queryValue(query, 'after', input.after)
        return providerOperation(`/inboxes/${encodedInbox}/messages/search?${query}`)
      }
      case 'get_message':
        return providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}`)
      case 'get_message_raw':
        return providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}/raw`)
      case 'get_message_attachment':
        return providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}/attachments/${attachmentId()}`)
      case 'update_message_labels': {
        const add = operationStrings(input.add_labels, 'add_labels')
        const remove = operationStrings(input.remove_labels, 'remove_labels')
        if (add === undefined && remove === undefined) throw new Error('message label update needs add_labels or remove_labels')
        return providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}`, 'PATCH', {
          ...(add === undefined ? {} : { add_labels: add }),
          ...(remove === undefined ? {} : { remove_labels: remove }),
        })
      }
      case 'batch_update_message_labels': {
        const ids = operationStrings(input.message_ids, 'message_ids', 50)
        if (ids === undefined || ids.length === 0) throw new Error('batch update requires message_ids')
        const add = operationStrings(input.add_labels, 'add_labels')
        const remove = operationStrings(input.remove_labels, 'remove_labels')
        if (add === undefined && remove === undefined) throw new Error('batch label update needs add_labels or remove_labels')
        return providerOperation(`/inboxes/${encodedInbox}/messages/batch-update`, 'POST', {
          message_ids: ids,
          ...(add === undefined ? {} : { add_labels: add }),
          ...(remove === undefined ? {} : { remove_labels: remove }),
        })
      }
      case 'send_message':
        await assertFreeSendHeadroom()
        return providerOperation(`/inboxes/${encodedInbox}/messages/send`, 'POST', messageBody(input, account), idempotency)
      case 'reply_message':
      case 'reply_all': {
        const original = mailRecord(await providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}`))
        const sender = original.from === undefined
          ? undefined
          : mailAddress(operationString(original.from, 'message.from', 320))
        if (sender === undefined) throw new Error('message sender is unavailable')
        if (action === 'reply_all') {
          authorizeRecipients(account,
            operationAddresses(original.to, 'message.to'),
            operationAddresses(original.cc, 'message.cc'),
            [sender])
        } else {
          authorizeRecipients(account, [sender])
        }
        await assertFreeSendHeadroom()
        const body = messageBody({ ...input, to: undefined, cc: undefined, bcc: undefined, subject: undefined }, account)
        if (action === 'reply_message') {
          // Pin the reply to the authenticated sender. Do not let an untrusted Reply-To
          // header redirect Kira to a destination the owner never authorized.
          body.to = [sender]
          body.reply_all = false
        }
        return providerOperation(
          `/inboxes/${encodedInbox}/messages/${messageId()}/${action === 'reply_all' ? 'reply-all' : 'reply'}`,
          'POST',
          body,
          idempotency,
        )
      }
      case 'forward_message':
        await assertFreeSendHeadroom()
        return providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}/forward`, 'POST', messageBody(input, account), idempotency)
      case 'delete_message':
        requirePermanent(input, 'message')
        return providerOperation(`/inboxes/${encodedInbox}/messages/${messageId()}`, 'DELETE')
      case 'list_threads':
        return providerOperation(`/inboxes/${encodedInbox}/threads?${listQuery(input, true)}`)
      case 'search_threads': {
        const query = new URLSearchParams({ q: operationString(input.q, 'q', 4096), limit: String(operationLimit(input.limit)) })
        queryValue(query, 'page_token', input.page_token); queryValue(query, 'before', input.before); queryValue(query, 'after', input.after)
        return providerOperation(`/inboxes/${encodedInbox}/threads/search?${query}`)
      }
      case 'get_thread':
        return providerOperation(`/inboxes/${encodedInbox}/threads/${threadId()}`)
      case 'get_thread_attachment':
        return providerOperation(`/inboxes/${encodedInbox}/threads/${threadId()}/attachments/${attachmentId()}`)
      case 'update_thread_labels': {
        const add = operationStrings(input.add_labels, 'add_labels')
        const remove = operationStrings(input.remove_labels, 'remove_labels')
        if (add === undefined && remove === undefined) throw new Error('thread label update needs add_labels or remove_labels')
        return providerOperation(`/inboxes/${encodedInbox}/threads/${threadId()}`, 'PATCH', {
          ...(add === undefined ? {} : { add_labels: add }),
          ...(remove === undefined ? {} : { remove_labels: remove }),
        })
      }
      case 'delete_thread':
        requirePermanent(input, 'thread')
        return providerOperation(`/inboxes/${encodedInbox}/threads/${threadId()}`, 'DELETE')
      case 'list_drafts':
        return providerOperation(`/inboxes/${encodedInbox}/drafts?${listQuery(input)}`)
      case 'get_draft':
        return providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}`)
      case 'get_draft_attachment':
        return providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}/attachments/${attachmentId()}`)
      case 'create_draft': {
        const body = messageBody(input, account)
        if (input.client_id !== undefined) body.client_id = operationString(input.client_id, 'client_id', 1024)
        if (input.in_reply_to !== undefined) body.in_reply_to = operationString(input.in_reply_to, 'in_reply_to', 2048)
        if (input.forward_of !== undefined) body.forward_of = operationString(input.forward_of, 'forward_of', 2048)
        if (input.reply_all !== undefined) body.reply_all = operationBoolean(input.reply_all, 'reply_all')
        if (input.send_at !== undefined) body.send_at = operationString(input.send_at, 'send_at', 128)
        return providerOperation(`/inboxes/${encodedInbox}/drafts`, 'POST', body)
      }
      case 'update_draft': {
        const current = mailRecord(await providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}`))
        const body = messageBody(input, account)
        for (const field of ['to', 'cc', 'bcc'] as const) {
          if (input[field] === null) body[field] = []
        }
        if (input.send_at === null) body.send_at = null
        else if (input.send_at !== undefined) body.send_at = operationString(input.send_at, 'send_at', 128)
        const add = operationStrings(input.add_labels, 'add_labels')
        const remove = operationStrings(input.remove_labels, 'remove_labels')
        if (add !== undefined) body.add_labels = add
        if (remove !== undefined) body.remove_labels = remove
        // If recipients were omitted, verify the existing draft still stays inside the owner allowlist.
        authorizeRecipients(account,
          operationAddresses(input.to === undefined ? current.to : input.to, 'to'),
          operationAddresses(input.cc === undefined ? current.cc : input.cc, 'cc'),
          operationAddresses(input.bcc === undefined ? current.bcc : input.bcc, 'bcc'))
        return providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}`, 'PATCH', body)
      }
      case 'send_draft': {
        await assertFreeSendHeadroom()
        const draft = mailRecord(await providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}`))
        authorizeRecipients(account,
          operationAddresses(draft.to, 'draft.to'),
          operationAddresses(draft.cc, 'draft.cc'),
          operationAddresses(draft.bcc, 'draft.bcc'))
        if (draft.in_reply_to !== undefined) {
          const replyMessageId = encodeURIComponent(operationString(draft.in_reply_to, 'draft.in_reply_to', 2048))
          const original = mailRecord(await providerOperation(`/inboxes/${encodedInbox}/messages/${replyMessageId}`))
          const sender = original.from === undefined
            ? undefined
            : mailAddress(operationString(original.from, 'message.from', 320))
          if (sender === undefined) throw new Error('draft reply sender is unavailable')
          if (draft.reply_all === true) {
            authorizeRecipients(account,
              operationAddresses(original.to, 'message.to'),
              operationAddresses(original.cc, 'message.cc'),
              [sender])
          } else {
            authorizeRecipients(account, [sender])
          }
        }
        const add = operationStrings(input.add_labels, 'add_labels')
        const remove = operationStrings(input.remove_labels, 'remove_labels')
        return providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}/send`, 'POST', {
          ...(add === undefined ? {} : { add_labels: add }),
          ...(remove === undefined ? {} : { remove_labels: remove }),
        }, idempotency)
      }
      case 'delete_draft':
        requirePermanent(input, 'draft')
        return providerOperation(`/inboxes/${encodedInbox}/drafts/${draftId()}`, 'DELETE')
      case 'list_inboxes':
        return providerOperation(`/inboxes?${listQuery(input)}`)
      case 'search_inboxes': {
        const query = new URLSearchParams({ q: operationString(input.q, 'q', 256), limit: String(operationLimit(input.limit)) })
        queryValue(query, 'page_token', input.page_token)
        return providerOperation(`/inboxes/search?${query}`)
      }
      case 'get_inbox':
        return providerOperation(`/inboxes/${encodedInbox}`)
      case 'create_inbox': {
        requireInboxAdmin(input)
        const quota = await quotaSnapshot()
        if (quota.used.inboxes >= FREE_INBOX_LIMIT) throw new Error('AgentMail Free inbox limit reached (3/3); delete an unused inbox before creating another')
        const body: Record<string, unknown> = {}
        if (input.username !== undefined) body.username = operationString(input.username, 'username', 128)
        if (input.domain !== undefined) body.domain = operationString(input.domain, 'domain', 320)
        if (input.display_name !== undefined) body.display_name = operationString(input.display_name, 'display_name', 320)
        if (input.client_id !== undefined) body.client_id = operationString(input.client_id, 'client_id', 1024)
        const metadata = operationRecord(input.metadata, 'metadata')
        if (metadata !== undefined) body.metadata = metadata
        return providerOperation('/inboxes', 'POST', body)
      }
      case 'update_inbox': {
        requireInboxAdmin(input)
        const body: Record<string, unknown> = {}
        if (input.display_name !== undefined) body.display_name = operationString(input.display_name, 'display_name', 320)
        const metadata = operationRecord(input.metadata, 'metadata')
        if (metadata !== undefined) body.metadata = metadata
        if (input.status !== undefined) {
          const value = operationString(input.status, 'status', 16)
          if (value !== 'active' && value !== 'paused') throw new Error('inbox status must be active or paused')
          body.status = value
        }
        if (Object.keys(body).length === 0) throw new Error('inbox update needs display_name, metadata, or status')
        return providerOperation(`/inboxes/${encodedInbox}`, 'PATCH', body)
      }
      case 'quota_status':
        return quotaSnapshot(input.refresh === true)
      case 'cleanup_preview':
        return cleanupTrash(input, false)
      case 'cleanup_execute':
        return cleanupTrash(input, true)
      case 'delete_inbox':
        requireInboxAdmin(input)
        requirePermanent(input, 'inbox')
        if (inbox === account.inboxId && input.confirm_primary_inbox !== true) {
          throw new Error('deleting Kira primary inbox also requires confirm_primary_inbox=true after an explicit user request')
        }
        return providerOperation(`/inboxes/${encodedInbox}`, 'DELETE')
      default:
        throw new Error('unsupported AgentMail operation')
    }
  }
  const serviceContext = ctx as unknown as { readonly reflect?: unknown }
  if (serviceContext.reflect !== undefined) {
    new AssistantMailControlService(ctx, {
      status: identity,
      async ensure(ownerEmail) {
        await ensureEnrollment(ownerEmail, true)
        const account = await onboarding.status()
        const root = ctx.get('agents')?.roots()[0]
        if (account.sessionId === undefined && root !== undefined) {
          await onboarding.configure(account.contacts, root.id)
        }
        if (account.state === 'ready') void pump()
        return identity()
      },
      operate,
    })
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
        if (endpoint === 'signup') await onboarding.signup(mailString(args.ownerEmail), args.username === undefined ? `kira-${randomUUID().slice(0, 8)}` : mailString(args.username))
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
        } else if (endpoint !== 'status' && endpoint !== 'refresh' && endpoint !== 'cleanup-preview' && endpoint !== 'cleanup-trash') throw new Error('unknown mail operation')
        let cleanup: Record<string, unknown> | undefined
        if (endpoint === 'cleanup-preview') cleanup = await cleanupTrash(args, false)
        else if (endpoint === 'cleanup-trash') cleanup = await cleanupTrash({ ...args, confirm_cleanup: true }, true)
        if (endpoint !== 'status' && endpoint !== 'cleanup-preview' && endpoint !== 'cleanup-trash') {
          const account = await onboarding.status()
          const root = ctx.get('agents')?.roots()[0]
          if (account.sessionId === undefined && root !== undefined) await onboarding.configure(account.contacts, root.id)
          if (endpoint === 'refresh') {
            await pump()
            quotaCache = undefined
            quotaCacheAt = 0
          } else void pump()
        }
        const account = await onboarding.status()
        const quota = account.state === 'ready'
          ? await quotaSnapshot(endpoint === 'refresh' || endpoint === 'cleanup-trash')
          : undefined
        const jobs = await journal.list()
        return { ok: true as const,
          value: { account,
            connection: status,
            quota,
            ...(cleanup === undefined ? {} : { cleanup }),
            startup: { supported: startupSupported,
              enabled: startupPath !== undefined && existsSync(startupPath) },
            jobs: jobs.map(job => ({ id: job.id,
              sessionId: job.sessionId,
              title: job.message.subject,
              state: job.state,
              summary: job.summary,
              error: job.error })) } }
      } catch (error) {
        // Provider bodies and fetch/socket errors never cross this secret-free status projection.
        const message = error instanceof Error && !/fetch|network|socket/iu.test(error.message) ? error.message : 'mail connection failed; check the local setup'
        return { ok: false as const, error: { code: 'internal', message, details: {} } }
      }
    }, { authority: 'loopback' })
  }
  syncRpc()
  const unbind = ctx.on('internal/service', (name) => {
    if (name === 'connection') syncRpc()
    // During Windows/login startup the mailbox can become ready before the execution
    // services do. Reconcile as soon as those dependencies mount instead of waiting a minute.
    if (name === 'agents' || name === 'sessionPersistence' || name === 'credentials') void pump()
  })
  const timer = setInterval(() => { void pump() }, config.pollMs)
  void pump()
  let disposing: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (disposing !== undefined) return disposing
    disposed = true
    controller.abort()
    clearInterval(timer)
    unbind()
    socketDispose?.()
    // Stop reception before cancellation; both disposal callers share the same cleanup settlement.
    const outboxStopped = outbox.stop()
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
      await assertFreeSendHeadroom()
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
      try {
        const account = await onboarding.status()
        if (account.state === 'ready') {
          const quota = await quotaSnapshot()
          if (quota.level !== 'ok') {
            const detail = `Free: ${quota.used.inboxes}/3 inboxes · ${quota.used.monthlyEmails}/3000 emails este mes · ${(quota.used.storageBytes / (1024 ** 3)).toFixed(2)}/3.00 GB. Quedan ${quota.remaining.monthlyEmails} emails y ${(quota.remaining.storageBytes / (1024 ** 3)).toFixed(2)} GB.`
            rows.push({
              id: 'mail:quota-free',
              revision: createHash('sha256').update(JSON.stringify([quota.level, quota.used])).digest('hex'),
              taskId: 'mail:quota-free',
              kind: quota.level === 'critical' ? 'failure' : 'upcoming',
              title: 'AgentMail Free · control de capacidad',
              detail,
              at: quota.measuredAt,
              score: quota.level === 'critical' ? 145 : quota.level === 'high' ? 125 : 90,
            })
          }
        }
      } catch {
        // Quota telemetry is advisory for attention; mailbox delivery owns its own hard send guard.
      }
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
