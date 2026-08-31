/** Host plugin inventory Settings tab plus the stable-update sidebar action. */

import type {} from '@phoenix-ai/dsh-client-locale/client'
import type { ClientContext } from '@phoenix-ai/dsh-client-runtime/client'
import type {} from '@phoenix-ai/dsh-client-ui-settings/client'
// Type-only: supplies the sidebar.footer.action SlotMap declaration.
import type {} from '@phoenix-ai/dsh-client-ui-sidebar/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { UpdateFooterAction, type UpdateFooterActionInjected } from './UpdateFooterAction.tsx'
import { en, es, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { UpdateFooterActionInjected, UpdateFooterActionProps } from './UpdateFooterAction.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@phoenix-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host plugin inventory and PHOENIX update copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the lazy inventory tab and stable-update footer action. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const inventoryInjected = (): PluginInventorySettingsTabInjected => ({ list })

  const readUpdateState: UpdateFooterActionInjected['readUpdateState'] = async () => {
    const result = await ctx.remote.pluginInventory.updateState()
    if (!result.ok) {
      throw new Error(`pluginInventory.updateState failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const restartForUpdate: UpdateFooterActionInjected['restartForUpdate'] = async () => {
    const result = await ctx.remote.pluginInventory.restartForUpdate()
    if (!result.ok) {
      throw new Error(`pluginInventory.restartForUpdate failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const refreshForUpdate: UpdateFooterActionInjected['refreshForUpdate'] = async () => {
    const result = await ctx.remote.pluginInventory.refreshForUpdate()
    if (!result.ok) {
      throw new Error(`pluginInventory.refreshForUpdate failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const updateInjected = (): UpdateFooterActionInjected => ({ readUpdateState, restartForUpdate, refreshForUpdate })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: inventoryInjected,
  }, PluginInventorySettingsTab))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'phoenix-update',
    order: -100,
    locale: NS,
    inject: updateInjected,
  }, UpdateFooterAction))
}
