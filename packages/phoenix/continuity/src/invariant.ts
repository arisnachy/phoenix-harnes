/**
 * Package-owned invariant companion for `@arisnachy/phoenix-continuity`.
 * @module @arisnachy/phoenix-continuity/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@arisnachy/phoenix-continuity'

export const name = 'phoenix-continuity-invariant'
export const inject = ['invariants']

// No runtime invariant: storage-domain validates durable records and serializes
// commits; Mission Graph legality and complete-record byte bounds are enforced
// at this package's mutation boundary and covered by focused tests.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
