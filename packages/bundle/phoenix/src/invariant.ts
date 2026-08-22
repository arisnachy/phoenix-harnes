/**
 * Package-owned invariant companion for `@arisnachy/phoenix-bundle`.
 * @module @arisnachy/phoenix-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@arisnachy/phoenix-bundle'
export const name = 'phoenix-bundle-invariant'
export const inject = ['invariants']

// No runtime invariant: this package is a static profile composition carrier;
// each mounted runtime package owns and registers its own executable invariant.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
