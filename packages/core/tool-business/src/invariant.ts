/** Contract boundary for business model tools; no runtime invariant install yet. */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'
const PACKAGE_NAME = '@phoenix-ai/dsh-tool-business'
export const name = 'tool-business-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: planner registers only a read-only tool; execution and permission boundaries are tested separately.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
