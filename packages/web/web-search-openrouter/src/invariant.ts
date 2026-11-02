/** Package-owned invariant companion for OpenRouter web search. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-web-search-openrouter'
/** Cordis companion plugin name. */
export const name = 'web-search-openrouter-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']
// No runtime invariant: provider registration is already lifecycle-owned by Cordis.
const install: InvariantInstaller = () => {}
/** Register this stateless provider package. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
