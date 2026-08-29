import { describe, expect, it, vi } from 'vitest'
import {
  InstalledOpenClawPackageInstaller,
  type InstalledOpenClawPackageLocation,
  type InstalledOpenClawPackageLocator,
  type OpenClawIsolatedRunner,
} from '../src/openclaw/installed-installer.ts'
import { resolveOpenClawInstallCandidate } from '../src/openclaw/package-host.ts'

const signal = new AbortController().signal
const exactLocation: InstalledOpenClawPackageLocation = {
  packageRoot: '/opt/openclaw/brave',
  entryPath: '/opt/openclaw/brave/index.js',
  version: '2026.8.1',
}

function locatorFor(location: InstalledOpenClawPackageLocation | undefined): InstalledOpenClawPackageLocator {
  return vi.fn(async () => location)
}

function successfulRunner(): OpenClawIsolatedRunner {
  return {
    execute: vi.fn(async request => ({
      isError: false as const,
      value: { extensionId: request.extensionId, family: request.registrationFamily },
      content: [],
    })),
  }
}

describe('installed OpenClaw package installer', () => {
  it('fails closed when the exact donor package is not installed locally', async () => {
    const installer = new InstalledOpenClawPackageInstaller(locatorFor(undefined), successfulRunner())

    await expect(installer.prepare(resolveOpenClawInstallCandidate('brave'), signal)).resolves.toEqual({
      kind: 'blocked',
      status: 'MISSING_DEPENDENCY',
      reasons: [expect.stringContaining('already-installed OpenClaw 2026.8.1 package')],
    })
  })

  it('rejects a locally installed donor whose version is not exactly 2026.8.1', async () => {
    const installer = new InstalledOpenClawPackageInstaller(locatorFor({ ...exactLocation, version: '2026.8.2' }), successfulRunner())

    await expect(installer.prepare(resolveOpenClawInstallCandidate('brave'), signal)).resolves.toEqual({
      kind: 'blocked',
      status: 'INCOMPATIBLE_CONTRACT',
      reasons: [expect.stringContaining('2026.8.2')],
    })
  })

  it('does not execute donor code during preparation and delegates only after governed execution', async () => {
    const runner = successfulRunner()
    const installer = new InstalledOpenClawPackageInstaller(locatorFor(exactLocation), runner)
    const candidate = resolveOpenClawInstallCandidate('brave')

    const prepared = await installer.prepare(candidate, signal)
    expect(prepared.kind).toBe('ready')
    expect(runner.execute).not.toHaveBeenCalled()
    if (prepared.kind !== 'ready') return

    await expect(prepared.package.execute(
      { query: 'phoenix' },
      { callId: 'call-1' as never, signal },
    )).resolves.toMatchObject({ isError: false })
    expect(runner.execute).toHaveBeenCalledWith(expect.objectContaining({
      extensionId: 'brave',
      registrationFamily: 'web-search',
      packageRoot: exactLocation.packageRoot,
      entryPath: exactLocation.entryPath,
      args: { query: 'phoenix' },
      callId: 'call-1',
    }), signal)
  })

  it.each([
    ['brave', 'web-search'],
    ['memory-core', 'memory'],
    ['discord', 'channel'],
    ['cua-computer', 'computer-use'],
    ['openai', 'provider'],
  ] as const)('prepares the representative %s family without remote installation', async (extensionId, family) => {
    const runner = successfulRunner()
    const locator: InstalledOpenClawPackageLocator = vi.fn(async candidate => ({
      packageRoot: `/opt/openclaw/${candidate.extensionId}`,
      entryPath: `/opt/openclaw/${candidate.extensionId}/index.js`,
      version: '2026.8.1',
    }))
    const installer = new InstalledOpenClawPackageInstaller(locator, runner)
    const prepared = await installer.prepare(resolveOpenClawInstallCandidate(extensionId), signal)

    expect(prepared.kind).toBe('ready')
    if (prepared.kind !== 'ready') return
    expect(prepared.package.registrations).toContain(family)
    await prepared.package.execute({}, { callId: `call-${extensionId}` as never, signal })
    expect(runner.execute).toHaveBeenCalledOnce()
  })
})
