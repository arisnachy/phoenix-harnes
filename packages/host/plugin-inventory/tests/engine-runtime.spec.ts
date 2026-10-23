import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectEngineRuntime, prepareEngineRuntime, sanitizePhoenixRuntimeState } from '../src/engine-runtime.ts'

const homes: string[] = []
const previousHome = process.env.DSH_HOME
const previousRoot = process.env.PHOENIX_RUNTIME_ROOT

afterEach(() => {
  if (previousRoot === undefined) delete process.env.PHOENIX_RUNTIME_ROOT
  else process.env.PHOENIX_RUNTIME_ROOT = previousRoot
  vi.resetModules()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('unified execution runtime bridge', () => {
  it('returns a secret-free inspection for an unconfigured isolated home', async () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-engine-runtime-'))
    homes.push(home)
    process.env.DSH_HOME = home
    const snapshot = await inspectEngineRuntime()
    expect(snapshot.codex).toMatchObject({ status: 'unavailable' })
    expect(snapshot.openclaw).toMatchObject({ status: 'unavailable' })
    expect(snapshot).not.toHaveProperty('codex.bin')
    expect(JSON.stringify(snapshot)).not.toMatch(/(?:token|secret|password|api[_-]?key|credential)/iu)
  })

  it('rejects a non-version before invoking the official preparation manager', async () => {
    const result = await prepareEngineRuntime('../candidate')
    expect(result).toEqual({ status: 'blocked', diagnostic: 'OPENCLAW_VERSION_INVALID' })
  })

  it('blocks an unverified manager before network or installer work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-unverified-manager-'))
    homes.push(root)
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'scripts', 'phoenix-engine-runtime.mjs'), 'export async function inspectExecutionEngines(){return {}}')
    process.env.PHOENIX_RUNTIME_ROOT = root
    vi.resetModules()
    const module = await import('../src/engine-runtime.ts')
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Installer must not fetch'))
    try {
      await expect(module.prepareEngineRuntime('2026.10.5')).resolves.toEqual({
        status: 'blocked', diagnostic: 'OPENCLAW_INSTALLER_UNVERIFIED',
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })

  it('prepares only through the verified manager and discards private receipt fields', async () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-verified-manager-'))
    homes.push(root)
    mkdirSync(join(root, 'scripts'))
    writeFileSync(join(root, 'scripts', 'phoenix-engine-runtime.mjs'), `
      export const ENGINE_RUNTIME_SAFETY_VERSION = 2
      export async function inspectExecutionEngines(){return {}}
      export async function prepareOpenClawOfficial({version,applyRetention,retentionConfirm}) {
        if (applyRetention !== true || retentionConfirm !== true) throw new Error("Bounded retention was not requested")
        return {status:'prepared', candidate:{version,runtimePath:'private-path',token:'private-token'}}
      }
    `)
    process.env.PHOENIX_RUNTIME_ROOT = root
    vi.resetModules()
    const module = await import('../src/engine-runtime.ts')
    await expect(module.prepareEngineRuntime('2026.10.5')).resolves.toEqual({ status:'prepared', version:'2026.10.5' })
  })

  it('drops updater details and filesystem-like references at the Host boundary', () => {
    const snapshot = sanitizePhoenixRuntimeState({
      status: 'ready',
      current: 'C:\\Users\\arisn\\secret\\phoenix',
      target: '0123456789abcdef0123456789abcdef01234567',
      detail: 'token=should-never-cross-the-boundary',
    })
    expect(snapshot).toEqual({
      status: 'ready',
      target: '0123456789abcdef0123456789abcdef01234567',
      diagnostic: 'PHOENIX_UPDATE_REFERENCE_INVALID',
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/(?:token|secret|password|api[_-]?key|credential|C:\\Users)/iu)
  })
})
