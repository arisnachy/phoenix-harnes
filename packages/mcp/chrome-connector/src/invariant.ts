/** Package-owned invariant companion for the standalone Chrome connector. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-chrome-connector'
/** Cordis companion plugin name. */
export const name = 'chrome-connector-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']
// No runtime invariant: the connector is an isolated stdio process with no Cordis state.
const install: InvariantInstaller = () => {}
/** Register ownership of this stateless connector package. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
