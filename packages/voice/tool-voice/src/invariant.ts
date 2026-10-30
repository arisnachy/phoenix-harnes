/** Package-owned invariant companion for `@phoenix-ai/dsh-tool-voice`. @module @phoenix-ai/dsh-tool-voice/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-tool-voice'
/** Cordis companion plugin name. */
export const name = 'tool-voice-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']
/** The speech tool owns no additional invariant beyond Host authorization. */
// No runtime invariant: the voice provider checks configuration, authorization, and available output devices at execution time.
const install: InvariantInstaller = () => {}
/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
