import { describe, expect, it } from 'vitest'
import type {
  CapabilityDescriptor,
  CapabilityRegistration,
  HardnessService,
} from '@phoenix-ai/dsh-hardness/src/types.ts'
import { indexOpenClawExtensions } from '../src/openclaw-adapter.ts'

describe('HARDNESS OpenClaw adapter', () => {
  it('registers all donor capabilities and disposes every registration', () => {
    const registered: CapabilityDescriptor[] = []
    const disposeCalls: number[] = []
    const hardness: Pick<HardnessService, 'register'> = {
      register(descriptor) {
        registered.push(descriptor)
        const index = disposeCalls.push(0) - 1
        return {
          dispose: () => {
            disposeCalls[index] = (disposeCalls[index] ?? 0) + 1
          },
        } satisfies CapabilityRegistration
      },
    }

    const dispose = indexOpenClawExtensions(hardness)

    expect(registered).toHaveLength(160)
    expect(registered.every(item => item.status === 'experimental')).toBe(true)
    expect(registered.find(item => item.id === 'openclaw:a2a')?.kind).toBe('agent-protocol')
    expect(registered.find(item => item.id === 'openclaw:workboard')?.kind).toBe('work')
    expect(registered.find(item => item.id === 'openclaw:github')?.kind).toBe('integration')
    expect(registered.find(item => item.id === 'openclaw:facetime')?.kind).toBe('voice')
    expect(registered.find(item => item.id === 'openclaw:onnx')?.kind).toBe('local-inference')

    dispose()
    expect(disposeCalls.every(count => count === 1)).toBe(true)
  })
})
