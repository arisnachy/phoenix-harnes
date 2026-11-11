/** Oracle's runtime contract; tool behavior is verified through focused tests. */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'
const PACKAGE_NAME = '@phoenix-ai/dsh-tool-oracle'
export const name = 'tool-oracle-invariant'
export const inject = ['invariants']
const install: InvariantInstaller = () => {
  // No runtime invariant: forecasting inputs and append-only ledger behavior are
  // exercised by focused domain tests; no cross-service relationship is owned here.
}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
