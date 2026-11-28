import { homedir } from 'node:os'
import { expect, it, vi } from 'vitest'

const { probe } = vi.hoisted(() => {
  vi.resetModules()
  return { probe: vi.fn(async (_file: string, _args: string[], _options: { cwd?: string }) => ({ stdout: '[]' })) }
})

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  platform: () => 'win32',
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  return { ...actual, execFile: Object.assign(() => undefined, { [promisify.custom]: probe }) }
})

vi.mock('node:dns/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:dns/promises')>(),
  lookup: async () => { throw new Error('offline fixture') },
}))

it('runs background Windows probes outside the Host runtime directory', async () => {
  const fakeFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline fixture'))
  const now = vi.spyOn(Date, 'now')
  try {
    const { RealityContextEngine } = await import('../src/reality-context.ts')
    const engine = new RealityContextEngine({ refreshMs: 30_000, windowsLocation: true })
    now.mockReturnValue(Date.now() + 100)
    await (engine as unknown as { refresh(): Promise<void> }).refresh()
    const argumentsByProbe = probe.mock.calls.map(([, args]) => args.join(' '))
    expect(argumentsByProbe).toEqual(expect.arrayContaining([
      expect.stringContaining('MSAcpi_ThermalZoneTemperature'),
      expect.stringContaining('GetLastInputInfo'),
      expect.stringContaining('-EncodedCommand'),
    ]))
    expect(probe.mock.calls.map(([, , options]) => options.cwd)).toEqual(
      Array.from({ length: probe.mock.calls.length }, () => homedir()),
    )
  } finally {
    now.mockRestore()
    fakeFetch.mockRestore()
  }
})
