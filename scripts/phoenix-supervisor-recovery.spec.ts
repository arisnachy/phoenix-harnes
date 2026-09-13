import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { scripts?: Record<string, string> }

describe('PHOENIX supervisor-owned restart and configuration recovery', () => {
  it('accepts a generic restart request that the supervisor owns while the Host is still alive', () => {
    expect(supervisor).toContain("const CONTROL_REQUEST_FILE = 'phoenix-supervisor-request.json'")
    expect(supervisor).toContain('function superviseControlRequests(host)')
    expect(supervisor).toContain('CONTROL_POLL_INTERVAL_MS')
    expect(supervisor).toContain('terminateHost(host)')
  })

  it('preflights the effective web profile before allowing a model-requested restart', () => {
    expect(supervisor).toContain('function runConfigurationPreflight()')
    expect(supervisor).toContain("'web', '--dump-config'")
    expect(supervisor).toContain('configuration preflight failed; restart refused while the current PHOENIX remains alive')
  })

  it('keeps a last-known-good profile and restores it after an early failed boot', () => {
    expect(supervisor).toContain('HOST_HEALTHY_AFTER_MS')
    expect(supervisor).toContain('function saveLastKnownGoodProfile()')
    expect(supervisor).toContain('function restoreLastKnownGoodProfile()')
    expect(supervisor).toContain('new Host failed before the healthy window; restoring last-known-good configuration')
  })

  it('exposes a safe restart command instead of requiring the model to kill PHOENIX directly', () => {
    expect(manifest.scripts?.['phoenix:restart']).toBe('node scripts/phoenix-supervisor-control.mjs restart')
    expect(manifest.scripts?.['phoenix:preflight']).toBe('node scripts/phoenix-supervisor-control.mjs preflight')
  })
})
