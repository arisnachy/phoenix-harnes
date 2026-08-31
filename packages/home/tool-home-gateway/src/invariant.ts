/** Package-owned invariant companion for `@phoenix-ai/dsh-tool-home-gateway`. */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-home-gateway'

/** Cordis companion plugin name. */
export const name = 'tool-home-gateway-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Tool execution state is owned by the Home Assistant capability and its tool registry. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
