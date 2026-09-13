/** Package-owned invariant companion. @module @phoenix-ai/dsh-tool-image-generation-codex/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-image-generation-codex'
export const name = 'tool-image-generation-codex-invariant'
export const inject = ['invariants']

/** Execution lifecycle is owned by the subagent and attachment seams. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
