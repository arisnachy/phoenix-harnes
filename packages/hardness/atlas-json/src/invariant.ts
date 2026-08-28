/** Package-owned invariant companion for `@deepseek-ai/dsh-hardness-atlas-json`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hardness-atlas-json'

/** Cordis plugin name for the HARDNESS Atlas JSON invariant companion. */
export const name = 'hardness-atlas-json-invariant'
/** Required Cordis services for the invariant companion. */
export const inject = ['invariants']
// No runtime invariant: persistence behavior is validated by Atlas JSON contract tests.
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
