import type { HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { toHardnessCapabilityDescriptors } from './openclaw/index.ts'

/** Project the pinned OpenClaw extension catalog into HARDNESS/ATLAS. */
export function indexOpenClawExtensions(hardness: Pick<HardnessService, 'register'>): () => void {
  const registrations = [] as ReturnType<HardnessService['register']>[]
  try {
    for (const descriptor of toHardnessCapabilityDescriptors()) {
      registrations.push(hardness.register(descriptor))
    }
  } catch (error) {
    for (const registration of registrations.reverse()) registration.dispose()
    throw error
  }
  return () => {
    for (const registration of registrations.reverse()) registration.dispose()
  }
}
