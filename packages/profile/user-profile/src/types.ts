/** Public data and projection types for the local user-profile service. */

/** Per-field permission to include profile data in model context. */
export interface UserProfileConsent {
  fullName: boolean
  preferredName: boolean
  dateOfBirth: boolean
  gender: boolean
  pronouns: boolean
  profession: boolean
  organization: boolean
  academicBackground: boolean
  country: boolean
  preferredLanguage: boolean
  timezone: boolean
  technicalLevel: boolean
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
  fullName?: string
  preferredName?: string
  dateOfBirth?: string
  gender?: string
  pronouns?: string
  profession?: string
  organization?: string
  academicBackground?: string
  country?: string
  preferredLanguage?: string
  timezone?: string
  technicalLevel?: string
  responsePreferences?: string
  tone?: string
  family?: UserProfileFamilyMember[]
  consent: UserProfileConsent
}

/** Partial write; null clears one optional field. */
export interface UserProfileUpdate {
  fullName?: string | null
  preferredName?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  pronouns?: string | null
  profession?: string | null
  organization?: string | null
  academicBackground?: string | null
  country?: string | null
  preferredLanguage?: string | null
  timezone?: string | null
  technicalLevel?: string | null
  responsePreferences?: string | null
  tone?: string | null
  family?: UserProfileFamilyMember[] | null
  consent?: Partial<UserProfileConsent>
}

/** Presence-only projection safe for diagnostics and settings directories. */
export interface UserProfileRedacted {
  hasFullName: boolean
  hasPreferredName: boolean
  hasDateOfBirth: boolean
  hasGender: boolean
  hasPronouns: boolean
  hasProfession: boolean
  hasOrganization: boolean
  hasAcademicBackground: boolean
  hasCountry: boolean
  hasPreferredLanguage: boolean
  hasTimezone: boolean
  hasTechnicalLevel: boolean
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
  gender?: string
  pronouns?: string
  profession?: string
  organization?: string
  academicBackground?: string
  country?: string
  preferredLanguage?: string
  timezone?: string
  technicalLevel?: string
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
