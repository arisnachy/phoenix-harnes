/** Validation and projection helpers for the private user-profile namespace. */

import z from '@deepseek-ai/schemastery'
import type { UserProfileConsent, UserProfileFamilyMember, UserProfileSettings, UserProfileUpdate } from './types.ts'

/** Settings namespace stored in the Harness-home settings document. */
export const USER_PROFILE_SETTINGS_NAMESPACE = 'user-profile' as const

/** Default policy: no profile field is model-visible without an explicit opt-in. */
export const DEFAULT_USER_PROFILE_CONSENT: UserProfileConsent = Object.freeze({
  preferredName: false,
  dateOfBirth: false,
  gender: false,
  pronouns: false,
  tone: false,
  family: false,
})

/** Hard limits for locally stored profile data. */
export const USER_PROFILE_LIMITS = Object.freeze({
  textCharacters: 120,
  familyMembers: 20,
  maximumAge: 130,
})

/** Schemastery schema used by the settings provider and browser decoder. */
export const UserProfileSettingsSchema: z<UserProfileSettings> = z.object({
  preferredName: z.string().required(false),
  dateOfBirth: z.string().required(false),
  gender: z.string().required(false),
  pronouns: z.string().required(false),
  tone: z.string().required(false),
  family: z.array(z.object({
    relationship: z.string(),
    name: z.string().required(false),
  })).required(false),
  consent: z.object({
    preferredName: z.boolean().default(false),
    dateOfBirth: z.boolean().default(false),
    gender: z.boolean().default(false),
    pronouns: z.boolean().default(false),
    tone: z.boolean().default(false),
    family: z.boolean().default(false),
  }).default(DEFAULT_USER_PROFILE_CONSENT),
})

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PROFILE_TEXT_FIELDS = ['preferredName', 'gender', 'pronouns', 'tone'] as const
const PROFILE_UPDATE_FIELDS = [...PROFILE_TEXT_FIELDS, 'dateOfBirth', 'family'] as const
const CONSENT_FIELDS = ['preferredName', 'dateOfBirth', 'gender', 'pronouns', 'tone', 'family'] as const

/** Validate cross-field and bounded profile constraints.
 * @param profile - complete profile settings to validate.
 */
export function validateUserProfile(profile: UserProfileSettings): void {
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = profile[field]
    if (value !== undefined) validateText(value, field)
  }
  if (profile.dateOfBirth !== undefined) validateDateOfBirth(profile.dateOfBirth)
  if (profile.family !== undefined) {
    if (profile.family.length > USER_PROFILE_LIMITS.familyMembers) {
      throw new TypeError(`user profile family accepts at most ${String(USER_PROFILE_LIMITS.familyMembers)} members`)
    }
    for (const [index, member] of profile.family.entries()) validateFamilyMember(member, index)
  }
  validateConsent(profile.consent)
}

/** Validate an update before it reaches the settings write queue.
 * @param patch - unknown input received at the settings write boundary.
 * @returns nothing when the input is a valid {@link UserProfileUpdate}; throws otherwise.
 */
export function validateUserProfileUpdate(patch: unknown): asserts patch is UserProfileUpdate {
  if (!isPlainObject(patch)) throw new TypeError('user profile update must be a plain object')
  for (const field of PROFILE_UPDATE_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (value !== null && value !== undefined && field !== 'family' && typeof value !== 'string') {
      throw new TypeError(`user profile update field "${field}" must be a string or null`)
    }
    if (field === 'family' && value !== null && value !== undefined && !Array.isArray(value)) {
      throw new TypeError('user profile update field "family" must be an array or null')
    }
  }
  if (Object.hasOwn(patch, 'consent')) validateConsentPatch(patch.consent)
}

/** Apply a validated partial update without mutating the stored snapshot.
 * @param current - stored profile settings.
 * @param patch - validated partial update to merge.
 * @returns a validated detached profile snapshot.
 */
