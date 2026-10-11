import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CORDIS_TSDOWN_ENTRY_NAMES,
  ensureCordisTsdownEntries,
  missingCordisTsdownEntries,
} from './ensure-cordis-tsdown-entries.mjs'

const root = resolve('C:/phoenix-runtime-test')
const vendor = resolve(root, 'vendor', 'cordis')
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')
const entry = (name: string, extension: string): string =>
  resolve(vendor, 'lib', 'types', name + extension)
const source = (name: string): string => resolve(vendor, 'src', name + '.ts')

describe('isolated Windows Cordis tsdown entry recovery', () => {
  it('requires the tracked Cordis source rather than masking damaged source checkouts', () => {
    expect(() => missingCordisTsdownEntries(root, () => false))
      .toThrow('tracked vendor/cordis/src/index.ts is missing')
  })

  it('accepts complete compiled entries without rebuilding or touching Codex or a live runtime', () => {
    const files = new Set([source('index'), entry('index', '.js'), entry('index', '.d.ts')])
    expect(missingCordisTsdownEntries(root, path => files.has(path))).toEqual([])
    const spawn = vi.fn()
    expect(ensureCordisTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: spawn as never,
    })).toEqual({ repaired: false, missing: [] })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('forces TypeScript to regenerate a missing entry despite an existing .tsbuildinfo', () => {
    const files = new Set([
      source('index'), entry('index', '.d.ts'), tsc,
      resolve(vendor, 'tsconfig.tsbuildinfo'),
    ])
    const spawn = vi.fn((_node: string, _args: string[], _options: object) => {
      files.add(entry('index', '.js'))
      return { status: 0 }
    })
    const log = vi.fn()
    expect(ensureCordisTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: spawn as never,
      node: 'node.exe',
      environment: { PHOENIX_BUILD_PROCESS: '1' },
      log,
    })).toEqual({ repaired: true, missing: ['lib/types/index.js'] })
    expect(spawn).toHaveBeenCalledWith('node.exe', [tsc, '-b', 'vendor/cordis', '--force'],
      expect.objectContaining({ cwd: root, windowsHide: true, stdio: 'inherit' }))
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('checks optional invariant/startup entries only if those tracked source modules exist', () => {
    expect(CORDIS_TSDOWN_ENTRY_NAMES).toEqual(['index', 'invariant', 'startup'])
    const files = new Set([
      source('index'), source('invariant'), source('startup'),
      entry('index', '.js'), entry('index', '.d.ts'),
      entry('invariant', '.d.ts'),
    ])
    expect(missingCordisTsdownEntries(root, path => files.has(path))).toEqual([
      'lib/types/invariant.js',
      'lib/types/startup.js',
      'lib/types/startup.d.ts',
    ])
  })

  it('fails before bundling if the forced compiler does not regenerate missing entries', () => {
    const files = new Set([source('index'), entry('index', '.d.ts'), tsc])
    const spawn = vi.fn(() => ({ status: 0 }))
    expect(() => ensureCordisTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: spawn as never,
      log: () => {},
    })).toThrow('did not emit: lib/types/index.js')
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('treats failed compiler execution as an actionable error rather than a tsdown glob error', () => {
    const files = new Set([source('index'), tsc])
    expect(() => ensureCordisTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: (() => ({ status: 2 })) as never,
      log: () => {},
    })).toThrow('entry repair exited with 2')
  })

  it('covers direct build:lib:host as well as the updater full build', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const script = pkg.scripts['build:lib:host'] ?? ''
    const guard = 'node scripts/ensure-cordis-tsdown-entries.mjs'
    expect(script).toContain(guard)
    expect(script.indexOf('tsc -b tsconfig.host.json')).toBeLessThan(script.indexOf(guard))
    expect(script.indexOf(guard)).toBeLessThan(script.indexOf('tsdown --env.DSH_BUILD_FACE host'))
    expect(pkg.scripts['build:lib']).toContain('build:lib:host')
  })
})
