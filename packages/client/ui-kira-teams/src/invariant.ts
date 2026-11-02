/**
 * Package-owned invariant companion for `@phoenix-ai/dsh-client-ui-kira-teams`.
 * @module @phoenix-ai/dsh-client-ui-kira-teams/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-client-ui-kira-teams'

/** Cordis companion plugin name. */
export const name = 'client-ui-kira-teams-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a single overlay-source registration whose disposal
 * rides the slot registry — it emits no cordis events and owns no cross-plugin
 * mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
