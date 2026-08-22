/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-phoenix-repo-brain`.
 * @module @deepseek-ai/dsh-phoenix-repo-brain/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-phoenix-repo-brain'

export const name = 'phoenix-repo-brain-invariant'
export const inject = ['invariants']

// No runtime invariant: Repo Brain publishes no durable domain event and owns
// no executable side effect. Root confinement and read-only behavior are
// enforced at its operation boundary and covered by package tests.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
