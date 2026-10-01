/** Package-owned HealthIA runtime invariant registration. @module @phoenix-ai/dsh-healthia/invariant */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'

const PACKAGE_NAME = '@phoenix-ai/dsh-healthia'

export const name = 'healthia-invariant'
export const inject = ['invariants']

/**
 * The Service Definition owns no durable state itself. Provider packages must
 * register their own storage/provenance invariants; this companion reserves
 * the package identity and documents that boundary explicitly.
 */
const install: InvariantInstaller = Object.assign(() => {}, {
  reason: 'No runtime invariant: @phoenix-ai/dsh-healthia is a state-free Service Definition; providers own persistence invariants.',
})

/** Register the state-free Service Definition invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
