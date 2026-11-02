import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import type { Sandbox as SandboxType } from 'e2b'
import E2BRuntime, {
  e2bControlEnvs,
  FileType,
  SandboxNotFoundError,
  quoteE2BShellArg,
} from '@phoenix-ai/dsh-e2b'
import * as E2BInvariant from '../src/invariant.ts'
import InvariantRegistry from '@phoenix-ai/dsh-invariants'

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  connect: vi.fn(),
}))

vi.mock('e2b', async (importOriginal) => {
  const actual = await importOriginal<typeof import('e2b')>()
  // The mock replaces only the SDK's static factory surface and is never constructed.
  // oxlint-disable-next-line typescript/no-extraneous-class -- The SDK contract is a class with static factories.
  class FakeSandbox {
    static create(...args: unknown[]): unknown {
      return sdk.create(...args)
    }

    static connect(...args: unknown[]): unknown {
      return sdk.connect(...args)
    }
  }
  return { ...actual, Sandbox: FakeSandbox }
})

interface SandboxFixture {
  sandbox: SandboxType
  makeDir: ReturnType<typeof vi.fn>
  getInfo: ReturnType<typeof vi.fn>
  run: Mock<RunCommand>
  kill: ReturnType<typeof vi.fn>
  setTimeout: ReturnType<typeof vi.fn>
  betaPause: ReturnType<typeof vi.fn>
}

