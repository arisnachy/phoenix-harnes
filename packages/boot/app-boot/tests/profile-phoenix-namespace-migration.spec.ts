import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveProfileDir,
} from '../src/index.ts'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-phoenix-profile-'))

function stagePhoenixInstallation(): string {
  const root = tmp()
  const appDir = join(root, 'app')
  const modules = join(appDir, 'node_modules')
  mkdirSync(modules, { recursive: true })

  const bundles = ['@phoenix-ai/dsh-base', '@phoenix-ai/dsh-web-app', '@phoenix-ai/dsh-headless']
  for (const name of bundles) {
    const dir = join(modules, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name,
      version: '0.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
  }

  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: '@phoenix-ai/dsh',
    dependencies: Object.fromEntries(bundles.map(name => [name, '0.0.0'])),
  }))
  return join(appDir, 'package.json')
}

function stageLegacyProfile(home: string, name: 'web' | 'headless', bundles: string[]): string {
  const dir = resolveProfileDir(name, home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, undefined, 2) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), '[]\n')
  return dir
}

describe('Phoenix namespace profile migration', () => {
  it('migrates the installation-owned legacy DeepSeek web tuple before bundle resolution', () => {
    const anchor = stagePhoenixInstallation()
    const home = tmp()
    const dir = stageLegacyProfile(home, 'web', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])

    const profile = loadProfile('dsh', 'web', anchor, home)

    expect(profile.layers.map(layer => layer.packageName)).toEqual(PROFILE_TEMPLATES.web)
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(PROFILE_TEMPLATES.web)
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe('[]\n')
  })

  it('migrates the installation-owned legacy DeepSeek headless tuple without touching user patches', () => {
    const anchor = stagePhoenixInstallation()
    const home = tmp()
    const dir = stageLegacyProfile(home, 'headless', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-headless',
    ])
    writeFileSync(join(dir, 'cordis.patch.yml'), '- id: user-owned\n  disabled: true\n')

    const profile = loadProfile('dsh', 'headless', anchor, home)

    expect(profile.layers.map(layer => layer.packageName)).toEqual(PROFILE_TEMPLATES.headless)
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual(PROFILE_TEMPLATES.headless)
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('user-owned')
  })

  it('preserves customized legacy tuples instead of guessing user intent', () => {
    const anchor = stagePhoenixInstallation()
    const home = tmp()
    const dir = stageLegacyProfile(home, 'web', [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'custom-bundle',
    ])

    expect(() => loadProfile('dsh', 'web', anchor, home)).toThrow('cannot resolve profile bundle')
    expect(readProfileManifest('dsh', dir).dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'custom-bundle',
    ])
  })
})
