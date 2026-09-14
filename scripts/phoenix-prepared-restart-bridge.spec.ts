import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const target = 'a'.repeat(40)

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

describe('prepared update auto-activation bridge', () => {
  it('turns a matching prepared marker into both update and Host restart requests', () => {
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
      const hostRequest = JSON.parse(readFileSync(join(control, 'phoenix-host-restart-request.json'), 'utf8'))
      expect(updateRequest).toMatchObject({ schema: 1, target })
      expect(hostRequest).toMatchObject({ schema: 1, kind: 'host-restart' })
      expect(hostRequest.reason).toContain(target.slice(0, 12))
    } finally {
      rmSync(control, { recursive: true, force: true })
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
})
