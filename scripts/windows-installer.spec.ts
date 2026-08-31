import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')

describe('PHOENIX managed Windows installation', () => {
  it('offers the public one-line installer without requiring global pnpm', () => {
    const installer = read('install-phoenix.ps1')
    const oneClick = read('install-phoenix.cmd')
    const launcher = read('phoenix-windows.cmd')
    expect(installer).toContain('https://github.com/arisnachy/phoenix-harnes.git')
    expect(installer).toContain('corepack@0.34.6')
    expect(installer).toContain("'PHOENIX HARDNESS.lnk'")
    expect(oneClick).toContain('install-phoenix.ps1')
    expect(oneClick).toContain('-ExecutionPolicy Bypass')
    expect(launcher).toContain('corepack@0.34.6')
    expect(launcher).not.toMatch(/^pnpm\s/mu)
  })

  it('delegates safe automatic checks to the managed stable updater', () => {
    const updater = read('update-phoenix.ps1')
    expect(updater).toContain("'.phoenix-managed-install'")
    expect(updater).toContain('phoenix-managed-update.mjs')
    expect(updater).toContain('PHOENIX_AUTO_UPDATE')
    expect(updater).toContain('current installation was preserved')
    expect(updater).not.toContain('git reset --hard')
    expect(updater).not.toContain('git clean -f')
  })
})
