/** Package-owned invariant companion for `@phoenix-ai/dsh-hardness-adapters`. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-hardness-adapters'

/** Cordis plugin name for the HARDNESS adapters invariant companion. */
export const name = 'hardness-adapters-invariant'
/** Required Cordis services for the invariant companion. */
export const inject = ['invariants']
// No runtime invariant: package behavior is validated by adapter contract tests.
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context that owns the invariant registry.
 * @returns disposer for the registered invariant companion.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
