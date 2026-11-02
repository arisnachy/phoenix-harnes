/** Package-owned invariant companion for `@phoenix-ai/dsh-secret-vault`. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-secret-vault'

/** Cordis companion plugin name. */
export const name = 'secret-vault-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The credential provider and command runtime own the underlying invariants. */
const install: InvariantInstaller = (_ctx: Context) => {
  // No runtime invariant: the credentials provider and command runtime own the vault state.
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
