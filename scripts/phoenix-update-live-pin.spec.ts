import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { pinPhoenixUpdateLiveHelper } from './phoenix-update-live-pin.mjs'

const directories: string[] = []

function fixture() {
  const sandbox = mkdtempSync(join(tmpdir(), 'phoenix-pin-helper-'))
  directories.push(sandbox)
  const source = join(sandbox, 'volatile-runtime')
  mkdirSync(join(source, 'scripts'), { recursive: true })
  const state = join(sandbox, 'durable-git', 'phoenix-update-state.json')
  mkdirSync(join(sandbox, 'durable-git'), { recursive: true })
  const helper = join(source, 'scripts', 'phoenix-update-live-command.mjs')
  const module = join(source, 'scripts', 'phoenix-update-state.mjs')
  writeFileSync(helper, "import { value } from './phoenix-update-state.mjs'\nprocess.stdout.write(value)\n")
  writeFileSync(module, "export const value = 'journal helper survives'\n")
  return { sandbox, source, state, helper, module }
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('durable live updater helper', () => {
  it('can execute after the old isolated runtime disappears mid-activation', () => {
    const { source, state, helper, module } = fixture()
    const pinned = pinPhoenixUpdateLiveHelper(source, state)
    expect(pinned).toBeDefined()
    expect(pinned).not.toBe(helper)
    expect(readFileSync(join(pinned!.slice(0, -'phoenix-update-live-command.mjs'.length), 'phoenix-update-state.mjs'), 'utf8'))
      .toBe(readFileSync(module, 'utf8'))
    rmSync(source, { recursive: true, force: true })
    const child = spawnSync(process.execPath, [pinned!], { encoding: 'utf8', windowsHide: true })
    expect(child.status).toBe(0)
    expect(child.stdout).toBe('journal helper survives')
  })

  it('never runs an incomplete or modified module pair', () => {
    const { source, state, helper } = fixture()
    rmSync(helper)
    expect(pinPhoenixUpdateLiveHelper(source, state)).toBeUndefined()
    writeFileSync(helper, "import { value } from './phoenix-update-state.mjs'\nprocess.stdout.write(value)\n")
    const pinned = pinPhoenixUpdateLiveHelper(source, state)
    expect(pinned).toBeDefined()
    writeFileSync(pinned!, 'tampered')
    expect(pinPhoenixUpdateLiveHelper(source, state)).toBeUndefined()
  })

  it('does not treat missing state storage as a reason to modify a worktree', () => {
    const { source } = fixture()
    expect(pinPhoenixUpdateLiveHelper(source, undefined)).toBeUndefined()
    expect(pinPhoenixUpdateLiveHelper(source, '')).toBeUndefined()
  })
})