export function mergeUserProfile(current: UserProfileSettings, patch: UserProfileUpdate): UserProfileSettings {
  const next: UserProfileSettings = structuredClone(current)
  for (const field of PROFILE_UPDATE_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (value === null) clearProfileField(next, field)
    else if (value !== undefined) next[field] = structuredClone(value) as never
  }
  if (patch.consent !== undefined) next.consent = { ...next.consent, ...patch.consent }
  validateUserProfile(next)
  return next
}

function clearProfileField(profile: UserProfileSettings, field: typeof PROFILE_UPDATE_FIELDS[number]): void {
  switch (field) {
    case 'preferredName': delete profile.preferredName; break
    case 'dateOfBirth': delete profile.dateOfBirth; break
    case 'gender': delete profile.gender; break
    case 'pronouns': delete profile.pronouns; break
    case 'tone': delete profile.tone; break
    case 'family': delete profile.family; break
  }
}

/** Derive current age from a stored calendar date; the age is never persisted.
 * @param dateOfBirth - calendar date in `YYYY-MM-DD` form.
 * @param now - UTC reference instant used for the calculation.
 * @returns the whole-number age at the reference instant.
 */
export function deriveAge(dateOfBirth: string, now = new Date()): number {
  validateDateOfBirth(dateOfBirth, now)
  const [year, month, day] = dateOfBirth.split('-').map(Number) as [number, number, number]
  let age = now.getUTCFullYear() - year
  const birthdayPassed = now.getUTCMonth() + 1 > month
    || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day)
  if (!birthdayPassed) age -= 1
  return age
}

/** Validate the stored date and its age against the current UTC date.
 * @param value - calendar date in `YYYY-MM-DD` form.
 * @param now - UTC reference instant used for age and future-date checks.
 */
export function validateDateOfBirth(value: string, now = new Date()): void {
  if (!DATE_PATTERN.test(value)) throw new TypeError('user profile dateOfBirth must use YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError('user profile dateOfBirth is not a real calendar date')
  }
  if (date.getTime() > now.getTime()) throw new TypeError('user profile dateOfBirth cannot be in the future')
  if (deriveAgeUnchecked(value, now) > USER_PROFILE_LIMITS.maximumAge) {
    throw new TypeError(`user profile dateOfBirth exceeds age limit ${String(USER_PROFILE_LIMITS.maximumAge)}`)
  }
}

function deriveAgeUnchecked(value: string, now: Date): number {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  let age = now.getUTCFullYear() - year
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1
  return age
}

function validateText(value: string, field: string): void {
  if (value.trim() === '') throw new TypeError(`user profile ${field} cannot be empty`)
  if (value.length > USER_PROFILE_LIMITS.textCharacters) {
    throw new TypeError(`user profile ${field} exceeds ${String(USER_PROFILE_LIMITS.textCharacters)} characters`)
  }
  for (const character of value) {
    if (character.charCodeAt(0) < 0x20 || character === '\u007f') {
      throw new TypeError(`user profile ${field} contains a control character`)
    }
  }
}

function validateFamilyMember(member: UserProfileFamilyMember, index: number): void {
  validateText(member.relationship, `family[${String(index)}].relationship`)
  if (member.name !== undefined) validateText(member.name, `family[${String(index)}].name`)
}

function validateConsent(value: UserProfileConsent): void {
  if (!isPlainObject(value)) throw new TypeError('user profile consent must be an object')
  for (const field of CONSENT_FIELDS) {
    if (typeof value[field] !== 'boolean') throw new TypeError(`user profile consent.${field} must be boolean`)
  }
}

function validateConsentPatch(value: unknown): void {
  if (!isPlainObject(value)) throw new TypeError('user profile update consent must be an object')
  for (const [field, entry] of Object.entries(value)) {
    if (!(CONSENT_FIELDS as readonly string[]).includes(field)) throw new TypeError(`unknown user profile consent field "${field}"`)
    if (typeof entry !== 'boolean') throw new TypeError(`user profile consent.${field} must be boolean`)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}
