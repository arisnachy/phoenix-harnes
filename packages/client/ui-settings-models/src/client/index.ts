/**
 * Models, Connectors, and product-onboarding settings plugin, browser half.
 * It registers independent Models and Connectors pages plus the ordered
 * internal-testing and official-DeepSeek onboarding dialogs. Host settings,
 * authorization, and credential contracts stay behind their existing wire APIs.
 */
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import type {} from '@phoenix-ai/dsh-client-ui-settings/client'
import type {} from '@phoenix-ai/dsh-client-locale/client'
import type {} from '@phoenix-ai/dsh-api-remotes/client'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { ConnectorsSettingsSection } from './AuthorizationPanel.tsx'
import type { ConnectorsSettingsSectionProps } from './AuthorizationPanel.tsx'
import { DeepSeekOnboardingDialog } from './DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingInjected } from './DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from './WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from './WelcomeNotice.tsx'
import { decodeWelcomeSection, WelcomeNoticeStore } from './welcome-store.ts'
import { ModelsSettingsStore } from './store.ts'
import { createSettingsSchemaOperations } from './schema-operations.ts'
import { en, es, zh, type ModelsKey } from './locales.ts'
import { connectorEn, connectorEs, connectorZh, type ConnectorKey } from './connectors-locales.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from '../onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type { ConnectorsSettingsSectionProps } from './AuthorizationPanel.tsx'
export type { ModelsKey } from './locales.ts'
export type { ConnectorKey } from './connectors-locales.ts'
export { CONNECTOR_CATALOG, CONNECTOR_PRESETS } from './connector-catalog.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy. */
    'settings.models': ModelsKey
    /** The dedicated Connectors page. */
    'settings.connectors': ConnectorKey
  }
}

const NS = 'settings.models'
const CONNECTORS_NS = 'settings.connectors'
export type { ModelsSettingsState, ProviderRow } from './store.ts'

/**
 * Refetch the Models snapshot only after its first load.
 *
 * @param controller - Models settings store whose loaded snapshot may be refreshed.
 * @returns Nothing; refresh is dispatched asynchronously when the store is active.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/** Services required by the Models/Connectors settings plugin. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope', 'settingsSchema']

/**
 * Register Models, Connectors, and onboarding surfaces.
 *
 * @param ctx - Browser Cordis context that owns slots, locale, connection, and settings services.
 * @returns Nothing; registrations are owned and disposed by the Cordis fiber.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-settings-models: copy dictionaries')
  ctx.effect(
    () => ctx.locale.register(CONNECTORS_NS, { zh: connectorZh, en: connectorEn, es: connectorEs }),
    'ui-settings-models: connector dictionaries',
  )

  const connection = ctx.get('connection') as ConnectionHandle
  const schema = createSettingsSchemaOperations(ctx.settingsSchema)
  const controller = new ModelsSettingsStore(connection.api, schema, ctx.settingsScope.describe())
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  const connectorT = ctx.locale.bind(CONNECTORS_NS) as ConnectorsSettingsSectionProps['connectorT']
  const injected = (): ModelsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    api: connection.api,
    schema,
    t,
  })
  const connectorsInjected = (): ConnectorsSettingsSectionProps => ({
    api: connection.api.authorization,
    t,
    connectorT,
    onAuthorized: () => { refreshIfLoaded(controller) },
  })
  const deepSeekOnboardingInjected = (): DeepSeekOnboardingInjected => ({
    controller,
    hooks: { models: controller.store },
    api: connection.api,
    schema,
    t,
  })
  const welcomeController = new WelcomeNoticeStore(ctx.settingsScope.bind({
    namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    decode: decodeWelcomeSection,
  }))
  const welcomeInjected = (): WelcomeNoticeInjected => ({
    controller: welcomeController,
    hooks: { welcome: welcomeController.store },
    t,
  })

  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshModels() }),
      ctx.remote.$on('credentials/reference-updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => {
      welcomeController.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-models: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: () => t('nav'),
    inject: injected,
  }, ModelsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'connectors',
    order: 12,
    label: () => connectorT('nav'),
    inject: connectorsInjected,
  }, ConnectorsSettingsSection))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    inject: welcomeInjected,
  }, WelcomeNotice))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'deepseek-official',
    order: 0,
    inject: deepSeekOnboardingInjected,
  }, DeepSeekOnboardingDialog))
}
