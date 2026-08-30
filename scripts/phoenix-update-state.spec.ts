import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writePhoenixUpdateState } from './phoenix-update-state.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
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
})
