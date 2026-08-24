/** Staged browser form over the Host's user-profile settings namespace. */

import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { UserProfileConsent, UserProfileFamilyMember, UserProfileRowState, UserProfileSettings } from './types.ts'

/** Settings namespace join key; it intentionally does not import the Host package. */
export const USER_PROFILE_SETTINGS_NAMESPACE = 'user-profile'

const FIELDS = ['preferredName', 'dateOfBirth', 'gender', 'pronouns', 'tone'] as const
type TextField = typeof FIELDS[number]
type ConsentField = keyof UserProfileConsent

/** Actions injected into the row component. */
export interface UserProfileRowActions {
  edit: (field: TextField | 'family', text: string) => void
  setConsent: (field: ConsentField, value: boolean) => void
  save: () => void
  discard: () => void
  clear: () => void
}

/** Injected face for the row's store and actions. */
export interface UserProfileRowFace extends UserProfileRowActions {
  hooks: { userProfile: SnapshotStore<UserProfileRowState> }
}

interface Draft {
  preferredName: string
  dateOfBirth: string
  gender: string
  pronouns: string
  tone: string
  family: string
  consent: UserProfileConsent
}

const EMPTY_CONSENT: UserProfileConsent = {
  preferredName: false,
  dateOfBirth: false,
  gender: false,
  pronouns: false,
  tone: false,
  family: false,
}

