/** Model-facing sports tool invariant companion for this package. */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'
const PACKAGE_NAME = '@phoenix-ai/dsh-tool-sports'
export const name = 'tool-sports-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // Source permissions and ticket simulations are tested at the tool boundary.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
