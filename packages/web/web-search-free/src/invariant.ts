/** Package-owned invariant companion for keyless free web search. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-web-search-free'
export const name = 'web-search-free-invariant'
export const inject = ['invariants']
// No runtime invariant: provider registration is already lifecycle-owned by Cordis.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
