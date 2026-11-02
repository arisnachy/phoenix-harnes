/** Package-owned invariant companion for `@phoenix-ai/dsh-hardness`. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-hardness'

export const name = 'hardness-invariant'
export const inject = ['invariants']

/** No runtime invariant: the registry is its own atomic source of truth. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
