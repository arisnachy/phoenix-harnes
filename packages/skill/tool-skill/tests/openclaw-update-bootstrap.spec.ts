import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('OpenClaw update integration', () => {
  const root = resolve(import.meta.dirname, '..', '..', '..', '..')
  const installer = readFileSync(resolve(root, 'install-phoenix.ps1'), 'utf8')
  const updater = readFileSync(resolve(root, 'update-phoenix.ps1'), 'utf8')
  const bootstrap = readFileSync(resolve(root, 'scripts/phoenix-openclaw-bootstrap.mjs'), 'utf8')

  it('installs the optional companion from both Windows install branches and the updater', () => {
    expect(installer.split('phoenix-openclaw-bootstrap.mjs').length - 1).toBe(2)
    expect(updater).toContain('phoenix-openclaw-bootstrap.mjs')
    expect(updater).toContain('--ensure')
  })
  it('never automatically starts an OpenClaw daemon, captures the screen or imports credentials', () => {
    expect(bootstrap).toContain('--ignore-scripts')
    expect(bootstrap).not.toContain('gateway install')
    expect(bootstrap).not.toContain('auth-token')
    expect(bootstrap).toContain('.phoenix-install-attempt.json')
  })
})