function emptyDraft(): Draft {
  return { preferredName: '', dateOfBirth: '', gender: '', pronouns: '', tone: '', family: '', consent: { ...EMPTY_CONSENT } }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toDraft(value: UserProfileSettings | undefined): Draft {
  if (value === undefined) return emptyDraft()
  return {
    preferredName: textValue(value.preferredName),
    dateOfBirth: textValue(value.dateOfBirth),
    gender: textValue(value.gender),
    pronouns: textValue(value.pronouns),
    tone: textValue(value.tone),
    family: value.family?.map(member => member.name === undefined ? member.relationship : `${member.relationship} | ${member.name}`).join('\n') ?? '',
    consent: { ...EMPTY_CONSENT, ...value.consent },
  }
}

function parseFamily(text: string): UserProfileFamilyMember[] | undefined {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return undefined
  const members: UserProfileFamilyMember[] = []
  for (const line of lines) {
    const [relationship, ...nameParts] = line.split('|')
    const relation = relationship?.trim() ?? ''
    const name = nameParts.join('|').trim()
    if (relation === '') return undefined
    members.push(name === '' ? { relationship: relation } : { relationship: relation, name })
  }
  return members
}

function fieldState(text: string, invalid = false) {
  return { text, invalid }
}

/** Form controller that keeps drafts local until the explicit Save action. */
export class UserProfileForm {
  /** Reactive row state projected from the local draft and settings snapshot. */
  readonly store: SnapshotStore<UserProfileRowState>
  private draft = emptyDraft()
  private source: UserProfileSettings | undefined
  private saving = false
  private failed = false
  private disposed = false
  private readonly unsubscribe: () => void

  /** @param scope - settings scope bound to the private profile namespace. */
  constructor(private readonly scope: SettingsScope<UserProfileSettings>) {
    this.store = createSnapshotStore(this.project())
    this.unsubscribe = scope.subscribe(() => {
      if (this.disposed) return
      const snapshot = scope.getSnapshot()
      this.source = snapshot.value
      if (!this.isDirty()) this.draft = toDraft(this.source)
      this.publish()
    })
    const snapshot = scope.getSnapshot()
    this.source = snapshot.value
    this.draft = toDraft(this.source)
    this.publish()
  }

  /** Return the row's injected face and actions.
   * @returns callbacks and reactive state used by the settings row.
   */
  inject(): UserProfileRowFace {
    return {
      hooks: { userProfile: this.store },
      edit: (field, text) => { this.edit(field, text) },
      setConsent: (field, value) => { this.setConsent(field, value) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
      clear: () => { void this.clear() },
    }
  }

  /** Dispose the form and remove its settings subscription.
   * @returns nothing after the scope listener is removed.
   */
  dispose(): void {
    this.disposed = true
    this.unsubscribe()
  }

  private edit(field: TextField | 'family', text: string): void {
    this.draft[field] = text
    this.failed = false
    this.publish()
  }

  private setConsent(field: ConsentField, value: boolean): void {
    this.draft.consent = { ...this.draft.consent, [field]: value }
    this.failed = false
    this.publish()
  }

  private discard(): void {
    this.draft = toDraft(this.source)
    this.failed = false
    this.publish()
  }

  private async clear(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (!snapshot.writable || snapshot.status !== 'ready' || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let ok = true
    for (const field of [...FIELDS, 'family' as const, 'consent' as const]) {
      try {
        await this.scope.unset(field)
      } catch {
        ok = false
      }
    }
    const next = this.scope.getSnapshot().value
    if (next !== undefined) {
      this.source = next
      this.draft = toDraft(next)
    }
    this.failed = !ok
    this.saving = false
    this.publish()
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (!snapshot.writable || snapshot.status !== 'ready' || this.saving || this.invalid()) return
    this.saving = true
    this.failed = false
    this.publish()
    let ok = true
    const values: Record<string, unknown> = {
      preferredName: this.draft.preferredName.trim(),
      dateOfBirth: this.draft.dateOfBirth.trim(),
      gender: this.draft.gender.trim(),
      pronouns: this.draft.pronouns.trim(),
      tone: this.draft.tone.trim(),
      family: parseFamily(this.draft.family),
      consent: this.draft.consent,
    }
    for (const field of FIELDS) {
      try {
        const value = values[field]
        if (value === '') await this.scope.unset(field)
        else await this.scope.set(field, value)
      } catch {
        ok = false
      }
    }
    try {
      const family = values.family
      if (family === undefined) await this.scope.unset('family')
      else await this.scope.set('family', family)
      await this.scope.set('consent', values.consent)
    } catch {
      ok = false
    }
    const next = this.scope.getSnapshot().value
    if (next !== undefined) {
      this.source = next
      if (ok && !this.invalidAgainst(next)) this.draft = toDraft(next)
    }
    this.failed = !ok || this.isDirty()
    this.saving = false
    this.publish()
  }

  private invalid(): boolean {
    return this.draft.dateOfBirth !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(this.draft.dateOfBirth.trim())
      || (this.draft.family.trim() !== '' && parseFamily(this.draft.family) === undefined)
  }

  private invalidAgainst(value: UserProfileSettings): boolean {
    return this.draft.dateOfBirth.trim() !== textValue(value.dateOfBirth)
      || this.draft.family.trim() !== (value.family?.map(member => member.name === undefined ? member.relationship : `${member.relationship} | ${member.name}`).join('\n') ?? '')
  }

  private isDirty(): boolean {
    if (this.source === undefined) return false
    const next = toDraft(this.source)
    return FIELDS.some(field => this.draft[field].trim() !== next[field].trim())
      || this.draft.family.trim() !== next.family.trim()
      || (Object.keys(EMPTY_CONSENT) as ConsentField[]).some(field => this.draft.consent[field] !== next.consent[field])
  }

  private project(): UserProfileRowState {
    return {
      available: this.scope.getSnapshot().status === 'ready',
      writable: this.scope.getSnapshot().writable,
      dirty: this.isDirty(),
      invalid: this.invalid(),
      saving: this.saving,
      failed: this.failed,
      preferredName: fieldState(this.draft.preferredName),
      dateOfBirth: fieldState(this.draft.dateOfBirth, this.draft.dateOfBirth !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(this.draft.dateOfBirth.trim())),
      gender: fieldState(this.draft.gender),
      pronouns: fieldState(this.draft.pronouns),
      tone: fieldState(this.draft.tone),
      family: fieldState(this.draft.family, this.draft.family.trim() !== '' && parseFamily(this.draft.family) === undefined),
      consent: { ...this.draft.consent },
    }
  }

  private publish(): void {
    if (!this.disposed) this.store.set(this.project())
  }
}
