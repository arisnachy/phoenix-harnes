/** Health planning is read-only; consent and signing enforcement currently live in tested pure functions. */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'
const PACKAGE_NAME = '@phoenix-ai/dsh-tool-health'
export const name = 'tool-health-invariant'
export const inject = ['invariants']
/** No runtime invariant: this plugin registers model planning tools without durable state or writes. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
