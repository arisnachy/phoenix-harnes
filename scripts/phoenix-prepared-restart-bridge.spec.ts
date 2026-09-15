import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'

const target = 'a'.repeat(40)

function source(path: string): string {
  return readFileSync(resolve(path), 'utf8')
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await Promise.race([
    once(child, 'exit').then(() => true),
    delay(timeoutMs).then(() => false),
  ])
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

  it('stops the supervised Host only after the durable activation requests exist', async () => {
    const control = mkdtempSync(join(tmpdir(), 'phoenix-prepared-handoff-'))
    let host: ChildProcess | undefined
    let bridge: ChildProcess | undefined
    try {
      writeFileSync(join(control, 'phoenix-update-prepared.json'), JSON.stringify({
        schema: 1,
        target,
        base: 'b'.repeat(40),
        mode: 'full',
      }), 'utf8')

      host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      expect(host.pid).toBeTypeOf('number')
      const hostExit = once(host, 'exit').then(() => true)

      bridge = spawn(process.execPath, [
        resolve('scripts/phoenix-prepared-restart-bridge.mjs'),
        '--common-dir', control,
        '--parent-pid', String(host.pid),
      ], {
        env: { ...process.env, PHOENIX_UPDATE_SUPERVISED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      expect(await waitForExit(bridge, 3_000)).toBe(true)
      expect(bridge.exitCode).toBe(0)

      const updateRequest = JSON.parse(readFileSync(join(control, 'phoenix-update-restart-request.json'), 'utf8'))
      const hostRequest = JSON.parse(readFileSync(join(control, 'phoenix-host-restart-request.json'), 'utf8'))
      expect(updateRequest).toMatchObject({ schema: 1, target })
      expect(hostRequest).toMatchObject({ schema: 1, kind: 'host-restart' })

      const stopped = await Promise.race([hostExit, delay(2_000).then(() => false)])
      expect(stopped).toBe(true)
    } finally {
      if (bridge !== undefined && bridge.exitCode === null && bridge.signalCode === null) bridge.kill()
      if (host !== undefined && host.exitCode === null && host.signalCode === null) host.kill()
      if (bridge !== undefined) await waitForExit(bridge, 1_000)
      if (host !== undefined) await waitForExit(host, 1_000)
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
