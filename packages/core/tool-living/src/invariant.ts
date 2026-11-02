/** Package-owned invariant companion for `@phoenix-ai/dsh-tool-living`. @module @phoenix-ai/dsh-tool-living/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-living'
export const name = 'tool-living-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: this package's contract is exercised by its service/tool tests and composition gates.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
