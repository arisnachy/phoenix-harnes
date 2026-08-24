/** Browser-local mirror of the Host user-profile settings section. */

export interface UserProfileConsent {
  preferredName: boolean
  dateOfBirth: boolean
  gender: boolean
  pronouns: boolean
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
  preferredName?: string
  dateOfBirth?: string
  gender?: string
  pronouns?: string
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
  preferredName: UserProfileFieldState
  dateOfBirth: UserProfileFieldState
  gender: UserProfileFieldState
  pronouns: UserProfileFieldState
  tone: UserProfileFieldState
  family: UserProfileFieldState
  consent: UserProfileConsent
}
