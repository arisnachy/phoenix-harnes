import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { phoenixWebLaunch } from './phoenix-web-entry.mjs'

describe('pnpm phoenix supervised Windows entrypoint', () => {
  it('routes Windows PowerShell launches to the single-instance supervisor', () => {
    const launch = phoenixWebLaunch('win32', ['--no-open'])
    expect(launch.args[0]?.replaceAll('\\', '/')).toMatch(/scripts\/phoenix-windows-supervisor\.mjs$/u)
    expect(launch.args.slice(1)).toEqual(['--no-open'])
  })

  it('preserves the original direct web CLI on Linux and macOS', () => {
    for (const platform of ['linux', 'darwin']) {
      const args = phoenixWebLaunch(platform, ['--no-open']).args
      expect(args[0]).toBe('--import')
      expect(args[1]).toBe('tsx/esm')
      expect(args[2]?.replaceAll('\\', '/')).toMatch(/apps\/cli\/src\/bin\.ts$/u)
      expect(args.slice(3)).toEqual(['web', '--no-open'])
    }
  })

  it('wires the package command through the supervised launcher', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: { phoenix: string }
    }
    expect(pkg.scripts.phoenix).toContain('phoenix-web-freshness.mjs')
    expect(pkg.scripts.phoenix).toContain('phoenix-web-entry.mjs')
    expect(pkg.scripts.phoenix).not.toContain('apps/cli/src/bin.ts web')
  })

  it('legacy takeover requires identity checks and never kills a supervised or unknown app', () => {
    const script = readFileSync(resolve('scripts/phoenix-windows-port-repair.ps1'), 'utf8')
    const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
    expect(script).toContain('[switch]$LegacyOnly')
    expect(script).toContain('(-not $nodePhoenixHost) -or $null -ne $supervisor')
    expect(script).toContain('if ($LegacyOnly')
    expect(supervisor).toContain('function retireVerifiedUnsupervisedPhoenixHost(port)')
    expect(supervisor).toContain("'-LegacyOnly', '-Apply'")
    expect(supervisor).toContain('runtimeBootPreflight(runtimeRoot)')
    expect(supervisor).toContain('waitForHostPortRelease(port)')
  })
})
