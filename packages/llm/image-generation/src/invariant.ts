/** Package-owned invariant companion for the image-generation capability. */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-image-generation'
export const name = 'image-generation-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

/** Register this package with the runtime invariant inventory. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
