/** Package-owned invariant companion for the memory search tool. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-session-learning'

/** Cordis companion plugin name. */
export const name = 'tool-session-learning-invariant'
/** The invariant registry must be available before ownership is registered. */
export const inject = ['invariants']

/** The tool is read-only; the ledger validates all persisted memory rows. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
