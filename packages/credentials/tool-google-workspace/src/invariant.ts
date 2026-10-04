/** Package-owned invariant companion for @phoenix-ai/dsh-tool-google-workspace. */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-google-workspace'

/** Cordis companion plugin name. */
export const name = 'tool-google-workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {
  // No runtime invariant: OAuth grants and Google API state are owned by the host Google broker.
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
