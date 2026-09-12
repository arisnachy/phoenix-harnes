/** Package-owned runtime invariants for detached cognitive snapshots. */

import type { Context } from '@phoenix-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@phoenix-ai/dsh-invariants'
import type { Config } from './index.ts'
import type { CognitiveState } from './types.ts'

const PACKAGE_NAME = '@phoenix-ai/dsh-cognitive-runtime'

/** Cordis companion plugin name. */
export const name = 'cognitive-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one state against the runtime's bounded projection relation. */
export function validateCognitiveState(state: CognitiveState, config: Readonly<Config>): void {
  if (typeof state.sessionId !== 'string' || state.sessionId.trim() === '') throw new TypeError('cognitive state session identity is empty')
  if (!Number.isSafeInteger(state.observedSeq) || state.observedSeq < -1) throw new TypeError('cognitive state observed sequence is invalid')
  if (!Number.isSafeInteger(state.candidateCount) || state.candidateCount < 0 || state.candidateCount > config.maxCandidates) {
    throw new TypeError('cognitive state candidate count exceeds configured maximum')
  }
  if (state.active.length > config.activeLimit) throw new TypeError('cognitive state active budget exceeded')
  if (state.background.length > config.backgroundLimit) throw new TypeError('cognitive state background budget exceeded')
  const occupied = (state.focus === undefined ? 0 : 1) + state.active.length + state.background.length + state.suppressed.length
  if (occupied !== state.candidateCount) throw new TypeError('cognitive state partitions do not match candidate count')
  if (state.candidateCount > 0 && state.focus === undefined) throw new TypeError('cognitive state candidate count requires a focus')
  for (const candidate of [
    ...state.focus === undefined ? [] : [state.focus],
    ...state.active,
    ...state.background,
    ...state.suppressed,
  ]) {
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
      throw new TypeError('cognitive state candidate score is outside 0..1')
    }
  }
}

/** Install validation on every successful runtime snapshot notification. */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('cognitive-runtime/state', (state, config) => {
    try {
      validateCognitiveState(state, config)
    } catch (error: unknown) {
      fail(`cognitive-runtime snapshot violates its bounded state relation: ${String(error)}`)
    }
  })
}

/**
 * Register the cognitive-runtime invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
