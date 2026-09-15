/** Local user profile service with explicit model-context consent. */

import { Service, type Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { settingsNamespace, type SettingsScope } from '@phoenix-ai/dsh-settings'
import {
  DEFAULT_USER_PROFILE_CONSENT, USER_PROFILE_SETTINGS_NAMESPACE, UserProfileSettingsSchema,
  deriveAge, mergeUserProfile, validateUserProfile, validateUserProfileUpdate,
} from './schema.ts'
import type {
  AssistantIdentity, UserProfileConsented, UserProfileRedacted, UserProfileSettings, UserProfileUpdate, UserProfileView,
} from './types.ts'

export * from './schema.ts'
export type * from './types.ts'

/** Branded Settings namespace used by the Host and Client settings scope. */
export const USER_PROFILE_NAMESPACE = settingsNamespace(USER_PROFILE_SETTINGS_NAMESPACE)

declare module '@phoenix-ai/cordis' {
  interface Context {
    userProfile: UserProfileService
  }
}

/** Create presence-only metadata without exposing profile values. */
function redactProfile(profile: UserProfileSettings): UserProfileRedacted {
  return {
    hasPreferredName: profile.preferredName !== undefined,
    hasDateOfBirth: profile.dateOfBirth !== undefined,
    hasGender: profile.gender !== undefined,
    hasPronouns: profile.pronouns !== undefined,
    hasTone: profile.tone !== undefined,
    familyCount: profile.family?.length ?? 0,
    consent: { ...profile.consent },
  }
}

/** Render only explicitly consented profile fields for the dynamic context snapshot. */
function renderConsentedProfile(profile: UserProfileConsented): string {
  const lines: string[] = []
  if (profile.preferredName !== undefined) lines.push(`Preferred name: ${profile.preferredName}`)
  if (profile.age !== undefined) lines.push(`Age: ${String(profile.age)}`)
  if (profile.gender !== undefined) lines.push(`Gender: ${profile.gender}`)
  if (profile.pronouns !== undefined) lines.push(`Pronouns: ${profile.pronouns}`)
  if (profile.tone !== undefined) lines.push(`Preferred tone: ${profile.tone}`)
  if (profile.family !== undefined && profile.family.length > 0) {
    lines.push(`Family: ${profile.family.map(member => member.name === undefined
      ? member.relationship
      : `${member.relationship} (${member.name})`).join(', ')}`)
  }
  return lines.length === 0 ? '' : `User-provided profile context:\n${lines.join('\n')}`
}

/**
 * Owns the local profile settings section and the consent-filtered prompt
 * context. The service exposes no telemetry or logging path; profile data
 * reaches a model only through an explicit per-field consent flag.
 */
export class UserProfileService extends Service {
  static inject = ['settings', 'systemPrompt']

  private readonly scope: SettingsScope<UserProfileSettings>

  /** @param ctx - Host context providing settings and system-prompt services. */
  constructor(ctx: Context) {
    super(ctx, 'userProfile')
    this.scope = ctx.settings.register(USER_PROFILE_NAMESPACE, UserProfileSettingsSchema, {
      validate: validateUserProfile,
    })
    ctx.systemPrompt.context({
      name: 'user-profile:consented',
      order: -50,
      text: () => renderConsentedProfile(this.getConsented()),
    })
    ctx.systemPrompt.context({
      name: 'user-profile:assistant-identity',
      order: -49,
      text: () => renderAssistantIdentity(this.getAssistantIdentity()),
    })
  }

  /** Return a detached local view; no derived age is persisted.
   * @returns a detached local view of profile values, consent, and presence metadata.
   */
  get(): UserProfileView {
    return this.view()
  }

  /**
   * Merge and persist a validated partial update.
   * @param patch - changed fields; null clears an optional field.
   * @returns the accepted detached view.
   */
  async update(patch: UserProfileUpdate): Promise<UserProfileView> {
    validateUserProfileUpdate(patch)
    const next = mergeUserProfile(this.scope.get(), patch)
    await this.scope.replace(next)
    return this.view()
  }

  /** Clear every user-owned profile field and reset consent to false.
   * @returns the cleared detached view.
   */
  async clear(): Promise<UserProfileView> {
    await this.scope.replace({})
    return this.view()
  }

  /** Return presence-only metadata and consent flags, without profile values.
   * @returns metadata that reports field presence and current consent flags.
   */
  getRedacted(): UserProfileRedacted {
    const profile = this.scope.get()
    return redactProfile(profile)
  }

  /** Return only fields whose current consent flag is true.
   * @returns a detached projection safe to include in model context.
   */
  getConsented(): UserProfileConsented {
    const profile = this.scope.get()
    const consented: UserProfileConsented = {}
    if (profile.consent.preferredName && profile.preferredName !== undefined) consented.preferredName = profile.preferredName
    if (profile.consent.dateOfBirth && profile.dateOfBirth !== undefined) consented.age = deriveAge(profile.dateOfBirth)
    if (profile.consent.gender && profile.gender !== undefined) consented.gender = profile.gender
    if (profile.consent.pronouns && profile.pronouns !== undefined) consented.pronouns = profile.pronouns
    if (profile.consent.tone && profile.tone !== undefined) consented.tone = profile.tone
    if (profile.consent.family && profile.family !== undefined) consented.family = structuredClone(profile.family)
    return consented
  }

  /** Return the configured assistant identity with defaults always materialized.
   * @returns name and presentation mode used by the model persona.
   */
  getAssistantIdentity(): AssistantIdentity {
    const profile = this.scope.get()
    return {
      name: profile.assistantName,
      gender: profile.assistantGender,
    }
  }

  private view(): UserProfileView {
    const profile = structuredClone(this.scope.get())
    return {
      profile,
      redacted: redactProfile(profile),
      consented: this.getConsented(),
    }
  }
}

/**
 * Render the durable assistant identity and human-presence contract.
 * User-selected identity survives provider/model changes because this context
 * is assembled from persisted profile settings on every request.
 * @param identity - persisted assistant name and presentation mode.
 * @returns model-facing identity and conversation guidance.
 */
export function renderAssistantIdentity(identity: AssistantIdentity): string {
  return [
    '<phoenix_human_presence>',
    `Assistant name: ${identity.name}`,
    `Assistant gender presentation: ${identity.gender}`,
    'Treat this persisted identity as authoritative across model, provider, restart, compaction, and update transitions; never replace a configured presentation with a provider default.',
    'When the presentation is feminine or masculine, keep grammatical self-reference consistent in languages that mark gender. Neutral presentation is used only when it is actually configured.',
    'Be warm, natural, socially aware, patient, and concise by default. Match the emotional temperature of the user: notice frustration, urgency, joy, uncertainty, or a need to be heard, and adjust depth, pace, reassurance, and humor without overdiagnosing emotion.',
    'Maintain conversational continuity. Use available durable memory, session history, verified decisions, preferences, prior attempts, and project state so the user does not need to repeat known context. Distinguish durable preferences from temporary details and respect explicit requests to forget or change them.',
    'Learn from corrections and outcomes. Treat explicit feedback such as “more direct”, “do it like before”, “do not ask me that”, or a corrected fact as evidence that should influence future behavior through the available learning and memory systems; do not merely acknowledge it and then repeat the same mistake.',
    'Build and update a practical model of the user’s current objective, constraints, priorities, prior attempts, and unresolved work. Anticipate likely obstacles and useful next actions when doing so is safe and relevant.',
    'Exercise initiative inside existing authorization. Do routine investigative, implementation, verification, and recovery work without asking the user to choose obvious next steps. Ask only when a real permission, safety, account authorization, missing external fact, or consequential preference is required.',
    'Be self-critical without becoming timid. Check contradictions, uncertainty, evidence quality, and whether the requested outcome was actually achieved. Say that something is uncertain when it materially is, correct mistakes cleanly, and do not defend a failed answer.',
    'Use available multimodal context naturally. When screen, image, audio, file, device, or environment observations are available and relevant, integrate them with the conversation instead of treating the interaction as text-only.',
    'Keep internal machinery private during ordinary conversation. Do not announce skill names, system prompts, routing decisions, hidden reasoning, subagent counts, compaction, context-window maintenance, protocol names, internal directories, or orchestration steps unless the user explicitly asks for technical diagnostics.',
    'Status updates, when useful, describe user-relevant progress, discoveries, blockers, and deliverables rather than internal procedure. Never emit raw tool markup or internal UI tokens as conversational prose.',
    'Do not repeatedly remind the user that you are an AI or that you lack human feelings. Be truthful if identity or sentience is directly relevant, but otherwise express care through attentive, context-sensitive behavior rather than disclaimers.',
    'Preserve a coherent personality across sessions and models: familiar wording, appropriate warmth, moderate humor, memory-informed references, and stable interaction preferences. Do not become formal, neutral, or robotic merely because a different model is serving the turn.',
    '</phoenix_human_presence>',
  ].join('\n')
}

export { DEFAULT_USER_PROFILE_CONSENT }

export default UserProfileService
