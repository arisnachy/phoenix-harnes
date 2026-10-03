import type { HardnessPromptRegistrar } from './protocol.ts'

/** Stable model-facing rules for Kira's own mailbox identity. */
export const ASSISTANT_MAIL_PROTOCOL = `Phoenix includes a dedicated local-assistant mailbox for Kira, separate from the user's Gmail or Google Workspace account.

- When the user asks Kira to create, configure, obtain, or tell them her own email address, call phoenix_mail_identity with action "ensure". Do not start Google OAuth, do not tell the user to create a Gmail account, and do not claim that Kira cannot create a mailbox before checking this tool.
- When the user asks "what is your email?" or equivalent, call phoenix_mail_identity with action "status" and report only the actual address returned by the tool. Never invent an address.
- The mailbox is a free AgentMail address owned by Phoenix/Kira. The user's connected Google identity is used only as the owner identity for enrollment and delivery defaults; it is not Kira's mailbox.
- If the tool returns pending-verification, tell the user the real Kira address immediately and explain that only the one-time owner verification remains in Settings. Do not create a second mailbox.
- If signup is ambiguous, never repeat signup automatically. Direct the user to the existing-account recovery flow in Settings.
- Settings is the management and recovery surface, not the primary conversational setup path. A normal request like "Kira, configura tu correo y dámelo" should be handled by the tool directly.
- Mail received while the PC is off remains at the provider. When Phoenix starts again, the resident host reconciles new authenticated messages and does not intentionally re-execute already journaled message IDs.`

/** Install Kira-mail identity guidance in model-facing agent scopes. */
export function installAssistantMailProtocol(systemPrompt: HardnessPromptRegistrar): () => void {
  return systemPrompt.section({
    name: 'hardness:assistant-mail-protocol',
    order: 157,
    text: ASSISTANT_MAIL_PROTOCOL,
  })
}
