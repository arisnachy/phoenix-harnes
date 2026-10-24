/** Model-facing sports tool invariant companion for this package. */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'
const PACKAGE_NAME = '@phoenix-ai/dsh-tool-sports'
export const name = 'tool-sports-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: source permissions and simulated ticket prices are validated at the tool boundary.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
