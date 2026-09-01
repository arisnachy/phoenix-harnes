/** Package-owned invariant companion for `@phoenix-ai/dsh-voice`. @module @phoenix-ai/dsh-voice/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-voice'
/** Cordis companion plugin name. */
export const name = 'voice-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']
/** No runtime invariant: provider choice and queue bounds are enforced synchronously by VoiceRuntime. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
