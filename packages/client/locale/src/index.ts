/** Host registration for the browser locale preference. */

import type { Context } from '@phoenix-ai/cordis'
import { settingsNamespace } from '@phoenix-ai/dsh-settings'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema, type LocaleSettings } from './locale-settings.ts'

export {
  LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/**
 * Register the durable locale section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(LOCALE_SETTINGS_NAMESPACE),
      LocaleSettingsSchema,
    )
  })
  ctx.inject(['settings', 'systemPrompt'], (host) => {
    host.systemPrompt.section({
      name: 'locale:user-output-language',
      order: -95,
      text: () => {
        const locale = (host.settings.get(settingsNamespace(LOCALE_SETTINGS_NAMESPACE)) as LocaleSettings | undefined)?.preference
        if (locale === undefined) return ''
        const language = locale === 'es' ? 'Spanish' : locale === 'zh' ? 'Chinese' : 'English'
        return `The user explicitly selected ${language} in PHOENIX settings. Use ${language} for every user-visible response, progress update, decision summary, and any provider-visible reasoning summary that may be displayed. This setting takes precedence over the language of the latest message. Do not translate commands, code, paths, citations, or identifiers. If a model cannot provide its public explanation in ${language}, do not invent or disclose its private reasoning; state that the explanation is unavailable.`
      },
    })
  })
}
