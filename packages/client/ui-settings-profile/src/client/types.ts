/** Browser-local mirror of the Host user-profile settings section. */

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

/** One optional family entry entered explicitly by the user. */
export interface UserProfileFamilyMember {
  relationship: string
  name?: string
}

/** Browser-local settings values mirrored from the Host profile namespace. */
export interface UserProfileSettings {
  personalizationEnabled: boolean
  fullName?: string
  preferredName?: string
  dateOfBirth?: string
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
  consent: UserProfileConsent
}

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
  personalizationEnabled: boolean
  fullName: UserProfileFieldState
  preferredName: UserProfileFieldState
  dateOfBirth: UserProfileFieldState
  sex: UserProfileFieldState
  gender: UserProfileFieldState
  pronouns: UserProfileFieldState
  formOfAddress: UserProfileFieldState
  profession: UserProfileFieldState
  locale: UserProfileFieldState
  timezone: UserProfileFieldState
  responsePreferences: UserProfileFieldState
  tone: UserProfileFieldState
  family: UserProfileFieldState
  consent: UserProfileConsent
}
