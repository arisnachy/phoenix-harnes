import { SessionId } from '@phoenix-ai/dsh-session'
import { existsSync } from 'node:fs'
import type {} from '@phoenix-ai/dsh-subprocess'
import { mailStartupSpec } from './assistant-mail-startup.ts'
/** Local mailbox lifecycle, human-only configuration RPC and home-feed projection. */
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import type { HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import { AgentMailTransport } from './assistant-mail-agentmail.ts'
import { MailOnboarding } from './assistant-mail-onboarding.ts'
import { MailJournal } from './assistant-mail-journal.ts'
import { MailOutbox } from './assistant-mail-outbox.ts'
import { MailReceiver } from './assistant-mail-receiver.ts'
import { createMailExecutor } from './assistant-mail-executor.ts'
import { mailAddress, mailRecord, mailString } from './assistant-mail-store.ts'
import type { ProactivityAttentionItem, ProactivityRuntimeConfig } from './proactivity-runtime.ts'

/** Local mail runtime deployment settings. */
export interface AssistantMailConfig { readonly directory: string
  readonly credentialRef: string
  readonly pollMs: number
  readonly timeoutMs: number
  readonly workTimeoutMs: number
  /** Resolve the already-connected owner email used for automatic first-run enrollment. */
  readonly resolveOwnerEmail?: () => Promise<string | undefined> }
/** Mail host projection consumed by normal home attention. */
export interface AssistantMailRuntime {
  /** Read material blocked/completed mail outcomes.
   * @returns Browser-safe home feed rows.
   */
  attention(): Promise<ProactivityAttentionItem[]>
  /** Send a new idempotent message from Kira's verified mailbox.
   * @param input Authorized recipient, subject, body and stable deduplication key.
   */
  send(input: { readonly to: string; readonly subject: string; readonly text: string; readonly idempotencyKey: string }): Promise<void>
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
  const ensureEnrollment = (): Promise<void> => {
    if (enrolling !== undefined) return enrolling
    enrolling = (async () => {
      const account = await onboarding.status()
      if (account.state !== 'not-configured') return
      // Never create the provider account until Phoenix can durably retain the returned key.
      if (ctx.get('credentials') === undefined) return
      const owner = await config.resolveOwnerEmail?.()
      if (owner === undefined || owner.trim().length === 0) return
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
  const isDisposed = (): boolean => disposed
  let pumping: Promise<void> | undefined
  const outbox = new MailOutbox(join(config.directory, 'outbox.json'), async (reply) => {
    const account = await onboarding.status()
    if (account.state !== 'ready' || account.inboxId !== reply.inboxId || ![account.ownerEmail, ...account.contacts].includes(reply.to)) throw new Error('mail sender authorization revoked')
    try { return await new AgentMailTransport(resolveKey, reply.inboxId, config.timeoutMs).reply(reply) } catch (error) {
      status = error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
      throw error
    }
  })
  const recover = async (): Promise<void> => {
    await ensureEnrollment()
    const account = await onboarding.status()
    if (isDisposed() || account.state !== 'ready' || account.inboxId === undefined) return
    status = 'connecting'
    if (receiver === undefined || transportInbox !== account.inboxId || socketDispose === undefined) {
      socketDispose?.()
      await receiver?.stop()
      const transport = new AgentMailTransport(resolveKey, account.inboxId, config.timeoutMs)
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
    if (pumping !== undefined) return pumping
    pumping = recover().catch((error: unknown) => {
      status = error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
      socketDispose?.(); socketDispose = undefined
      // A failed subscription is recovered by the next polling interval without dropping the job journal.
    }).finally(() => { pumping = undefined })
    return pumping
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
        } else if (endpoint !== 'status' && endpoint !== 'refresh') throw new Error('unknown mail operation')
        if (endpoint !== 'status') {
          const account = await onboarding.status()
          const root = ctx.get('agents')?.roots()[0]
          if (account.sessionId === undefined && root !== undefined) await onboarding.configure(account.contacts, root.id)
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
        // Provider bodies and fetch/socket errors never cross this secret-free status projection.
        const message = error instanceof Error && !/fetch|network|socket/iu.test(error.message) ? error.message : 'mail connection failed; check the local setup'
        return { ok: false as const, error: { code: 'internal', message, details: {} } }
      }
    }, { authority: 'loopback' })
  }
  syncRpc()
  const unbind = ctx.on('internal/service', (name) => { if (name === 'connection') syncRpc() })
  const timer = setInterval(() => { void pump() }, config.pollMs)
  void pump()
  let disposing: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (disposing !== undefined) return disposing
    disposed = true
    clearInterval(timer)
    unbind()
    socketDispose?.()
    // Stop reception before cancellation; both disposal callers share the same cleanup settlement.
    const receiverStopped = receiver?.stop().catch(() => { /* The pump already owns reporting transport failure. */ })
    disposing = (async () => {
      await executor.stop()
      await receiverStopped
      await pumping
      await rpcDispose?.()
    })()
    return disposing
  }
  ctx.effect(() => dispose, 'assistant-mail: owned local receiver')
  return { dispose,
    async send(input) {
      const account = await onboarding.status()
      if (account.state !== 'ready' || account.inboxId === undefined) throw new Error('Kira mail is not verified yet')
      const to = mailAddress(input.to)
      if (![account.ownerEmail, ...account.contacts].includes(to)) throw new Error('mail recipient is not authorized')
      const transport = new AgentMailTransport(resolveKey, account.inboxId, config.timeoutMs)
      try {
        await transport.send(to, mailString(input.subject, 1024), mailString(input.text, 64_000), mailString(input.idempotencyKey))
      } catch (error) {
        status = error instanceof Error && error.message.includes('quota') ? 'quota-reached' : 'disconnected'
        throw error
      }
    },
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
