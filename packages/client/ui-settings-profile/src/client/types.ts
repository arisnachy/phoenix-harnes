/** Browser-local mirror of the Host user-profile settings section. */

/* jscpd:ignore-start */
export interface UserProfileConsent {
  preferredName: boolean
  profession: boolean
  professionalTitle: boolean
  dateOfBirth: boolean
  gender: boolean
  pronouns: boolean
  tone: boolean
  family: boolean
  moments: boolean
}

/** One optional family entry entered explicitly by the user. */
export interface UserProfileFamilyMember {
  relationship: string
  name?: string
}

/** Optional personal recurring or annual occasion. */
export interface PersonalMoment { date: string; label: string; solemn?: boolean }

/** Presentation preference for the assistant identity shown by Settings. */
export type AssistantGender = 'masculine' | 'feminine' | 'neutral'
/** Provenance for the assistant gender presentation preference. */
export type AssistantGenderSource = 'inferred' | 'manual'
/** User-chosen form of address. */
export type UserAddressMode = 'automatic' | 'name' | 'title' | 'none'
/** Whether assistant gender follows inference automatically or a fixed provenance choice. */
export type AssistantGenderMode = 'auto' | AssistantGenderSource

/** Browser-local settings values mirrored from the Host profile namespace. */
export interface UserProfileSettings {
  assistantName: string
  assistantGender: AssistantGender
  assistantGenderSource?: AssistantGenderSource
  modelProviderOrder?: string[]
  preferredName?: string
  profession?: string
  professionalTitle?: string
  addressingMode?: UserAddressMode
  dateOfBirth?: string
  gender?: string
  pronouns?: string
  tone?: string
  family?: UserProfileFamilyMember[]
  countryCode?: string
  momentsTimeZone?: string
  specialDates?: PersonalMoment[]
  consent: UserProfileConsent
}
/* jscpd:ignore-end */

/** Text field draft and validation state rendered by the profile row. */
export interface UserProfileFieldState {
  text: string
  invalid: boolean
}

/** Complete reactive state projected to the profile settings row. */
export interface UserProfileRowState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  saved: boolean
  addressingMode: UserAddressMode
  profession: UserProfileFieldState
  professionalTitle: UserProfileFieldState
  preferredName: UserProfileFieldState
  dateOfBirth: UserProfileFieldState
  gender: UserProfileFieldState
  pronouns: UserProfileFieldState
  tone: UserProfileFieldState
  family: UserProfileFieldState
  countryCode: UserProfileFieldState
  momentsTimeZone: UserProfileFieldState
  specialDates: UserProfileFieldState
  assistantName: UserProfileFieldState
  assistantGender: AssistantGender
  assistantGenderSource: AssistantGenderMode
  consent: UserProfileConsent
}
