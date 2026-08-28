import { describe, expect, it, vi } from 'vitest'
import type { CapabilitySurface } from '@deepseek-ai/dsh-hardness'
import { createOpenClawProductionBridge } from '../src/openclaw/production.ts'
import type { OpenClawPackageInstaller } from '../src/openclaw/package-host.ts'

const signal = new AbortController().signal

function surfaceFor(descriptor: { readonly id: string; readonly kind: string; readonly version: string }): CapabilitySurface {
  return {
    id: `${descriptor.id}:native`,
    need: { kind: descriptor.kind },
    capabilityId: descriptor.id as never,
    capabilityVersion: descriptor.version,
    modality: 'native',
    inputs: [],
    outputs: [descriptor.kind],
    requiredPermissions: [],
    verification: 'testing',
  }
}

describe('OpenClaw production bridge', () => {
  it('fails closed with a concrete diagnostic when no isolated installer is registered', async () => {
    const bridge = createOpenClawProductionBridge()

    await expect(bridge.broker.acquire({ kind: 'web-search' }, signal)).resolves.toBeUndefined()
    expect(bridge.broker.diagnostics('brave')).toMatchObject({
      status: 'MISSING_DEPENDENCY',
      reasons: expect.arrayContaining([expect.stringContaining('isolated OpenClaw package installer')]),
    })
  })

  it('prepares and executes a real broker path when an installer supplies a compatible pinned package', async () => {
    const execute = vi.fn(async () => ({
      isError: false as const,
      value: null,
      content: [{ type: 'text' as const, text: 'result' }],
    }))
    const installer: OpenClawPackageInstaller = {
      prepare: vi.fn(async candidate => ({
        kind: 'ready' as const,
        package: {
          registrations: [candidate.registrationFamily],
          execute,
          deactivate: vi.fn(async () => {}),
        },
      })),
    }
    const bridge = createOpenClawProductionBridge(installer)
    const descriptor = await bridge.broker.acquire({ kind: 'web-search' }, signal)

    expect(descriptor).toBeDefined()
    expect(installer.prepare).toHaveBeenCalledWith(expect.objectContaining({ coreSpec: 'openclaw@2026.8.1' }), signal)
    await expect(bridge.executor.execute(surfaceFor(descriptor!), { query: 'phoenix' }, { callId: 'call-1' as never, signal })).resolves.toMatchObject({
      isError: false,
    })
    expect(execute).toHaveBeenCalled()
  })
})
