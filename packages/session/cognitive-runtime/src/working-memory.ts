/** Deterministic focus, active, background, and budget-suppressed partitioning. */

import { cloneAttentionCandidate } from './clone.ts'
import type { AttentionCandidate, WorkingMemoryPartition } from './types.ts'

/**
 * Partition an already ranked candidate list into bounded working-memory regions.
 * @param candidates - Candidates sorted from highest to lowest attention.
 * @param activeLimit - Maximum candidates after the focus item in active memory.
 * @param backgroundLimit - Maximum candidates after active memory.
 * @returns Detached working-memory regions; suppressed means budget-only omission.
 */
export function partitionWorkingMemory(
  candidates: readonly AttentionCandidate[],
  activeLimit: number,
  backgroundLimit: number,
): WorkingMemoryPartition {
  validateBudget('activeLimit', activeLimit)
  validateBudget('backgroundLimit', backgroundLimit)
  const [focus, ...rest] = candidates
  const active = rest.slice(0, activeLimit).map(cloneAttentionCandidate)
  const background = rest.slice(activeLimit, activeLimit + backgroundLimit).map(cloneAttentionCandidate)
  const suppressed = rest.slice(activeLimit + backgroundLimit).map(cloneAttentionCandidate)
  return {
    ...focus === undefined ? {} : { focus: cloneAttentionCandidate(focus) },
    active,
    background,
    suppressed,
  }
}

function validateBudget(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`working memory ${name} must be a non-negative safe integer`)
  }
}
