/**
 * Package-owned invariant companion for `@phoenix-ai/dsh-session-learning`.
 * @module @phoenix-ai/dsh-session-learning/invariant
 */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-session-learning'

/** Cordis companion plugin name. */
export const name = 'session-learning-invariant'
/** The invariant registry must be available before ownership is registered. */
export const inject = ['invariants']

/** The ledger validates its durable rows and keeps session provenance in each record. */
const install: InvariantInstaller = () => {
  // No runtime invariant: the learning ledger validates persisted memory rows.
}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
