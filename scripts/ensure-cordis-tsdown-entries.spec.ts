import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CORDIS_TSDOWN_ENTRY_NAMES,
  ensureCliTsdownEntries,
  missingCliTsdownEntries,
  ensureCordisTsdownEntries,
  ensureIncludeTsdownEntries,
  missingCordisTsdownEntries,
  missingIncludeTsdownEntries,
} from './ensure-cordis-tsdown-entries.mjs'

const root = resolve('C:/phoenix-runtime-test')
const vendor = resolve(root, 'vendor', 'cordis')
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc')
const entry = (name: string, extension: string): string =>
  resolve(vendor, 'lib', 'types', name + extension)
const source = (name: string): string => resolve(vendor, 'src', name + '.ts')

describe('isolated Windows Include plugin tsdown entry recovery', () => {
  const included = resolve(root, 'vendor', 'include')
  const includeSource = resolve(included, 'src', 'index.ts')
  const includeJs = resolve(included, 'lib', 'types', 'index.js')
  const includeTypes = resolve(included, 'lib', 'types', 'index.d.ts')

  it('detects a missing Include index.js even when index.d.ts survives an incremental build', () => {
    const files = new Set([includeSource, includeTypes])
    expect(missingIncludeTsdownEntries(root, path => files.has(path)))
      .toEqual(['lib/types/index.js'])
  })

  it('forces Include re-emission in the current isolated runtime before tsdown', () => {
    const files = new Set([includeSource, includeTypes, tsc])
    const spawn = vi.fn((_node: string, _args: string[], _options: object) => {
      files.add(includeJs)
      return { status: 0 }
    })
    expect(ensureIncludeTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: spawn as never,
      node: 'node.exe',
      log: () => {},
    })).toEqual({ repaired: true, missing: ['lib/types/index.js'] })
    expect(spawn).toHaveBeenCalledWith('node.exe', [tsc, '-b', 'vendor/include', '--force'],
      expect.objectContaining({ cwd: root, windowsHide: true, stdio: 'inherit' }))
  })

  it('does not rebuild a complete Include package', () => {
    const files = new Set([includeSource, includeJs, includeTypes])
    const spawn = vi.fn()
    expect(ensureIncludeTsdownEntries(root, {
      exists: path => files.has(path), spawn: spawn as never,
    })).toEqual({ repaired: false, missing: [] })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects a partial Include repair, retaining the running Host', () => {
    const files = new Set([includeSource, includeTypes, tsc])
    expect(() => ensureIncludeTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: (() => ({ status: 0 })) as never,
      log: () => {},
    })).toThrow('include entry repair did not emit: lib/types/index.js')
  })

  it('refuses to synthesize missing tracked Include source', () => {
    expect(() => missingIncludeTsdownEntries(root, () => false))
      .toThrow('tracked vendor/include/src/index.ts is missing')
  })
})


describe('isolated Windows CLI bin entry recovery', () => {
  const cli = resolve(root, 'apps', 'cli')
  const binSource = resolve(cli, 'src', 'bin.ts')
  const binJs = resolve(cli, 'lib', 'types', 'bin.js')
  const binTypes = resolve(cli, 'lib', 'types', 'bin.d.ts')


  it('keeps declared CLI entry exports synchronized with the ESM build guard', () => {
    const declarations = readFileSync(resolve('scripts/ensure-cordis-tsdown-entries.d.mts'), 'utf8')
    const implementation = readFileSync(resolve('scripts/ensure-cordis-tsdown-entries.mjs'), 'utf8')
    for (const exported of ['missingCliTsdownEntries', 'ensureCliTsdownEntries']) {
      expect(declarations).toContain('export declare function ' + exported + '(')
      expect(implementation).toContain('export function ' + exported + '(')
    }
  })

  it('detects a deleted bin.js despite a retained declaration and incremental metadata', () => {
    const files = new Set([binSource, binTypes, resolve(cli, 'tsconfig.tsbuildinfo')])
    expect(missingCliTsdownEntries(root, path => files.has(path)))
      .toEqual(['lib/types/bin.js'])
  })

  it('re-emits only the CLI project with isolated build metadata and no dependency graph force', () => {
    const files = new Set([binSource, binTypes, tsc])
    const spawn = vi.fn((_node: string, _args: string[], _options: object) => {
      files.add(binJs)
      return { status: 0 }
    })
    const log = vi.fn()
    expect(ensureCliTsdownEntries(root, {
      exists: path => files.has(path), spawn: spawn as never,
      node: 'node.exe', log,
    })).toEqual({ repaired: true, missing: ['lib/types/bin.js'] })
    expect(spawn).toHaveBeenCalledWith(
      'node.exe',
      [tsc, '-p', 'apps/cli/tsconfig.json', '--tsBuildInfoFile',
        expect.stringContaining('tsconfig.phoenix-cli-repair-')],
      expect.objectContaining({ cwd: root, stdio: 'inherit', windowsHide: true }),
    )
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('skips recompilation when CLI JS and declarations are present', () => {
    const files = new Set([binSource, binJs, binTypes])
    const spawn = vi.fn()
    expect(ensureCliTsdownEntries(root, {
      exists: path => files.has(path), spawn: spawn as never,
    })).toEqual({ repaired: false, missing: [] })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('fails closed if the CLI TypeScript pass does not restore its entry', () => {
    const files = new Set([binSource, binTypes, tsc])
    expect(() => ensureCliTsdownEntries(root, {
      exists: path => files.has(path),
      spawn: (() => ({ status: 0 })) as never,
      log: () => {},
    })).toThrow('CLI entry repair did not emit: lib/types/bin.js')
  })

  it('rejects absent tracked CLI source rather than synthesizing a fake executable', () => {
    expect(() => missingCliTsdownEntries(root, () => false))
      .toThrow('tracked apps/cli/src/bin.ts is missing')
  })

  it('is called by the existing Host pre-tsdown guard', () => {
    const entryGuard = readFileSync(resolve('scripts/ensure-cordis-tsdown-entries.mjs'), 'utf8')
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(entryGuard).toContain('ensureCliTsdownEntries(root)')
    expect(pkg.scripts['build:lib:host']).toContain('node scripts/ensure-cordis-tsdown-entries.mjs')
  })
})

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
