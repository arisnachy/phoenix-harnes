/** Package-owned invariant companion for the OpenClaw execution adapter. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-subagent-openclaw'

export const name = 'subagent-openclaw-invariant'
export const inject = ['invariants']

// No runtime invariant: protocol and credential boundaries are checked before
// dispatch; this adapter owns no additional persisted projection to validate.
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
