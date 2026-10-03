import {
  defineTool,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'
import type { AssistantMailControl, AssistantMailIdentity } from './assistant-mail-runtime.ts'

type MailIdentityResult = {
  kind: 'kira_mail_identity'
  available: boolean
  state: AssistantMailIdentity['state'] | 'unavailable'
  address?: string
  connection?: string
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
      needs_verification: false,
      guidance: 'Tell the user Kira\'s exact mailbox address. This is Kira\'s own AgentMail inbox, not Gmail.',
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
        + 'the six-digit owner verification in Settings. Do not create another mailbox.',
    }
  }
  if (value.state === 'signup-ambiguous') {
    return {
      kind: 'kira_mail_identity',
      available: true,
      state: value.state,
      connection: value.connection,
      needs_verification: false,
      guidance: 'The provider signup result is ambiguous. Do not retry signup automatically; '
        + 'use the existing-account recovery flow in Settings.',
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
      + 'never repeat signup after an ambiguous result.',
    parameters: {
      action: {
        type: 'string',
        enum: ['status', 'ensure'],
        required: true,
        description: 'status reads the current real mailbox; ensure creates it once if absent and then returns the real provider address.',
      },
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
        kind: args.action === 'ensure' ? 'execute' : 'read',
      }
    },
  })
}
