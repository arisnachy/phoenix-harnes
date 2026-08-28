import { describe, expect, it, vi } from 'vitest'
import type { CapabilitySurface } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { OpenClawCapabilityBroker } from '../src/openclaw/broker.ts'

const signal = new AbortController().signal

function openclawSurface(id: string): CapabilitySurface {
  return {
    id: `${id}:native`,
    need: { kind: 'web-search' },
    capabilityId: id as never,
    capabilityVersion: '2026.8.1',
    modality: 'native',
    inputs: [],
    outputs: ['web-search'],
    requiredPermissions: [],
    verification: 'testing',
  }
}

describe('OpenClaw Capability Broker', () => {
  it('selects and prepares a matching extension lazily', async () => {
    const prepare = vi.fn(async (extensionId: string) => ({ kind: 'ready' as const, extensionId }))
    const host = { prepare, execute: vi.fn(), deactivate: vi.fn() }
    const broker = new OpenClawCapabilityBroker(host)

    expect(prepare).not.toHaveBeenCalled()
    const descriptor = await broker.acquire({ kind: 'web-search' }, signal)

    expect(descriptor?.id.startsWith('openclaw:')).toBe(true)
    expect(descriptor?.kind).toBe('web-search')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledWith(descriptor?.id.slice('openclaw:'.length), signal)
  })

  it('tries the next matching extension when preparation is unavailable', async () => {
    const prepare = vi.fn(async (extensionId: string) => extensionId === 'brave'
      ? { kind: 'blocked' as const, status: 'MISSING_SECRET' as const, reasons: ['missing credential reference'] }
      : { kind: 'ready' as const, extensionId })
    const broker = new OpenClawCapabilityBroker({ prepare, execute: vi.fn(), deactivate: vi.fn() })

    const descriptor = await broker.acquire({ kind: 'web-search' }, signal)

    expect(descriptor).toBeDefined()
    expect(descriptor?.id).not.toBe('openclaw:brave')
    expect(prepare.mock.calls.length).toBeGreaterThan(1)
    expect(broker.diagnostics('brave')).toMatchObject({ status: 'MISSING_SECRET' })
  })

  it('summarizes retained blocked diagnostics for the requested capability family', async () => {
    const broker = new OpenClawCapabilityBroker({
      prepare: vi.fn(async () => ({ kind: 'blocked' as const, status: 'MISSING_DEPENDENCY' as const, reasons: ['isolated OpenClaw package installer unavailable'] })),
      execute: vi.fn(),
      deactivate: vi.fn(),
    })

    await expect(broker.acquire({ kind: 'web-search' }, signal)).resolves.toBeUndefined()

    expect(broker.diagnosticsForNeed({ kind: 'web-search' })).toEqual(expect.arrayContaining([
      expect.stringContaining('MISSING_DEPENDENCY'),
      expect.stringContaining('isolated OpenClaw package installer unavailable'),
    ]))
  })

  it('owns only OpenClaw capability surfaces', () => {
    const broker = new OpenClawCapabilityBroker({ prepare: vi.fn(), execute: vi.fn(), deactivate: vi.fn() })

    expect(broker.supports(openclawSurface('openclaw:brave'))).toBe(true)
    expect(broker.supports(openclawSurface('tool:echo'))).toBe(false)
  })

  it('executes an OpenClaw surface through the prepared host', async () => {
    const execute = vi.fn(async () => ({ value: null, content: [{ type: 'text' as const, text: 'ok' }], isError: false as const }))
    const broker = new OpenClawCapabilityBroker({
      prepare: vi.fn(async (extensionId: string) => ({ kind: 'ready' as const, extensionId })),
      execute,
      deactivate: vi.fn(),
    })
    const surface = openclawSurface('openclaw:brave')

    await expect(broker.execute(surface, { query: 'phoenix' }, { callId: 'c1' as never, signal })).resolves.toMatchObject({ isError: false })
    expect(execute).toHaveBeenCalledWith('brave', { query: 'phoenix' }, expect.objectContaining({ signal }))
  })

  it('refuses to execute a non-OpenClaw surface', async () => {
    const broker = new OpenClawCapabilityBroker({ prepare: vi.fn(), execute: vi.fn(), deactivate: vi.fn() })
    const surface = openclawSurface('tool:echo')

    await expect(broker.execute(surface, {}, { callId: 'c1' as never, signal })).rejects.toThrow('not an OpenClaw capability')
  })
})
