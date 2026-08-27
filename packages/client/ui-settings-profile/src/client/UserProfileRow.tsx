/** Expandable General-settings row for the private user profile. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserProfileRowFace } from './profile-controller.ts'
import css from './UserProfileRow.module.css'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Props synthesized by the General settings slot. */
export type UserProfileRowProps =
  PropsRuntime<'settings.general.item'>
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

/** Render the editable profile row and explicit consent controls.
 * @param props - slot runtime, locale, state, and action bindings.
 */
export function UserProfileRow(props: UserProfileRowProps) {
  const [open, setOpen] = useState(false)
  const state = props.useUserProfile(snapshot => snapshot)
  const t = props.t
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  const field = (key: keyof typeof state) => state[key] as { text: string; invalid: boolean }
  return (
    <div className={css.row}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.heading}>{t('title')}</span>
        <span className={css.description}>{t('description')}</span>
        {state.dirty ? <span className={css.unsaved}>{t('unsaved')}</span> : null}
      </button>
      {open ? (
        <div className={css.body}>
          {!state.writable ? <p className={css.notice}>{t('readOnly')}</p> : null}
          <p className={css.privacy}>{t('privacy')}</p>
          <ProfileInput id="profile-preferred-name" label={t('preferredName')} hint={t('preferredNameHint')} value={field('preferredName').text} invalid={field('preferredName').invalid} disabled={disabled} onChange={(value) =>{  props.edit('preferredName', value) }} />
          <ProfileInput id="profile-date-of-birth" label={t('dateOfBirth')} hint={t('dateOfBirthHint')} value={field('dateOfBirth').text} invalid={field('dateOfBirth').invalid} disabled={disabled} type="date" onChange={(value) =>{  props.edit('dateOfBirth', value) }} />
          <ProfileInput id="profile-gender" label={t('gender')} hint={t('genderHint')} value={field('gender').text} invalid={field('gender').invalid} disabled={disabled} onChange={(value) =>{  props.edit('gender', value) }} />
          <ProfileInput id="profile-pronouns" label={t('pronouns')} hint={t('pronounsHint')} value={field('pronouns').text} invalid={field('pronouns').invalid} disabled={disabled} onChange={(value) =>{  props.edit('pronouns', value) }} />
          <ProfileInput id="profile-tone" label={t('tone')} hint={t('toneHint')} value={field('tone').text} invalid={field('tone').invalid} disabled={disabled} onChange={(value) =>{  props.edit('tone', value) }} />
          <label className={css.label} htmlFor="profile-family">{t('family')}</label>
          <textarea id="profile-family" className={state.family.invalid ? css.inputInvalid : css.textarea} value={state.family.text} disabled={disabled} onChange={(event) => { props.edit('family', event.target.value) }} />
          <p className={css.hint}>{state.family.invalid ? t('invalid') : t('familyHint')}</p>
          <fieldset className={css.consent}>
            <legend>{t('consent')}</legend>
            {CONSENT_FIELDS.map(([fieldName, labelKey]) => (
              <label className={css.check} key={fieldName}>
                <input type="checkbox" checked={state.consent[fieldName]} disabled={disabled} onChange={(event) => { props.setConsent(fieldName, event.target.checked) }} />
                {t(labelKey)}
              </label>
            ))}
          </fieldset>
          {state.failed ? <p className={css.error} role="status">{t('saveFailed')}</p> : null}
          <div className={css.actions}>
            <button type="button" className={css.secondary} disabled={!state.dirty || disabled} onClick={props.discard}>{t('discard')}</button>
            <button type="button" className={css.primary} disabled={!state.dirty || state.invalid || disabled} onClick={props.save}>{t(state.saving ? 'saving' : 'save')}</button>
            <button type="button" className={css.danger} disabled={disabled} onClick={props.clear}>{t('clear')}</button>
          </div>
        </div>
      ) : null}
    </div>
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
      <p className={props.invalid ? css.error : css.hint}>{props.invalid ? '!' : props.hint}</p>
    </div>
  )
}
