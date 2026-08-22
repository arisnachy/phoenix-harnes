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

// No runtime invariant: PHOENIX Runtime owns policy state, while its current
// safety-critical effects are already enforced at the DSH request/tool seams.
// The package reserves explicit invariant ownership until a durable public
// runtime relation exists that can be checked independently at commit time.
const install: InvariantInstaller = () => {}

/** Register PHOENIX runtime invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
