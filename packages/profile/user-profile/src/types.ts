/** Public data and projection types for the local user-profile service. */

/** Per-field permission to include profile data in model context. */
export interface UserProfileConsent {
  fullName: boolean
  preferredName: boolean
  dateOfBirth: boolean
  sex: boolean
  gender: boolean
  pronouns: boolean
  formOfAddress: boolean
  profession: boolean
  locale: boolean
  timezone: boolean
  responsePreferences: boolean
  tone: boolean
  family: boolean
}

/** One optional family entry supplied explicitly by the user. */
export interface UserProfileFamilyMember {
  relationship: string
  name?: string
}

/** Data persisted by the profile namespace. Age is intentionally absent. */
export interface UserProfileSettings {
  /** Global kill switch; field consent remains preserved while personalization is off. */
  personalizationEnabled: boolean
  fullName?: string
  preferredName?: string
  dateOfBirth?: string
  /** Biological/administrative sex entered explicitly by the user. Never inferred. */
  sex?: string
  /** Optional gender identity, deliberately separate from sex and pronouns. */
  gender?: string
  pronouns?: string
  /** How the assistant should address the user, independent of name/pronouns. */
  formOfAddress?: string
  profession?: string
  locale?: string
  timezone?: string
  responsePreferences?: string
  tone?: string
  family?: UserProfileFamilyMember[]
  consent: UserProfileConsent
}

/** Partial write; null clears one optional field. */
export interface UserProfileUpdate {
  personalizationEnabled?: boolean
  fullName?: string | null
  preferredName?: string | null
  dateOfBirth?: string | null
  sex?: string | null
  gender?: string | null
  pronouns?: string | null
  formOfAddress?: string | null
  profession?: string | null
  locale?: string | null
  timezone?: string | null
  responsePreferences?: string | null
  tone?: string | null
  family?: UserProfileFamilyMember[] | null
  consent?: Partial<UserProfileConsent>
}

/** Presence-only projection safe for diagnostics and settings directories. */
export interface UserProfileRedacted {
  personalizationEnabled: boolean
  hasFullName: boolean
  hasPreferredName: boolean
  hasDateOfBirth: boolean
  hasSex: boolean
  hasGender: boolean
  hasPronouns: boolean
  hasFormOfAddress: boolean
  hasProfession: boolean
  hasLocale: boolean
  hasTimezone: boolean
  hasResponsePreferences: boolean
  hasTone: boolean
  familyCount: number
  consent: UserProfileConsent
}

/** Only explicitly consented values, suitable for model context. */
export interface UserProfileConsented {
  fullName?: string
  preferredName?: string
  age?: number
  sex?: string
  gender?: string
  pronouns?: string
  formOfAddress?: string
  profession?: string
  locale?: string
  timezone?: string
  responsePreferences?: string
  tone?: string
  family?: UserProfileFamilyMember[]
}

/** Complete local view returned by the service API. */
export interface UserProfileView {
  profile: UserProfileSettings
  redacted: UserProfileRedacted
  consented: UserProfileConsented
}
