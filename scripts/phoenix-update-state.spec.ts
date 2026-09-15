import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writePhoenixUpdateState } from './phoenix-update-state.mjs'

const roots: string[] = []
const originalSupervised = process.env.PHOENIX_UPDATE_SUPERVISED
const originalAutoUpdate = process.env.PHOENIX_AUTO_UPDATE
const originalUpdateMode = process.env.PHOENIX_UPDATE_MODE

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (originalSupervised === undefined) delete process.env.PHOENIX_UPDATE_SUPERVISED
  else process.env.PHOENIX_UPDATE_SUPERVISED = originalSupervised
  if (originalAutoUpdate === undefined) delete process.env.PHOENIX_AUTO_UPDATE
  else process.env.PHOENIX_AUTO_UPDATE = originalAutoUpdate
  if (originalUpdateMode === undefined) delete process.env.PHOENIX_UPDATE_MODE
  else process.env.PHOENIX_UPDATE_MODE = originalUpdateMode
})

describe('PHOENIX updater state persistence', () => {
  it('replaces the state document atomically and leaves no temporary file', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-state-write-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')

    writePhoenixUpdateState(path, { schema: 1, status: 'checking' })
    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target: 'a'.repeat(40) })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ schema: 1, status: 'ready', target: 'a'.repeat(40) })
    expect(existsSync(`${path}.tmp`)).toBe(false)
    expect(readdirSync(root).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('requests activation and host restart as soon as a supervised auto update becomes ready', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-ready-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    const target = 'b'.repeat(40)
    process.env.PHOENIX_UPDATE_SUPERVISED = '1'
    process.env.PHOENIX_AUTO_UPDATE = '1'
    process.env.PHOENIX_UPDATE_MODE = 'auto'

    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target })

    expect(JSON.parse(readFileSync(join(root, 'phoenix-update-restart-request.json'), 'utf8'))).toMatchObject({
      schema: 1,
      target,
    })
    expect(JSON.parse(readFileSync(join(root, 'phoenix-host-restart-request.json'), 'utf8'))).toMatchObject({
      schema: 1,
      kind: 'host-restart',
    })
  })

  it('does not request an automatic restart in notify-only mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-update-notify-'))
    roots.push(root)
    const path = join(root, 'phoenix-update-state.json')
    process.env.PHOENIX_UPDATE_SUPERVISED = '1'
    process.env.PHOENIX_AUTO_UPDATE = '1'
    process.env.PHOENIX_UPDATE_MODE = 'notify'

    writePhoenixUpdateState(path, { schema: 1, status: 'ready', target: 'c'.repeat(40) })

    expect(existsSync(join(root, 'phoenix-update-restart-request.json'))).toBe(false)
    expect(existsSync(join(root, 'phoenix-host-restart-request.json'))).toBe(false)
  })
})
