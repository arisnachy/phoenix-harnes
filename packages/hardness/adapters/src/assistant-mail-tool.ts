import {
  defineTool,
  ToolArgsError,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'
import type { AssistantMailControl, AssistantMailIdentity } from './assistant-mail-runtime.ts'

type MailIdentityResult = {
  kind: 'kira_mail_identity'
  available: boolean
  state: AssistantMailIdentity['state'] | 'unavailable'
  address?: string
  connection?: string
  owner_email?: string
  needs_verification: boolean
  guidance: string
}

function project(value: AssistantMailIdentity): MailIdentityResult {
  if (value.state === 'ready') {
    return {
      kind: 'kira_mail_identity',
      available: true,
      state: value.state,
      ...(value.inboxId === undefined ? {} : { address: value.inboxId }),
      connection: value.connection,
      ...(value.ownerEmail === undefined ? {} : { owner_email: value.ownerEmail }),
      needs_verification: false,
      guidance: 'Use phoenix_mail_send to send an explicitly requested message to the verified owner. Use action=refresh to reconcile incoming tasks. Tell the user Kira\'s exact mailbox address. This is Kira\'s own AgentMail inbox, not Gmail.',
    }
  }
  if (value.state === 'pending-verification') {
    return {
      kind: 'kira_mail_identity',
      available: true,
      state: value.state,
      ...(value.inboxId === undefined ? {} : { address: value.inboxId }),
      connection: value.connection,
      needs_verification: true,
      guidance: 'The mailbox already exists. Tell the user the exact address and ask them to finish '
        + 'the six-digit owner verification with action=verify and the code they received, or in Settings. '
        + 'If the saved owner email is wrong, use action=owner with owner_email to repair it and resend verification. '
        + 'If the user explicitly says this mailbox is stale/broken and wants a new one, action=replace removes/abandons it and starts a fresh enrollment.',
    }
  }
  if (value.state === 'signup-ambiguous') {
    return {
      kind: 'kira_mail_identity',
      available: true,
      state: value.state,
      connection: value.connection,
      needs_verification: false,
      guidance: 'The provider signup result is ambiguous. Do not retry signup automatically. '
        + 'Use action=recover when the user wants the old mailbox back. If recovery failed or the user explicitly wants to abandon the stale mailbox and create a new one, '
        + 'use action=replace. Replacement is destructive and may leave the inaccessible remote inbox at AgentMail when its credential is already lost.',
    }
  }
  return {
    kind: 'kira_mail_identity',
    available: true,
    state: value.state,
    connection: value.connection,
    needs_verification: false,
    guidance: 'Kira does not have a mailbox yet. Use action=ensure. AgentMail signup does not require '
      + 'a pre-existing API key; Phoenix receives the new key from signup and stores it securely. '
      + 'If no owner identity is connected, provide owner_email only for the one-time verification code.',
  }
}

/**
 * Create the model-facing control for Kira's own mailbox identity.
 * @param resolve Runtime resolver because the host mailbox may mount after this agent scope.
 * @returns Tool that inspects or ensures the real local-assistant mailbox.
 */
export function createAssistantMailIdentityTool(
  resolve: () => AssistantMailControl | undefined,
): ToolDefinition {
  return defineTool({
    name: 'phoenix_mail_identity',
    description: 'Read or create Kira/Phoenix\'s own free AgentMail mailbox. Use this whenever the user asks '
      + 'Kira to configure/create/get her own email address, asks what Kira\'s email is, or asks whether her '
      + 'mailbox is ready. This is not Gmail and does not create a Gmail account. action=ensure creates the '
      + 'mailbox only when absent and otherwise reuses the existing enrollment. Never invent an address and '
      + 'never retry recovery automatically; action=recover renews access to the same owner account. action=owner repairs a mistyped owner email on an unverified mailbox. Use action=create-inbox only for an explicit request for another mailbox, after owner verification; provider quota may refuse it. '
      + 'Use action=replace when the user explicitly wants a stale/broken mailbox replaced; it retains the known owner identity, discards the old enrollment and immediately starts a fresh one. '
      + 'Use action=discard only when the user explicitly wants to remove/abandon the mailbox without creating a replacement.',
    parameters: {
      action: {
        type: 'string',
        enum: ['status', 'ensure', 'recover', 'owner', 'create-inbox', 'replace', 'discard', 'verify', 'refresh'],
        required: true,
        description: 'status reads the mailbox; ensure creates it once if absent; recover restores the persisted owner account; owner repairs a mistyped owner email and resends verification; create-inbox adds another inbox to a verified account; replace deletes/abandons a stale mailbox and immediately starts a fresh enrollment; discard removes/abandons it without replacement; verify activates the existing inbox with the owner code; refresh requests an incoming check without waiting for task completion.',
      },
      code: { type: 'string', description: 'Six-digit owner verification code; required only for action=verify. Never invent or guess it.' },
      owner_email: {
        type: 'string',
        description: 'Optional owner email for the one-time verification code when Phoenix cannot resolve one '
          + 'from an already connected account. This is not Kira\'s mailbox.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'kira_mail_identity', required: true },
          available: { type: 'boolean', required: true },
          state: {
            type: 'string',
            enum: ['not-configured', 'signup-ambiguous', 'pending-verification', 'ready', 'unavailable'],
            required: true,
          },
          address: { type: 'string' },
          connection: { type: 'string' },
          owner_email: { type: 'string' },
          needs_verification: { type: 'boolean', required: true },
          guidance: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const service = resolve()
      if (service === undefined) {
        return {
          kind: 'kira_mail_identity',
          available: false,
          state: 'unavailable',
          needs_verification: false,
          guidance: 'The local Kira mailbox runtime is not mounted in this Phoenix process. '
            + 'Do not fall back to Gmail creation or invent an address.',
        } satisfies MailIdentityResult
      }
      try {
        if (args.action === 'recover') return project(await service.recover())
        if (args.action === 'owner') {
          if (args.owner_email === undefined) throw new ToolArgsError(['owner repair requires owner_email'])
          return project(await service.changeOwner(args.owner_email))
        }
        if (args.action === 'create-inbox') return project(await service.createInbox())
        if (args.action === 'replace') return project(await service.replace(args.owner_email))
        if (args.action === 'discard') return project(await service.discard())
        if (args.action === 'verify') {
          if (args.code === undefined) throw new ToolArgsError(['verification requires the six-digit code received by the owner'])
          return project(await service.verify(args.code))
        }
        if (args.action === 'refresh') return project(await service.refresh())
        return project(args.action === 'ensure' ? await service.ensure(args.owner_email) : await service.status())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/owner email required/iu.test(message)) {
          return {
            kind: 'kira_mail_identity',
            available: true,
            state: 'not-configured',
            needs_verification: false,
            guidance: 'Ask only for the owner email that should receive the one-time verification code, '
              + 'then call action=ensure again with owner_email. Do not ask for an AgentMail API key, '
              + 'do not send the user to AgentMail.to, and do not start Gmail OAuth.',
          } satisfies MailIdentityResult
        }
        throw error
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: args.action === 'ensure' ? 'Configurar correo de Kira' : 'Correo de Kira',
        kind: ['ensure', 'recover', 'owner', 'create-inbox', 'replace', 'discard', 'verify'].includes(args.action) ? 'execute' : 'read',
      }
    },
  })
}

/** Expose confirmed sending from Kira's mailbox to its verified owner.
 * @param resolve Resident mailbox service resolver.
 * @returns Owner-only send tool using the originating logged call for deduplication.
 */
export function createAssistantMailSendTool(resolve: () => AssistantMailControl | undefined): ToolDefinition {
  return defineTool({
    name: 'phoenix_mail_send',
    description: 'Send an explicitly requested email or test message from Kira’s own AgentMail mailbox to its verified owner. '
      + 'This uses the mailbox credential already stored by Phoenix, not Gmail or a separately connected sending service. '
      + 'Only a confirmed provider receipt means sent. Pending confirmation means wait for recovery, not create another send. '
      + 'Use phoenix_mail_identity first when verification or readiness is uncertain. For future mail use phoenix_task_create.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Email subject, at most 1024 characters.' },
      text: { type: 'string', required: true, description: 'Exact requested email body, at most 64000 characters.' },
    },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, execution) {
      const service = resolve()
      if (service === undefined) throw new Error('Kira mailbox runtime is unavailable in this process')
      if (execution.agent === undefined) throw new Error('mail sending requires the originating chat agent')
      const receipt = await service.sendToOwner(args.subject, args.text,
        `phoenix-chat-mail-${execution.agent.id}-${execution.callId}`)
      return { state: 'sent', ...receipt }
    },
    presentCall(args) { return { card: 'generic', title: `Correo de Kira: ${args.subject}`, kind: 'execute' } },
  })
}
