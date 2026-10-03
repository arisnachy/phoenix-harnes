import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  compareStableVersions,
  normalizeCodexUpdateMode,
  parseStableVersion,
  pruneManagedCodexVersions,
  readActiveCodexRuntime,
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
