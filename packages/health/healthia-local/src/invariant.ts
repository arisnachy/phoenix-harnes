/** Package-owned invariant companion for `@phoenix-ai/dsh-healthia-local`. @module @phoenix-ai/dsh-healthia-local/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-healthia-local'
/** Cordis companion plugin name. */
export const name = 'healthia-local-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']
/** No runtime invariant: encryption, locking, and patient isolation are enforced at the provider mutation boundary. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
