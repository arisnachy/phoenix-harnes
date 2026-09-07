/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-phoenix-runtime`.
 * @module @deepseek-ai/dsh-phoenix-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-phoenix-runtime'

/** Cordis companion plugin name. */
export const name = 'phoenix-runtime-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// PHOENIX owns policy state, but its safety-critical effects are enforced by
// monotonic DSH guards/hooks. The first invariant companion reserves package
// ownership; deeper runtime assertions are added as public snapshots stabilize.
const install: InvariantInstaller = () => {}

/** Register PHOENIX runtime invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