type RunCommand = (
  command: string,
  options?: { envs?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

function fakeSandbox(id = 'sandbox-1'): SandboxFixture {
  const makeDir = vi.fn().mockResolvedValue(true)
  const getInfo = vi.fn().mockResolvedValue({ type: FileType.DIR })
  const run = vi.fn<RunCommand>().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  const kill = vi.fn().mockResolvedValue(undefined)
  const setTimeout = vi.fn().mockResolvedValue(undefined)
  const betaPause = vi.fn().mockResolvedValue(undefined)
  const sandbox = {
    sandboxId: id,
    files: { makeDir, getInfo },
    commands: { run },
    kill,
    setTimeout,
    betaPause,
  } as unknown as SandboxType
  return { sandbox, makeDir, getInfo, run, kill, setTimeout, betaPause }
}

beforeEach(() => {
  sdk.create.mockReset()
  sdk.connect.mockReset()
  vi.unstubAllEnvs()
})

describe('E2BRuntime', () => {
  it('gives each SDK login shell a fresh non-overridable control home', () => {
    const first = e2bControlEnvs({ HOME: '/hostile', NPM_TOKEN: '' })
    const second = e2bControlEnvs()

    expect(first.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(first).toEqual({ HOME: first.HOME, NPM_TOKEN: '' })
    expect(first.HOME).not.toBe(second.HOME)
  })

  it('creates one protected shared sandbox and kills it on default disposal', async () => {
    const fixture = fakeSandbox()
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    const service = ctx.e2b
    await expect(service.getSandbox()).resolves.toBe(fixture.sandbox)
    await expect(service.getSandboxId()).resolves.toBe('sandbox-1')
    expect(service.retention).toBe('kill')
    expect(service.cwd).toBe('/home/user/workspace')
    expect(service.runtimeRoot).toBe('/home/user/workspace/.dsh-e2b')
    expect(sdk.create).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeoutMs: 300_000,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
    })
    expect(fixture.makeDir).toHaveBeenNthCalledWith(1, '/home/user/workspace')
    expect(fixture.makeDir).toHaveBeenNthCalledWith(2, '/home/user/workspace/.dsh-e2b')
    expect(fixture.getInfo).toHaveBeenCalledWith('/home/user/workspace/.dsh-e2b')
    const runOptions = fixture.run.mock.calls[0]?.[1]
    expect(runOptions?.envs?.HOME).toMatch(/^\/\.dsh-e2b-control-/)
    expect(fixture.run).toHaveBeenCalledWith(
      "chmod 700 -- '/home/user/workspace/.dsh-e2b'",
      { envs: { HOME: runOptions?.envs?.HOME } },
    )

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
    await expect(service.getSandbox()).rejects.toThrow(/disposing/)
  })

  it('creates auto-pausing sandboxes when explicitly configured', async () => {
    const fixture = fakeSandbox('auto-pause')
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key', autoPause: true })
    await ctx.e2b.getSandbox()

    expect(sdk.create).toHaveBeenCalledWith({
      apiKey: 'test-key',
      timeoutMs: 300_000,
      secure: true,
      lifecycle: { onTimeout: 'pause' },
    })
    await fiber.dispose()
  })

  it('reconnects an existing sandbox, adopts its timeout, and preserves its id', async () => {
    const fixture = fakeSandbox('existing-sandbox')
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, {
      apiKey: 'test-key',
      sandboxId: '  existing-sandbox  ',
      timeoutMs: 90_000,
    })

    await expect(ctx.e2b.getSandbox()).resolves.toBe(fixture.sandbox)
    await expect(ctx.e2b.getSandboxId()).resolves.toBe('existing-sandbox')
    expect(sdk.connect).toHaveBeenCalledWith('existing-sandbox', { apiKey: 'test-key' })
    expect(sdk.create).not.toHaveBeenCalled()
    expect(fixture.setTimeout).toHaveBeenCalledWith(90_000)

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it('never destroys a user-supplied sandbox when adoption setup fails', async () => {
    const fixture = fakeSandbox('external-sandbox')
    fixture.makeDir.mockRejectedValueOnce(new Error('adoption failed'))
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key', sandboxId: 'external-sandbox' })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('adoption failed')
    expect(fixture.kill).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(fixture.kill).not.toHaveBeenCalled()
  })

  it('never destroys a user-supplied sandbox when timeout adoption fails', async () => {
    const fixture = fakeSandbox('external-timeout')
    fixture.setTimeout.mockRejectedValueOnce(new Error('timeout adoption failed'))
    sdk.connect.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key', sandboxId: 'external-timeout' })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('timeout adoption failed')
    expect(fixture.makeDir).not.toHaveBeenCalled()
    expect(fixture.kill).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('pauses a live sandbox on disposal when retention is pause', async () => {
    const fixture = fakeSandbox('paused-sandbox')
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key', retention: 'pause' })
    await ctx.e2b.getSandbox()
    expect(ctx.e2b.retention).toBe('pause')

    await fiber.dispose()
    expect(fixture.betaPause).toHaveBeenCalledOnce()
    expect(fixture.kill).not.toHaveBeenCalled()
  })

  it('retains a live sandbox untouched on disposal when retention is retain', async () => {
    const fixture = fakeSandbox('retained-sandbox')
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key', retention: 'retain' })
    await ctx.e2b.getSandbox()
    expect(ctx.e2b.retention).toBe('retain')

    await fiber.dispose()
    expect(fixture.betaPause).not.toHaveBeenCalled()
    expect(fixture.kill).not.toHaveBeenCalled()
  })

  it('accepts an already-missing sandbox while pausing on disposal', async () => {
    const fixture = fakeSandbox('missing-pause')
    fixture.betaPause.mockRejectedValue(new SandboxNotFoundError('already gone'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key', retention: 'pause' })
    await ctx.e2b.getSandbox()

    await fiber.dispose()
    expect(fixture.betaPause).toHaveBeenCalledOnce()
    expect(errors).toEqual([])
  })

  it('rejects handle acquisition when disposal starts during setup', async () => {
    const fixture = fakeSandbox()
    const opening = Promise.withResolvers<SandboxType>()
    sdk.create.mockReturnValue(opening.promise)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    const acquisition = ctx.e2b.getSandbox()
    const disposing = fiber.dispose()
    opening.resolve(fixture.sandbox)

    await expect(acquisition).rejects.toThrow(/disposing/)
    await expect(disposing).resolves.toBeUndefined()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it('reads the key from the environment and honors the configured cwd and lifetime', async () => {
    vi.stubEnv('E2B_API_KEY', 'environment-key')
    const fixture = fakeSandbox('configured-sandbox')
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, {
      cwd: '/workspace/project',
      timeoutMs: 60_000,
    })
    await ctx.e2b.getSandbox()

    expect(sdk.create).toHaveBeenCalledWith({
      apiKey: 'environment-key',
      timeoutMs: 60_000,
      secure: true,
      lifecycle: { onTimeout: 'kill' },
    })
    expect(ctx.e2b.cwd).toBe('/workspace/project')
    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it('accepts a missing sandbox when disposal itself requests deletion', async () => {
    const fixture = fakeSandbox()
    fixture.kill.mockRejectedValue(new SandboxNotFoundError('already deleted'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })
    await ctx.e2b.getSandbox()

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
    expect(errors).toEqual([])
  })

  it('does not classify other disposal failures as an already-gone sandbox', async () => {
    const fixture = fakeSandbox()
    const failure = new Error('disposition unknown')
    fixture.kill.mockRejectedValue(failure)
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const errors: unknown[] = []
    ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })
    await ctx.e2b.getSandbox()
    await expect(fiber.dispose()).resolves.toBeUndefined()
    expect(fixture.kill).toHaveBeenCalledOnce()
    expect(errors).toContain(failure)
  })

  it('kills a newly created sandbox when remote directory setup fails', async () => {
    const fixture = fakeSandbox()
    fixture.makeDir.mockRejectedValueOnce(new Error('setup failed'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('setup failed')
    expect(fixture.kill).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('preserves the setup failure after its one rollback attempt fails', async () => {
    const fixture = fakeSandbox()
    fixture.run.mockRejectedValueOnce(new Error('chmod failed'))
    fixture.kill.mockRejectedValueOnce(new Error('cleanup failed'))
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    const fiber = await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })
    await expect(ctx.e2b.getSandbox()).rejects.toThrow('chmod failed')
    expect(fixture.kill).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it.each([
    ['symbolic link', { type: FileType.DIR, symlinkTarget: '/tmp/redirected' }],
    ['regular file', { type: FileType.FILE }],
  ])('rejects a reserved runtime root that is a %s', async (_label, info) => {
    const fixture = fakeSandbox()
    fixture.getInfo.mockResolvedValueOnce(info)
    sdk.create.mockResolvedValue(fixture.sandbox)
    const ctx = new Context()
    await ctx.plugin(E2BRuntime, { apiKey: 'test-key' })

    await expect(ctx.e2b.getSandbox()).rejects.toThrow('runtime root must be a real directory')
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.kill).toHaveBeenCalledOnce()
  })

  it.each([
    [{ apiKey: '' }, /configure apiKey/],
    [{ apiKey: 'x', cwd: 'relative' }, /absolute Linux path/],
    [{ apiKey: 'x', timeoutMs: 0 }, /positive finite/],
  ] as const)('fails self-contained configuration before opening E2B: %j', async (config, message) => {
    vi.stubEnv('E2B_API_KEY', '')
    const ctx = new Context()
    await expect(ctx.plugin(E2BRuntime, config)).rejects.toThrow(message)
    expect(sdk.create).not.toHaveBeenCalled()
    expect(sdk.connect).not.toHaveBeenCalled()
  })

  it('requires a key when both config and the environment omit it', async () => {
    const original = process.env.E2B_API_KEY
    delete process.env.E2B_API_KEY
    try {
      const ctx = new Context()
      await expect(ctx.plugin(E2BRuntime, {})).rejects.toThrow(/configure apiKey/)
    } finally {
      if (original === undefined) delete process.env.E2B_API_KEY
      else process.env.E2B_API_KEY = original
    }
  })
})

describe('E2B helpers and invariant companion', () => {
  it('quotes opaque shell arguments without interpolation', () => {
    expect(quoteE2BShellArg("a'b $HOME")).toBe("'a'\"'\"'b $HOME'")
  })

  it('registers the package-owned empty invariant installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(E2BInvariant).await()
    await fiber.dispose()
  })
})
