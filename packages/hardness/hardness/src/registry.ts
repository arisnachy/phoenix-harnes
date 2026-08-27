/** Validation and lifecycle guards for the HARDNESS capability registry. */

import type { CapabilityDescriptor, CapabilityStatus } from './types.ts'

const statuses: readonly CapabilityStatus[] = [
  'experimental', 'testing', 'verified', 'broken', 'quarantined', 'deprecated',
]

/** Validate the descriptor fields owned by the registry boundary. */
export function validateCapabilityDescriptor(descriptor: CapabilityDescriptor): void {
  if (descriptor.id.length === 0) throw new Error('invalid capability descriptor: id is required')
  if (descriptor.kind.length === 0) throw new Error('invalid capability descriptor: kind is required')
  if (descriptor.name.length === 0 || descriptor.description.length === 0) {
    throw new Error('invalid capability descriptor: name and description are required')
  }
  if (descriptor.version.length === 0) throw new Error('invalid capability descriptor: version is required')
  if (!statuses.includes(descriptor.status)) throw new Error('invalid capability descriptor: unknown status')
}

/** Compare dotted numeric versions used by atlas replacements. */
export function compareCapabilityVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/** Apply one lifecycle transition, enforcing verification evidence at the boundary. */
export function transitionCapability(
  descriptor: CapabilityDescriptor,
  status: CapabilityStatus,
  reason: string,
  evidenceId: string | undefined,
): CapabilityDescriptor {
  if (reason.length === 0) throw new Error('capability transition requires a reason')
  if (status === 'verified' && evidenceId === undefined) {
    throw new Error('cannot transition capability to verified without evidence')
  }
  if (descriptor.status === 'verified' && status === 'experimental') {
    throw new Error('cannot transition verified capability back to experimental')
  }
  return { ...descriptor, status }
}
