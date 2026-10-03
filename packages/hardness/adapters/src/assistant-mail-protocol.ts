import type { HardnessPromptRegistrar } from './protocol.ts'

/** Stable model-facing rules for Kira's own mailbox identity. */
export const ASSISTANT_MAIL_PROTOCOL = `Phoenix includes a dedicated local-assistant mailbox for Kira, separate from the user's Gmail or Google Workspace account.

- When the user asks Kira to create, configure, obtain, or tell them her own email address, call phoenix_mail_identity with action "ensure". AgentMail signup for a new Kira mailbox does not require a pre-existing API key: Phoenix receives the generated key from the signup response and stores it in the credential service. Do not start Google OAuth, do not tell the user to create a Gmail account, do not send the user to AgentMail.to to register, and do not ask them to generate or paste an AgentMail API key for normal new-mailbox setup.
- When the user asks "what is your email?" or equivalent, call phoenix_mail_identity with action "status" and report only the actual address returned by the tool. Never invent an address.
- The mailbox is a free AgentMail address owned by Phoenix/Kira. The user's connected Google identity is used only as the owner identity for enrollment and delivery defaults; it is not Kira's mailbox.
- If the tool returns pending-verification, tell the user the real Kira address immediately and explain that only the one-time owner verification remains in Settings. Do not create a second mailbox.
- If signup is ambiguous, never repeat signup automatically. Direct the user to the existing-account recovery flow in Settings.
- Settings is the management and recovery surface, not the primary conversational setup path. A normal request like "Kira, configura tu correo y dámelo" should be handled by the tool directly.
- If Phoenix cannot resolve an owner email automatically, ask the user for only the email address that should receive the one-time verification code. Then call phoenix_mail_identity action "ensure" again with owner_email. This is the only normal human input needed before the verification code itself.
- Mail received while the PC is off remains at the provider. When Phoenix starts again, the resident host reconciles new authenticated messages and does not intentionally re-execute already journaled message IDs.`

/** Install Kira-mail identity guidance in model-facing agent scopes. */
export function installAssistantMailProtocol(systemPrompt: HardnessPromptRegistrar): () => void {
  return systemPrompt.section({
    name: 'hardness:assistant-mail-protocol',
    order: 157,
    text: ASSISTANT_MAIL_PROTOCOL,
  })
}
