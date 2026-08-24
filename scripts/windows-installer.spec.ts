import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8')

describe('PHOENIX managed Windows installation', () => {
  it('offers the public one-line installer without requiring global pnpm', () => {
    const installer = read('install-phoenix.ps1')
    const launcher = read('phoenix-windows.cmd')
    expect(installer).toContain('https://github.com/arisnachy/phoenix-harnes.git')
    expect(installer).toContain('corepack@0.34.6')
    expect(installer).toContain("'PHOENIX HARDNESS.lnk'")
    expect(launcher).toContain('corepack@0.34.6')
    expect(launcher).not.toMatch(/^pnpm\s/mu)
  })

  it('updates only managed, clean installations with a fast-forward', () => {
    const updater = read('update-phoenix.ps1')
    expect(updater).toContain("'.phoenix-managed-install'")
    expect(updater).toContain('git status --porcelain')
    expect(updater).toContain('git fetch --quiet origin main')
    expect(updater).toContain('git merge --ff-only origin/main')
    expect(updater).toContain("@('install', '--frozen-lockfile')")
    expect(updater).toContain("@('run', 'build')")
    expect(updater).toContain('corepack@0.34.6')
    expect(updater).not.toMatch(/reset\s+--hard|clean\s+-f/iu)
  })
})
