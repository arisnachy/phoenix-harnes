import { describe, expect, it } from 'vitest'
import {
  chooseCodexPackageManager,
  classifyCodexUpdate,
  compareCodexVersions,
  normalizeCodexUpdateMode,
  packageVersionFromListJson,
  parseCodexVersion,
} from './phoenix-codex-update.mjs'

describe('PHOENIX Codex CLI updater', () => {
  it('normalizes update modes and rejects unknown policies', () => {
    expect(normalizeCodexUpdateMode(' AUTO ')).toBe('auto')
    expect(normalizeCodexUpdateMode('notify')).toBe('notify')
    expect(normalizeCodexUpdateMode('OFF')).toBe('off')
    expect(() => normalizeCodexUpdateMode('always')).toThrow('must be auto, notify, or off')
  })

  it('parses Codex versions including prereleases', () => {
    expect(parseCodexVersion('codex-cli 0.157.1')).toMatchObject({ raw: '0.157.1', prerelease: undefined })
    expect(parseCodexVersion('@openai/codex 0.159.0-alpha.3')).toMatchObject({
      raw: '0.159.0-alpha.3',
      prerelease: 'alpha.3',
    })
    expect(parseCodexVersion('not-a-version')).toBeUndefined()
  })

  it('compares semantic versions and never downgrades an ahead/prerelease install', () => {
    expect(compareCodexVersions('0.158.0', '0.157.1')).toBe(1)
    expect(compareCodexVersions('0.157.0', '0.157.1')).toBe(-1)
    expect(compareCodexVersions('0.157.1', '0.157.1')).toBe(0)
    expect(compareCodexVersions('0.159.0-alpha.2', '0.159.0-alpha.10')).toBe(-1)
    expect(compareCodexVersions('0.159.0-alpha.10', '0.159.0')).toBe(-1)
    expect(classifyCodexUpdate('0.157.0', '0.157.1')).toBe('available')
    expect(classifyCodexUpdate('0.157.1', '0.157.1')).toBe('current')
    expect(classifyCodexUpdate('0.159.0-alpha.3', '0.157.1')).toBe('ahead')
    expect(classifyCodexUpdate('0.157.1', '0.158.0-alpha.1')).toBe('invalid')
  })

  it('extracts @openai/codex from npm and pnpm JSON shapes', () => {
    expect(packageVersionFromListJson(JSON.stringify({
      dependencies: {
        '@openai/codex': { version: '0.157.1' },
      },
    }))).toBe('0.157.1')
    expect(packageVersionFromListJson(JSON.stringify([{
      name: '@openai/codex',
      version: '0.157.1',
    }]))).toBe('0.157.1')
    expect(packageVersionFromListJson('{bad-json')).toBeUndefined()
    expect(packageVersionFromListJson({ dependencies: {} })).toBeUndefined()
  })

  it('chooses the sole matching package owner and uses command path to disambiguate', () => {
    const managers = [
      { name: 'npm', version: '0.157.1', binDirs: ['/opt/npm/bin'] },
      { name: 'pnpm', version: '0.157.1', binDirs: ['/opt/pnpm/bin'] },
    ]
    expect(chooseCodexPackageManager({
      currentVersion: '0.157.1',
      codexPaths: ['/opt/pnpm/bin/codex'],
      managers,
    })).toBe('pnpm')

    expect(chooseCodexPackageManager({
      currentVersion: '0.157.1',
      codexPaths: [],
      managers: [{ name: 'npm', version: '0.157.1', binDirs: ['/usr/local/bin'] }],
    })).toBe('npm')

    expect(chooseCodexPackageManager({
      currentVersion: '0.157.1',
      codexPaths: [],
      managers,
    })).toBeUndefined()
    expect(chooseCodexPackageManager({
      currentVersion: '0.157.1',
      codexPaths: [],
      managers: [{ name: 'npm', version: '0.156.0', binDirs: ['/usr/local/bin'] }],
    })).toBeUndefined()
  })
})
