/** Portable game-tool readiness and installation planning through the shipped skill executable. */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../config/agent-presets/standard/skills/game-development/', import.meta.url))
const script = `${root}scripts/game-tools.mjs`
function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 15_000,
  })
}
function record(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected game-tool response')
  return value as Record<string, unknown>
}
describe('shipped game toolkit', () => {
  it('checks the real browser-game prerequisite without installing an editor', () => {
    const result = run(['doctor', '--target', 'web'])
    expect(result.status).toBe(0)
    expect(record(result.stdout)).toMatchObject({ target: 'web', ready: true })
    expect(result.stdout).not.toMatch(/winget|flatpak|brew/u)
  })
  it('reports an unavailable engine without silently calling its target ready', () => {
    const result = run(['doctor', '--target', 'godot'], { PHOENIX_GODOT_BIN: `${root}absent-engine` })
    expect(result.status).toBe(1)
    expect(record(result.stdout)).toMatchObject({ target: 'godot', ready: false })
  })
  it('rejects the wrong executable version even when the configured process exits successfully', () => {
    const result = run(['doctor', '--target', 'godot'], { PHOENIX_GODOT_BIN: process.execPath })
    expect(result.status).toBe(1)
    expect(record(result.stdout)).toMatchObject({ ready: false })
  })
  it.skipIf(process.platform === 'win32')('accepts official Godot versions without a patch segment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'phoenix-godot-version-'))
    try {
      const command = join(directory, 'godot')
      writeFileSync(command, '#!/bin/sh\nprintf "4.4.stable.official.4c311cbee\\n"\n')
      chmodSync(command, 0o755)
      expect(run(['doctor', '--target', 'godot'], { PHOENIX_GODOT_BIN: command }).status).toBe(0)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it.skipIf(process.platform === 'win32')('finds Godot 4 when an older Godot executable precedes it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'phoenix-godot-fallback-'))
    try {
      for (const [name, version] of [['godot', '3.6.stable'], ['godot4', '4.6.3.stable']] as const) {
        const command = join(directory, name)
        writeFileSync(command, `#!/bin/sh\nprintf '${version}\\n'\n`)
        chmodSync(command, 0o755)
      }
      const result = run(['doctor', '--target', 'godot'], { PHOENIX_GODOT_BIN: '', PATH: directory })
      expect(result.status).toBe(0)
      expect(record(result.stdout)).toMatchObject({ ready: true, command: 'godot4' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('plans a free Windows engine installation without executing it', () => {
    const result = run(['plan', '--target', 'godot', '--platform', 'win32'])
    expect(result.status).toBe(0)
    expect(record(result.stdout)).toMatchObject({
      target: 'godot', platform: 'win32', command: 'winget',
    })
    expect(record(result.stdout).args).toEqual(expect.arrayContaining(['--exact', '--id', 'GodotEngine.GodotEngine', '--source', 'winget']))
  })
  it('does not accept arbitrary installation targets or platform overrides for actual installation', () => {
    expect(run(['install', '--target', 'arbitrary-community-repo']).status).toBe(2)
    expect(run(['install', '--target', 'godot', '--platform', 'win32']).status).toBe(2)
  })
  it('keeps code and standard skill resources identical', () => {
    const code = fileURLToPath(new URL('../config/agent-presets/code/skills/game-development/', import.meta.url))
    for (const resource of ['SKILL.md', 'scripts/game-tools.mjs', 'references/browser-games.md', 'references/godot-games.md', 'references/native-retro.md', 'references/production-art.md']) {
      expect(readFileSync(`${code}${resource}`, 'utf8')).toBe(readFileSync(`${root}${resource}`, 'utf8'))
    }
  })
})
