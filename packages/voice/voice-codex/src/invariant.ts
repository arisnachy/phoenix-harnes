/** Package-owned invariant companion for @phoenix-ai/dsh-voice-codex. @module @phoenix-ai/dsh-voice-codex/invariant */

/* jscpd:ignore-start */
import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-voice-codex'
/** Cordis companion plugin name. */
export const name = 'voice-codex-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']
/** No runtime invariant: the adapter is loopback-process only and never exposes Codex credentials to the browser. */
const install: InvariantInstaller = () => {}
/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
