/** Package-owned invariant companion for `@deepseek-ai/dsh-hardness`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hardness'

export const name = 'hardness-invariant'
export const inject = ['invariants']

/** No runtime invariant: the registry is its own atomic source of truth. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
