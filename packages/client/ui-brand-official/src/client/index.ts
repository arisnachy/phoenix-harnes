/** PHOENIX occupants for the generic browser-brand slots in this downstream build. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PhoenixBrandMark, PhoenixBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill every shipped brand slot as one declaration-aware PHOENIX registration set.
 * This downstream package is present in the Web roster for local and official
 * builds alike, so product identity must not disappear merely because the
 * artifact profile changes.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PhoenixBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, PhoenixBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PhoenixBrandMark)
      })))
}
