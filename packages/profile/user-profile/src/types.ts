/** Public data and projection types for the local user-profile service. */

/** Per-field permission to include profile data in model context. */
export interface UserProfileConsent {
  preferredName: boolean
  dateOfBirth: boolean
  gender: boolean
  pronouns: boolean
  tone: boolean
  family: boolean
}

/** One optional family entry supplied explicitly by the user. */
export interface UserProfileFamilyMember {
  relationship: string
  name?: string
}

/** Data persisted by the profile namespace. Age is intentionally absent. */
export type AssistantGender = 'masculine' | 'feminine' | 'neutral'

/** Data persisted by the profile namespace. Age is intentionally absent. */
export interface UserProfileSettings {
  assistantName: string
  assistantGender: AssistantGender
  /** Provider route order shown by model selectors; absent means directory order. */
  modelProviderOrder?: string[]
  preferredName?: string
  dateOfBirth?: string
  gender?: string
  pronouns?: string
  tone?: string
  family?: UserProfileFamilyMember[]
  consent: UserProfileConsent
}

/** Partial write; null clears one optional field. */
export interface UserProfileUpdate {
  assistantName?: string | null
  assistantGender?: AssistantGender | null
  modelProviderOrder?: string[] | null
  preferredName?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  pronouns?: string | null
  tone?: string | null
  family?: UserProfileFamilyMember[] | null
  consent?: Partial<UserProfileConsent>
}

/** Presence-only projection safe for diagnostics and settings directories. */
export interface UserProfileRedacted {
  hasPreferredName: boolean
  hasDateOfBirth: boolean
  hasGender: boolean
  hasPronouns: boolean
  hasTone: boolean
  familyCount: number
  consent: UserProfileConsent
}

/** Only explicitly consented values, suitable for model context. */
export interface UserProfileConsented {
  preferredName?: string
  age?: number
  gender?: string
  pronouns?: string
  tone?: string
  family?: UserProfileFamilyMember[]
}

/** Complete local view returned by the service API. */
export interface UserProfileView {
  profile: UserProfileSettings
  redacted: UserProfileRedacted
  consented: UserProfileConsented
}

/** Stable identity facts used by the system prompt, not user-consented profile data. */
export interface AssistantIdentity {
  name: string
  gender: AssistantGender
}
