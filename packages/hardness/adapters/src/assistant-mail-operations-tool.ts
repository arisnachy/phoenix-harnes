import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import type { AssistantMailControl } from './assistant-mail-runtime.ts'

const ACTIONS = [
  'list_messages', 'search_messages', 'get_message', 'get_message_raw', 'get_message_attachment',
  'update_message_labels', 'batch_update_message_labels', 'send_message', 'reply_message', 'reply_all',
  'forward_message', 'delete_message',
  'list_threads', 'search_threads', 'get_thread', 'get_thread_attachment', 'update_thread_labels', 'delete_thread',
  'list_drafts', 'get_draft', 'get_draft_attachment', 'create_draft', 'update_draft', 'send_draft', 'delete_draft',
  'list_inboxes', 'search_inboxes', 'get_inbox', 'create_inbox', 'update_inbox', 'delete_inbox',
] as const

const WRITES = new Set<string>([
  'update_message_labels', 'batch_update_message_labels', 'send_message', 'reply_message', 'reply_all',
  'forward_message', 'delete_message', 'update_thread_labels', 'delete_thread',
  'create_draft', 'update_draft', 'send_draft', 'delete_draft',
  'create_inbox', 'update_inbox', 'delete_inbox',
])

/**
 * Expose Kira's real AgentMail mailbox capabilities without exposing the stored credential.
 * The resident host remains the authority for recipient allowlists, destructive confirmations,
 * idempotency and the primary inbox identity.
 * @param resolve Late-bound resident mailbox service resolver.
 * @returns Model-facing AgentMail tool definition.
 */
export function createAssistantMailOperationsTool(
  resolve: () => AssistantMailControl | undefined,
): ToolDefinition {
  return defineTool({
    name: 'phoenix_agentmail',
    description: 'Operate Kira/Phoenix\'s real AgentMail mailbox using the credential already stored by Phoenix. '
      + 'Use this for real email work: list/search/read messages and threads, read attachment metadata/download URLs, '
      + 'send/reply/reply-all/forward, manage labels, use drafts (including scheduled drafts), and manage inboxes. '
      + 'Do not claim AgentMail is unavailable before calling this tool. Normal mailbox-scoped actions default to '
      + 'Kira\'s primary inbox. Sending is restricted to the owner and explicitly authorized contacts. Inbox '
      + 'create/update/delete requires confirm_inbox_admin=true from an explicit owner request. Permanent '
      + 'deletions require confirm_permanent=true and deleting Kira\'s primary inbox additionally requires '
      + 'confirm_primary_inbox=true; set those flags only after an explicit user request.',
    parameters: {
      action: { type: 'string', enum: [...ACTIONS], required: true },
      inbox_id: { type: 'string', description: 'Optional target inbox. Omit for Kira\'s primary inbox.' },
      message_id: { type: 'string' },
      message_ids: { type: 'array', items: { type: 'string' } },
      thread_id: { type: 'string' },
      draft_id: { type: 'string' },
      attachment_id: { type: 'string' },
      q: { type: 'string' },
      limit: { type: 'number' },
      page_token: { type: 'string' },
      before: { type: 'string' },
      after: { type: 'string' },
      ascending: { type: 'boolean' },
      labels: { type: 'array', items: { type: 'string' } },
      add_labels: { type: 'array', items: { type: 'string' } },
      remove_labels: { type: 'array', items: { type: 'string' } },
      from: { type: 'array', items: { type: 'string' } },
      to_filter: { type: 'array', items: { type: 'string' } },
      senders: { type: 'array', items: { type: 'string' } },
      recipients: { type: 'array', items: { type: 'string' } },
      subject_filter: { type: 'array', items: { type: 'string' } },
      to: { type: 'array', items: { type: 'string' } },
      cc: { type: 'array', items: { type: 'string' } },
      bcc: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      text: { type: 'string' },
      html: { type: 'string' },
      track_opens: { type: 'boolean' },
      idempotency_key: { type: 'string' },
      client_id: { type: 'string' },
      in_reply_to: { type: 'string' },
      forward_of: { type: 'string' },
      reply_all: { type: 'boolean' },
      send_at: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      username: { type: 'string' },
      domain: { type: 'string' },
      display_name: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      status: { type: 'string', enum: ['active', 'paused'] },
      confirm_inbox_admin: { type: 'boolean' },
      confirm_permanent: { type: 'boolean' },
      confirm_primary_inbox: { type: 'boolean' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, execution) {
      const service = resolve()
      if (service === undefined) throw new Error('Kira AgentMail runtime is unavailable in this Phoenix process')
      const operation = args.action as string
      const idempotent = operation === 'send_message' || operation === 'reply_message'
        || operation === 'reply_all' || operation === 'forward_message' || operation === 'send_draft'
      const createsResource = operation === 'create_draft' || operation === 'create_inbox'
      const input = {
        ...args,
        ...(idempotent && args.idempotency_key === undefined
          ? { idempotency_key: `phoenix-agentmail-${execution.callId}` }
          : {}),
        ...(createsResource && args.client_id === undefined
          ? { client_id: `phoenix-agentmail-${execution.callId}` }
          : {}),
      } as Record<string, unknown>
      const result = await service.operate(operation, input) as JsonValue
      return { kind: 'kira_agentmail', action: operation, result }
    },
    presentCall(args) {
      const action = args.action as string
      return {
        card: 'generic',
        title: `Kira mail · ${action.replaceAll('_', ' ')}`,
        kind: WRITES.has(action) ? 'edit' : 'read',
        rawInput: action,
      }
    },
  })
}
