import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const control = readFileSync(resolve('scripts/phoenix-supervisor-control.mjs'), 'utf8')
const preflight = readFileSync(resolve('scripts/phoenix-config-preflight.mjs'), 'utf8')

describe('PHOENIX supervisor-owned restart and configuration recovery', () => {
  it('accepts a generic restart request that the supervisor owns while the Host is still alive', () => {
    expect(supervisor).toContain("const CONTROL_REQUEST_FILE = 'phoenix-supervisor-request.json'")
    expect(supervisor).toContain('function superviseControlRequests(host)')
    expect(supervisor).toContain('CONTROL_POLL_INTERVAL_MS')
    expect(supervisor).toContain('terminateHost(host)')
  })

  it('keeps an independent supervisor-side config gate before shutdown', () => {
    expect(supervisor).toContain('function runConfigurationPreflight()')
    expect(supervisor).toContain("'web', '--dump-config'")
    expect(supervisor).toContain('configuration preflight failed; restart refused while the current PHOENIX remains alive')
  })

  it('runs a full isolated Host on an OS-assigned port before publishing a restart request', () => {
    expect(control).toContain("const preflightScript = join(root, 'scripts', 'phoenix-config-preflight.mjs')")
    expect(control).toContain('const preflightCode = runPreflight()')
    expect(control).toContain('restart refused; the live Host remains untouched')
    expect(preflight).toContain("'web', '--port', '0', '--no-open'")
    expect(preflight).toContain("PHOENIX_AUTO_UPDATE: '0'")
    expect(preflight).toContain('/dsh web:\\s+https?:\\/\\//u')
    expect(preflight).toContain('configuration composition and isolated Host startup passed')
  })

  it('keeps a last-known-good profile and restores it after an early failed boot', () => {
    expect(supervisor).toContain('HOST_HEALTHY_AFTER_MS')
    expect(supervisor).toContain('function saveLastKnownGoodProfile()')
    expect(supervisor).toContain('function restoreLastKnownGoodProfile()')
    expect(supervisor).toContain('new Host failed before the healthy window; restoring last-known-good configuration')
  })

  it('exposes a safe restart control command instead of requiring the model to kill PHOENIX directly', () => {
    expect(control).toContain("const CONTROL_REQUEST_FILE = 'phoenix-supervisor-request.json'")
    expect(control).toContain("if (command === 'preflight')")
    expect(control).toContain("else if (command === 'restart')")
    expect(control).toContain('restart requested after isolated preflight; the external supervisor now owns shutdown and relaunch')
  })
})
