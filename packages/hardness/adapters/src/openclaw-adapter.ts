import type { CapabilityRegistration, HardnessService } from '@phoenix-ai/dsh-hardness/src/types.ts'
import { toHardnessCapabilityDescriptors } from './openclaw/index.ts'

function disposeRegistrations(registrations: readonly CapabilityRegistration[]): void {
  for (let index = registrations.length - 1; index >= 0; index--) {
    registrations[index]?.dispose()
  }
}

/**
 * Project the pinned OpenClaw extension catalog into HARDNESS/ATLAS.
 * @param hardness - HARDNESS registry that owns the projected capabilities.
 * @returns Idempotent disposer for every OpenClaw capability registration.
 */
export function indexOpenClawExtensions(hardness: Pick<HardnessService, 'register'>): () => void {
  const registrations: CapabilityRegistration[] = []
  try {
    for (const descriptor of toHardnessCapabilityDescriptors()) {
      registrations.push(hardness.register(descriptor))
    }
  } catch (error) {
    disposeRegistrations(registrations)
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposeRegistrations(registrations)
  }
}
