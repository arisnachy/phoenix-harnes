import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareStableVersions,
  normalizeCodexUpdateMode,
  parseStableVersion,
  pruneManagedCodexVersions,
  readActiveCodexRuntime,
  readCodexLiveRepairRequest,
} from './phoenix-codex-cli-update.mjs'

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('PHOENIX managed Codex CLI updater', () => {
  it('accepts only stable x.y.z releases and orders them numerically', () => {
    expect(parseStableVersion('0.160.0').text).toBe('0.160.0')
    expect(() => parseStableVersion('0.162.0-alpha.10')).toThrow(/invalid stable Codex version/)
    expect(compareStableVersions('0.160.0', '0.159.2')).toBe(1)
    expect(compareStableVersions('0.160.0', '0.160.0')).toBe(0)
    expect(compareStableVersions('0.159.2', '0.160.0')).toBe(-1)
  })

  it('keeps Phoenix/Codex CLI update independent from Codex login and offers a sequential manual reauth', () => {
    const auth = readFileSync(join(process.cwd(), 'scripts', 'phoenix-codex-auth.mjs'), 'utf8')
    const stable = readFileSync(join(process.cwd(), 'scripts', 'phoenix-auto-update.mjs'), 'utf8')
    const cliUpdate = readFileSync(join(process.cwd(), 'scripts', 'phoenix-codex-cli-update.mjs'), 'utf8')
    expect(stable).not.toContain('phoenix-codex-auth.mjs')
    expect(cliUpdate).not.toContain('codex login')
    const start = auth.indexOf('const ACTIONS = new Map([')
    expect(start).toBeGreaterThan(-1)
    const spawned: Array<{ bin: string; args: string[]; callbacks: Record<string, (a: unknown, b: unknown) => void> }> = []
    const fakeProcess = {
      argv: ['node', 'scripts/phoenix-codex-auth.mjs', 'reauth'],
      platform: 'win32', execPath: 'node', env: {}, exitCode: undefined as number | undefined,
      exit: () => { throw new Error('unexpected exit') },
    }
    runInNewContext(auth.slice(start), {
      Map,
      process: fakeProcess,
      console: { error: () => {} },
      managedCodexBin: () => 'managed/codex.js',
      spawn: (bin: string, args: string[]) => {
        const callbacks: Record<string, (a: unknown, b: unknown) => void> = {}
        spawned.push({ bin, args, callbacks })
        return { once: (event: string, cb: (a: unknown, b: unknown) => void) => {
          callbacks[event] = cb
        } }
      },
    })
    expect(spawned.map(x => x.args)).toEqual([['managed/codex.js', 'logout']])
    spawned[0]?.callbacks.exit?.(0, null)
    expect(spawned.map(x => x.args)).toEqual([
      ['managed/codex.js', 'logout'],
      ['managed/codex.js', 'login'],
    ])
    spawned[1]?.callbacks.exit?.(0, null)
    expect(fakeProcess.exitCode).toBe(0)
  })

  it('validates update modes', () => {
    expect(normalizeCodexUpdateMode('AUTO')).toBe('auto')
    expect(normalizeCodexUpdateMode('notify')).toBe('notify')
    expect(() => normalizeCodexUpdateMode('nightly')).toThrow(/auto, notify, or off/)
  })

  it('accepts only an active marker whose binary stays inside DSH_HOME/codex-cli', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-codex-runtime-'))
    temporaryPaths.push(home)
    const runtime = join(home, 'codex-cli')
    const bin = join(runtime, 'versions', '0.160.0', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(bin, '#!/usr/bin/env node\n')
    writeFileSync(join(runtime, 'active.json'), JSON.stringify({
      schema: 1,
      version: '0.160.0',
      bin: 'versions/0.160.0/node_modules/@openai/codex/bin/codex.js',
    }))
    expect(readActiveCodexRuntime(home)).toEqual({ version: '0.160.0', bin })

    writeFileSync(join(runtime, 'active.json'), JSON.stringify({
      schema: 1,
      version: '0.160.0',
      bin: '../../outside.js',
    }))
    expect(readActiveCodexRuntime(home)).toBeUndefined()
  })

  it('recognizes fresh Live repair requests and ignores stale or damaged markers', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-codex-live-repair-'))
    temporaryPaths.push(home)
    const dir = join(home, 'codex-cli')
    mkdirSync(dir, { recursive: true })
    const marker = join(dir, 'live-repair-request.json')
    writeFileSync(marker, JSON.stringify({
      schema: 1, reason: 'quicksilver-v2', requestedAt: new Date().toISOString(),
    }))
    expect(readCodexLiveRepairRequest(home)?.reason).toBe('quicksilver-v2')
    writeFileSync(marker, JSON.stringify({
      schema: 1, reason: 'quicksilver-v2',
      requestedAt: new Date(Date.now() - 35 * 60_000).toISOString(),
    }))
    expect(readCodexLiveRepairRequest(home)).toBeUndefined()
    writeFileSync(marker, '{broken')
    expect(readCodexLiveRepairRequest(home)).toBeUndefined()
  })

  it('wakes the existing updater for Live rather than waiting for the six-hour poll', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'phoenix-codex-cli-update.mjs'), 'utf8')
    expect(script).toContain('request.requestedAt !== handledRepairAt')
    expect(script).toContain('await waitForPollOrParentExit(parentPid, pollInterval(), home, handledRepairAt)')
    expect(script).toContain("status: options.repair === true ? 'waiting-upstream' : 'current'")
  })

  it('prunes obsolete managed versions and incomplete staging directories', () => {
    const home = mkdtempSync(join(tmpdir(), 'phoenix-codex-prune-'))
    temporaryPaths.push(home)
    const versions = join(home, 'codex-cli', 'versions')
    for (const name of ['0.159.2', '0.160.0', '.staging-0.161.0-1-deadbeef', 'user-folder']) {
      mkdirSync(join(versions, name), { recursive: true })
    }

    expect(pruneManagedCodexVersions(home, '0.160.0')).toEqual({ removed: 2 })
    expect(existsSync(join(versions, '0.160.0'))).toBe(true)
    expect(existsSync(join(versions, '0.159.2'))).toBe(false)
    expect(existsSync(join(versions, '.staging-0.161.0-1-deadbeef'))).toBe(false)
    expect(existsSync(join(versions, 'user-folder'))).toBe(true)
  })
})
