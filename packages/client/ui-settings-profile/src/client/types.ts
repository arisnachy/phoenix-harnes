/** Browser-local mirror of the Host user-profile settings section. */

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

/** One optional family entry entered explicitly by the user. */
export interface UserProfileFamilyMember {
  relationship: string
  name?: string
}

/** Browser-local settings values mirrored from the Host profile namespace. */
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
  fullName: UserProfileFieldState
  preferredName: UserProfileFieldState
  dateOfBirth: UserProfileFieldState
  gender: UserProfileFieldState
  pronouns: UserProfileFieldState
  profession: UserProfileFieldState
  organization: UserProfileFieldState
  academicBackground: UserProfileFieldState
  country: UserProfileFieldState
  preferredLanguage: UserProfileFieldState
  timezone: UserProfileFieldState
  technicalLevel: UserProfileFieldState
  responsePreferences: UserProfileFieldState
  tone: UserProfileFieldState
  family: UserProfileFieldState
  consent: UserProfileConsent
}
