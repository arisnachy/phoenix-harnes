/** Package-owned invariant companion for `@phoenix-ai/dsh-home-gateway`. @module @phoenix-ai/dsh-home-gateway/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-home-gateway'
/** Cordis companion plugin name. */
export const name = 'home-gateway-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']
/** No runtime invariant: allowlists and private-endpoint checks run at the gateway request boundary. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
