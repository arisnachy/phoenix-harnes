/** Pure replay fold for durable quality/change whole-snapshot events. */

import type { SessionEvent } from '@phoenix-ai/dsh-session'
import type { QualityAssessmentSnapshot } from '@phoenix-ai/dsh-quality'

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Reconstruct the current assessment from durable session history. */
export function foldQuality(events: readonly SessionEvent[]): QualityAssessmentSnapshot | undefined {
  let current: QualityAssessmentSnapshot | undefined
  for (const event of events) {
    if (event.type !== 'quality/change') continue
    const change = event.data
    if (change.operation === 'clear') {
      current = undefined
      continue
    }
    current = clone(change.assessment)
  }
  return current
}
