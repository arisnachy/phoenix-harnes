/** Top-level Settings page for Phoenix identity and the private user profile. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { UserProfileRowFace } from './profile-controller.ts'
import type { AssistantGender } from './types.ts'
import css from './UserProfileRow.module.css'
import type {} from '@phoenix-ai/dsh-client-ui-settings/client'

/** Props synthesized by the top-level Settings section slot. */
export type UserProfileRowProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.profile'>
  & InjectFace<UserProfileRowFace>

const CONSENT_FIELDS = [
  ['preferredName', 'consentName'],
  ['dateOfBirth', 'consentAge'],
  ['gender', 'consentGender'],
  ['pronouns', 'consentPronouns'],
  ['tone', 'consentTone'],
  ['family', 'consentFamily'],
] as const

/** Render Phoenix identity, learned preference provenance, and private context controls. */
export function UserProfileRow(props: UserProfileRowProps) {
  const state = props.useUserProfile(snapshot => snapshot)
  const t = props.t
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const field = (key: keyof typeof state) => state[key] as { text: string; invalid: boolean }
  const sourceKey = state.assistantGenderSource === 'manual'
    ? 'assistantGenderManual'
    : state.assistantGenderSource === 'inferred'
      ? 'assistantGenderInferred'
      : 'assistantGenderAutomatic'

  return (
    <section className={css.section}>
      <header className={css.sectionHeader}>
        <h2 className={css.heading}>{t('title')}</h2>
        <p className={css.description}>{t('description')}</p>
        {state.dirty ? <span className={css.unsaved}>{t('unsaved')}</span> : null}
      </header>

      {!state.writable ? <p className={css.notice}>{t('readOnly')}</p> : null}

      <div className={css.group}>
        <h3 className={css.groupTitle}>{t('assistantSection')}</h3>
        <p className={css.hint}>{t('assistantSectionHint')}</p>
        <ProfileInput id="profile-assistant-name" label={t('assistantName')} hint={t('assistantNameHint')} value={field('assistantName').text} invalid={field('assistantName').invalid} disabled={disabled} onChange={(value) => { props.edit('assistantName', value) }} />
        <label className={css.label} htmlFor="profile-assistant-gender">{t('assistantGender')}</label>
        <select id="profile-assistant-gender" className={css.input} value={state.assistantGender} disabled={disabled} onChange={(event) => { props.setAssistantGender(event.target.value as AssistantGender) }}>
          <option value="feminine">{t('assistantGenderFeminine')}</option>
          <option value="masculine">{t('assistantGenderMasculine')}</option>
          <option value="neutral">{t('assistantGenderNeutral')}</option>
        </select>
        <p className={css.hint}>{t('assistantGenderHint')}</p>
        <div className={css.preferenceMeta}>
          <span className={css.source}>{t(sourceKey)}</span>
          {state.assistantGenderSource !== 'auto' ? (
            <button type="button" className={css.linkButton} disabled={disabled} onClick={props.setAssistantGenderAutomatic}>
              {t('assistantGenderUseAutomatic')}
            </button>
          ) : null}
        </div>
      </div>

      <div className={css.group}>
        <h3 className={css.groupTitle}>{t('aboutYouSection')}</h3>
        <ProfileInput id="profile-preferred-name" label={t('preferredName')} hint={t('preferredNameHint')} value={field('preferredName').text} invalid={field('preferredName').invalid} disabled={disabled} onChange={(value) => { props.edit('preferredName', value) }} />
        <ProfileInput id="profile-date-of-birth" label={t('dateOfBirth')} hint={t('dateOfBirthHint')} value={field('dateOfBirth').text} invalid={field('dateOfBirth').invalid} disabled={disabled} type="date" onChange={(value) => { props.edit('dateOfBirth', value) }} />
        <ProfileInput id="profile-gender" label={t('gender')} hint={t('genderHint')} value={field('gender').text} invalid={field('gender').invalid} disabled={disabled} onChange={(value) => { props.edit('gender', value) }} />
        <ProfileInput id="profile-pronouns" label={t('pronouns')} hint={t('pronounsHint')} value={field('pronouns').text} invalid={field('pronouns').invalid} disabled={disabled} onChange={(value) => { props.edit('pronouns', value) }} />
        <ProfileInput id="profile-tone" label={t('tone')} hint={t('toneHint')} value={field('tone').text} invalid={field('tone').invalid} disabled={disabled} onChange={(value) => { props.edit('tone', value) }} />
        <label className={css.label} htmlFor="profile-family">{t('family')}</label>
        <textarea id="profile-family" className={state.family.invalid ? css.inputInvalid : css.textarea} value={state.family.text} disabled={disabled} onChange={(event) => { props.edit('family', event.target.value) }} />
        <p className={css.hint}>{state.family.invalid ? t('invalid') : t('familyHint')}</p>
      </div>

      <div className={css.group}>
        <h3 className={css.groupTitle}>{t('contextSection')}</h3>
        <p className={css.privacy}>{t('privacy')}</p>
        <fieldset className={css.consent}>
          <legend>{t('consent')}</legend>
          {CONSENT_FIELDS.map(([fieldName, labelKey]) => (
            <label className={css.check} key={fieldName}>
              <input type="checkbox" checked={state.consent[fieldName]} disabled={disabled} onChange={(event) => { props.setConsent(fieldName, event.target.checked) }} />
              {t(labelKey)}
            </label>
          ))}
        </fieldset>
      </div>

      {state.failed ? <p className={css.error} role="status">{t('saveFailed')}</p> : null}
      <div className={css.actions}>
        <button type="button" className={css.secondary} disabled={!state.dirty || disabled} onClick={props.discard}>{t('discard')}</button>
        <button type="button" className={css.primary} disabled={!state.dirty || state.invalid || disabled} onClick={props.save}>{t(state.saving ? 'saving' : 'save')}</button>
        <button type="button" className={css.danger} disabled={disabled} onClick={props.clear}>{t('clear')}</button>
      </div>
    </section>
  )
}

function ProfileInput(props: {
  id: string
  label: string
  hint: string
  value: string
  invalid: boolean
  disabled: boolean
  type?: 'text' | 'date'
  onChange: (value: string) => void
}) {
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      <input id={props.id} className={props.invalid ? css.inputInvalid : css.input} type={props.type ?? 'text'} value={props.value} disabled={props.disabled} onChange={(event) => { props.onChange(event.target.value) }} />
      <p className={props.invalid ? css.error : css.hint}>{props.hint}</p>
    </div>
  )
}
