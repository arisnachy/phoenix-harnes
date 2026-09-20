import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const target = 'a'.repeat(40)

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('prepared update auto-activation bridge', () => {
  it('turns a matching prepared marker into an update activation request without forcing a supervised Host restart', () => {
    const control = mkdtempSync(join(tmpdir(), 'phoenix-prepared-bridge-'))
    try {
      writeFileSync(join(control, 'phoenix-update-prepared.json'), JSON.stringify({
        schema: 1,
        target,
        base: 'b'.repeat(40),
        mode: 'full',
      }), 'utf8')

      const result = spawnSync(process.execPath, [
        resolve('scripts/phoenix-prepared-restart-bridge.mjs'),
        '--wait-target', target,
        '--common-dir', control,
        '--timeout-ms', '1000',
      ], {
        encoding: 'utf8',
        env: { ...process.env, PHOENIX_UPDATE_SUPERVISED: '1' },
      })

      expect(result.status, result.stderr).toBe(0)
      const updateRequest = JSON.parse(readFileSync(join(control, 'phoenix-update-restart-request.json'), 'utf8'))
      expect(updateRequest).toMatchObject({ schema: 1, target })
      expect(existsSync(join(control, 'phoenix-host-restart-request.json'))).toBe(false)
    } finally {
      rmSync(control, { recursive: true, force: true })
    }
  })

  it('does not re-arm an activation request when the same verified SHA is already active', () => {
    const control = mkdtempSync(join(tmpdir(), 'phoenix-prepared-bridge-active-'))
    const runtime = mkdtempSync(join(tmpdir(), 'phoenix-prepared-runtime-active-'))
    try {
      const git = (...args: string[]) => spawnSync('git', args, { cwd: runtime, encoding: 'utf8' })
      expect(git('init').status).toBe(0)
      expect(git('config', 'user.email', 'phoenix-test@example.invalid').status).toBe(0)
      expect(git('config', 'user.name', 'Phoenix Test').status).toBe(0)
      writeFileSync(join(runtime, 'README.md'), 'active runtime\n', 'utf8')
      expect(git('add', 'README.md').status).toBe(0)
      expect(git('commit', '-m', 'active runtime').status).toBe(0)
      const activeTarget = git('rev-parse', 'HEAD').stdout.trim()

      writeFileSync(join(control, 'phoenix-update-prepared.json'), JSON.stringify({
        schema: 1,
        target: activeTarget,
        base: 'b'.repeat(40),
        mode: 'full',
      }), 'utf8')
      writeFileSync(join(control, 'phoenix-active-runtime.json'), JSON.stringify({
        schema: 1,
        target: activeTarget,
        path: runtime,
      }), 'utf8')

      const result = spawnSync(process.execPath, [
        resolve('scripts/phoenix-prepared-restart-bridge.mjs'),
        '--wait-target', activeTarget,
        '--common-dir', control,
        '--timeout-ms', '1000',
      ], {
        encoding: 'utf8',
        env: { ...process.env, PHOENIX_UPDATE_SUPERVISED: '1' },
      })

      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(join(control, 'phoenix-update-restart-request.json'))).toBe(false)
      expect(result.stderr).toContain('already active')
    } finally {
      rmSync(control, { recursive: true, force: true })
      rmSync(runtime, { recursive: true, force: true })
    }
  })

  it('wires the permanent bridge into supervised Host boot', () => {
    const launcher = source('apps/cli/src/phoenix-update-watch.ts')
    expect(launcher).toContain('phoenix-prepared-restart-bridge.mjs')
    expect(launcher).toContain("'--parent-pid', String(process.pid)")
    expect(launcher).toContain("PHOENIX_UPDATE_SUPERVISED === '1'")
  })

  it('arms the bridge from a staged full build so an old supervisor can bootstrap the fix', () => {
    const manifest = JSON.parse(source('package.json')) as { scripts?: Record<string, string> }
    expect(manifest.scripts?.build).toContain('phoenix-prepared-restart-bridge.mjs --arm-staging')
  })

  it('can bootstrap a prepared update from a legacy unsupervised Windows Host', () => {
    const bridge = source('scripts/phoenix-prepared-restart-bridge.mjs')
    expect(bridge).toContain('function discoverUnsupervisedHostPid()')
    expect(bridge).toContain('phoenix-auto-update.mjs')
    expect(bridge).toContain('--parent-pid')
    expect(bridge).toContain("'--shutdown-parent-pid', String(unsupervisedHostPid)")
    expect(bridge).toContain('process.kill(shutdownParentPid)')
    expect(bridge).toContain('legacy unsupervised Host')
  })
})
