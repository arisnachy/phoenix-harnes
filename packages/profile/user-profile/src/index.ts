/** Local user profile service with explicit model-context consent. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_USER_PROFILE_CONSENT, USER_PROFILE_SETTINGS_NAMESPACE, UserProfileSettingsSchema,
  deriveAge, mergeUserProfile, validateUserProfile, validateUserProfileUpdate,
} from './schema.ts'
import type {
  UserProfileConsented, UserProfileRedacted, UserProfileSettings, UserProfileUpdate, UserProfileView,
} from './types.ts'

export * from './schema.ts'
export type * from './types.ts'

/** Branded Settings namespace used by the Host and Client settings scope. */
export const USER_PROFILE_NAMESPACE = settingsNamespace(USER_PROFILE_SETTINGS_NAMESPACE)

declare module '@deepseek-ai/cordis' {
  interface Context {
    userProfile: UserProfileService
  }
}

/** Render only explicitly consented profile fields for the dynamic context snapshot. */
function renderConsentedProfile(profile: UserProfileConsented): string {
  const lines: string[] = []
  if (profile.fullName !== undefined) lines.push(`Full name: ${profile.fullName}`)
  if (profile.preferredName !== undefined) lines.push(`Preferred name: ${profile.preferredName}`)
  if (profile.age !== undefined) lines.push(`Age: ${String(profile.age)}`)
  if (profile.gender !== undefined) lines.push(`Gender: ${profile.gender}`)
  if (profile.pronouns !== undefined) lines.push(`Pronouns: ${profile.pronouns}`)
  if (profile.profession !== undefined) lines.push(`Profession / role: ${profile.profession}`)
  if (profile.organization !== undefined) lines.push(`Organization: ${profile.organization}`)
  if (profile.academicBackground !== undefined) lines.push(`Academic background: ${profile.academicBackground}`)
  if (profile.country !== undefined) lines.push(`Country: ${profile.country}`)
  if (profile.preferredLanguage !== undefined) lines.push(`Preferred language: ${profile.preferredLanguage}`)
  if (profile.timezone !== undefined) lines.push(`Timezone: ${profile.timezone}`)
  if (profile.technicalLevel !== undefined) lines.push(`Technical level: ${profile.technicalLevel}`)
  if (profile.responsePreferences !== undefined) lines.push(`Response preferences: ${profile.responsePreferences}`)
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
    return this.redacted(this.scope.get())
  }

  /** Return only fields whose current consent flag is true.
   * @returns a detached projection safe to include in model context.
   */
  getConsented(): UserProfileConsented {
    const profile = this.scope.get()
    const consented: UserProfileConsented = {}
    if (profile.consent.fullName && profile.fullName !== undefined) consented.fullName = profile.fullName
    if (profile.consent.preferredName && profile.preferredName !== undefined) consented.preferredName = profile.preferredName
    if (profile.consent.dateOfBirth && profile.dateOfBirth !== undefined) consented.age = deriveAge(profile.dateOfBirth)
    if (profile.consent.gender && profile.gender !== undefined) consented.gender = profile.gender
    if (profile.consent.pronouns && profile.pronouns !== undefined) consented.pronouns = profile.pronouns
    if (profile.consent.profession && profile.profession !== undefined) consented.profession = profile.profession
    if (profile.consent.organization && profile.organization !== undefined) consented.organization = profile.organization
    if (profile.consent.academicBackground && profile.academicBackground !== undefined) consented.academicBackground = profile.academicBackground
    if (profile.consent.country && profile.country !== undefined) consented.country = profile.country
    if (profile.consent.preferredLanguage && profile.preferredLanguage !== undefined) consented.preferredLanguage = profile.preferredLanguage
    if (profile.consent.timezone && profile.timezone !== undefined) consented.timezone = profile.timezone
    if (profile.consent.technicalLevel && profile.technicalLevel !== undefined) consented.technicalLevel = profile.technicalLevel
    if (profile.consent.responsePreferences && profile.responsePreferences !== undefined) consented.responsePreferences = profile.responsePreferences
    if (profile.consent.tone && profile.tone !== undefined) consented.tone = profile.tone
    if (profile.consent.family && profile.family !== undefined) consented.family = structuredClone(profile.family)
    return consented
  }

  private redacted(profile: UserProfileSettings): UserProfileRedacted {
    return {
      hasFullName: profile.fullName !== undefined,
      hasPreferredName: profile.preferredName !== undefined,
      hasDateOfBirth: profile.dateOfBirth !== undefined,
      hasGender: profile.gender !== undefined,
      hasPronouns: profile.pronouns !== undefined,
      hasProfession: profile.profession !== undefined,
      hasOrganization: profile.organization !== undefined,
      hasAcademicBackground: profile.academicBackground !== undefined,
      hasCountry: profile.country !== undefined,
      hasPreferredLanguage: profile.preferredLanguage !== undefined,
      hasTimezone: profile.timezone !== undefined,
      hasTechnicalLevel: profile.technicalLevel !== undefined,
      hasResponsePreferences: profile.responsePreferences !== undefined,
      hasTone: profile.tone !== undefined,
      familyCount: profile.family?.length ?? 0,
      consent: { ...profile.consent },
    }
  }

  private view(): UserProfileView {
    const profile = structuredClone(this.scope.get())
    return {
      profile,
      redacted: this.redacted(profile),
      consented: this.getConsented(),
    }
  }
}

export { DEFAULT_USER_PROFILE_CONSENT }

export default UserProfileService
