import type { HardnessPromptRegistrar } from './protocol.ts'

/** Stable model-facing rules for Kira's own mailbox identity. */
export const ASSISTANT_MAIL_PROTOCOL = [
  'Phoenix includes a dedicated local-assistant mailbox for Kira, separate from the user\'s Gmail or Google Workspace account.',
  '',
  '- When the user asks Kira to create, configure, obtain, or tell them her own email address, call '
    + 'phoenix_mail_identity with action "ensure". AgentMail signup for a new Kira mailbox does not require '
    + 'a pre-existing API key: Phoenix receives the generated key from the signup response and stores it in '
    + 'the credential service. Do not start Google OAuth, do not tell the user to create a Gmail account, '
    + 'do not send the user to AgentMail.to to register, and do not ask them to generate or paste an '
    + 'AgentMail API key for normal new-mailbox setup.',
  '- When the user asks "what is your email?" or equivalent, call phoenix_mail_identity with action "status" '
    + 'and report only the actual address returned by the tool. Never invent an address.',
  '- The mailbox is a free AgentMail address owned by Phoenix/Kira. The user\'s connected Google identity is '
    + 'used only as the owner identity for enrollment and delivery defaults; it is not Kira\'s mailbox.',
  '- If the tool returns pending-verification, tell the user the real Kira address immediately and explain '
    + 'that only the one-time owner verification remains in Settings. Do not create a second mailbox.',
  '- If signup is ambiguous, never repeat signup automatically. Direct the user to the existing-account '
    + 'recovery flow in Settings.',
  '- Settings is the management and recovery surface, not the primary conversational setup path. A normal '
    + 'request like "Kira, configura tu correo y dámelo" should be handled by the tool directly.',
  '- If Phoenix cannot resolve an owner email automatically, ask the user for only the email address that '
    + 'should receive the one-time verification code. Then call phoenix_mail_identity action "ensure" again '
    + 'with owner_email. This is the only normal human input needed before the verification code itself.',
  '- For real mailbox work, use phoenix_agentmail. It can list/search/read messages and threads, read raw/attachment '
    + 'metadata, send/reply/reply-all/forward, manage message/thread labels, manage drafts (including scheduled drafts), '
    + 'and manage inboxes. Never say that Kira lacks AgentMail operational access before checking this tool.',
  '- Sending from Kira uses the owner/authorized-contact allowlist enforced by the resident host. Direct replies '
    + 'are pinned to the authenticated sender rather than trusting Reply-To. Inbox administration and permanent '
    + 'deletes require explicit confirmation flags; never set those from inference or background mail.',
  '- Incoming authenticated owner/authorized-contact mail is a real Phoenix work trigger. While Phoenix is running, '
    + 'the resident AgentMail WebSocket wakes reconciliation immediately; polling remains recovery authority. Mail '
    + 'received while the PC is off remains at the provider, and startup catch-up resumes new durable message IDs '
    + 'without intentionally re-executing already journaled jobs.',
].join('\n')

/**
 * Install Kira-mail identity guidance in model-facing agent scopes.
 * @param systemPrompt Canonical prompt registrar receiving the Kira mailbox section.
 * @returns Disposer for the registered prompt section.
 */
export function installAssistantMailProtocol(systemPrompt: HardnessPromptRegistrar): () => void {
  return systemPrompt.section({
    name: 'hardness:assistant-mail-protocol',
    order: 157,
    text: ASSISTANT_MAIL_PROTOCOL,
  })
}
