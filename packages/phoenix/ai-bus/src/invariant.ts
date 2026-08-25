/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-phoenix-ai-bus`.
 * @module @deepseek-ai/dsh-phoenix-ai-bus/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-phoenix-ai-bus'

export const name = 'phoenix-ai-bus-invariant'
export const inject = ['invariants']

// No runtime invariant: AI Bus cost classification is a pure snapshot policy;
// it creates no durable event/data relationship. Authority remains owned and
// enforced by dsh-phoenix-runtime rather than by this package.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
