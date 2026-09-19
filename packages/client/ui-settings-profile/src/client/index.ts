/** Browser contribution for the top-level durable Profile settings page. */

import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type {} from '@phoenix-ai/dsh-client-ui-settings/client'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import { UserProfileRow } from './UserProfileRow.tsx'
import { UserProfileForm, USER_PROFILE_SETTINGS_NAMESPACE } from './profile-controller.ts'
import { en, es, zh, type UserProfileLocaleKey } from './locales.ts'
import type { UserProfileSettings } from './types.ts'

export type { UserProfileRowProps } from './UserProfileRow.tsx'
export type { AssistantGender, AssistantGenderMode, AssistantGenderSource, UserProfileRowState, UserProfileSettings } from './types.ts'
export type { UserProfileLocaleKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Local user-profile settings row copy. */
    'settings.profile': UserProfileLocaleKey
  }
}

/** Locale namespace owned by this settings row. */
export const SETTINGS_NS = 'settings.profile'

/** Services required by the browser settings contribution. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register Profile as its own first-class Settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en, es }), 'ui-settings-profile: dictionaries')
  const t = ctx.locale.bind(SETTINGS_NS)
  const scope = ctx.settingsScope.bind<UserProfileSettings>({ namespace: USER_PROFILE_SETTINGS_NAMESPACE })
  const form = new UserProfileForm(scope)
  ctx.effect(() => () => { form.dispose() }, 'ui-settings-profile: form')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'profile',
    order: 5,
    label: () => t('nav'),
    locale: SETTINGS_NS,
    inject: () => form.inject(),
  }, UserProfileRow))
}
