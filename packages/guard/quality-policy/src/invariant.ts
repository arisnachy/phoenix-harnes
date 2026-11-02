/**
 * Package-owned invariant companion for @phoenix-ai/dsh-quality-policy.
 * @module @phoenix-ai/dsh-quality-policy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-quality-policy'

/** Cordis companion plugin name. */
export const name = 'quality-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {
  // No runtime invariant: freshness state is private, agent-local, and derived from observed events.
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
