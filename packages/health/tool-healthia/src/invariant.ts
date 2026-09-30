/** Package-owned invariant companion for `@phoenix-ai/dsh-tool-healthia`. @module @phoenix-ai/dsh-tool-healthia/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-healthia'
/** Cordis companion plugin name. */
export const name = 'tool-healthia-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']
/** No runtime invariant: agent-scoped registration and clinical policy are enforced by the tool registry and HealthIA service boundaries. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
