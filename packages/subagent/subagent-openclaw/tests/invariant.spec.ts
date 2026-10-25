import { Context } from '@phoenix-ai/cordis'
import type { InvariantInstaller } from '@phoenix-ai/dsh-invariants'
import { describe, expect, it, vi } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('OpenClaw package invariant companion', () => {
  it('keeps the package-owned invariant registration shape', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _installer: InvariantInstaller) => dispose)
    const ctx = { invariants: { register } } as unknown as Context
    await expect(invariant.apply(ctx)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith('@phoenix-ai/dsh-subagent-openclaw', expect.any(Function))
    const install = register.mock.calls[0]![1]
    await install(new Context(), (_message: string): never => { throw new Error(_message) })
    expect(invariant.name).toBe('subagent-openclaw-invariant')
    expect(invariant.inject).toEqual(['invariants'])
  })
})
