/** Package-owned invariant companion for `@deepseek-ai/dsh-hardness-atlas-json`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hardness-atlas-json'

export const name = 'hardness-atlas-json-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
