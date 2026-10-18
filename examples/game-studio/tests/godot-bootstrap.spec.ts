import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GODOT_STARTER_FILES, scaffoldGodotProject, verifyGodotProject, godotInvocation,
} from '../godot/bootstrap.mjs'
// The game-tool CLI is a standalone .mjs skill asset, not part of the Host TS
// source graph. Load it at test runtime rather than making an isolated Host
// typecheck resolve the asset. Vitest still fails if the real file is missing.
type GameToolModule = {
  installation(target: string, platform: string): { command: string; args: string[] }
  route(genre: string, delivery: 'chat' | 'desktop' | 'web', quality: 'prototype' | 'production'): {
    engine: string
    authoringEngine: string
    tools: string[]
    renderer: string
    authoringRule: string
  }
  windowsGodotCandidates(env?: NodeJS.ProcessEnv): string[]
}
const gameToolScript = resolve('apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs')
const { installation, route, windowsGodotCandidates } = await import(pathToFileURL(gameToolScript).href) as GameToolModule

const temp: string[] = []
afterEach(() => { for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const temporary = (): string => { const d = mkdtempSync(join(tmpdir(), 'phoenix-godot-')); temp.push(d); return d }

describe('PHOENIX Godot Game Studio native engine provisioning', () => {
  it('routes complex production for chat through Godot authoring but keeps a separate HTML5 runtime', () => {
    const desktop = route('beat-em-up', 'desktop', 'production')
    expect(desktop).toMatchObject({ engine: 'godot', authoringEngine: 'godot' })
    expect(desktop.tools).toEqual(['godot', 'tiled', 'ffmpeg'])
    const chat = route('run-and-gun', 'chat', 'production')
    expect(chat).toMatchObject({
      engine: 'html5', authoringEngine: 'godot',
      renderer: 'phoenix_game-single-file-html',
    })
    expect(chat.tools).toContain('godot')
    expect(chat.authoringRule).toContain('standalone HTML5')
    expect(route('snake', 'chat', 'production').tools).toEqual([])
  })

  it('keeps Godot for full production but makes a one-stage in-chat brawler immediately authorable as HTML', () => {
    expect(route('Double Dragon demo de un level', 'chat', 'production')).toMatchObject({
      engine: 'html5', authoringEngine: 'html5', tools: [],
    })
    expect(route('beat-em-up', 'chat', 'prototype')).toMatchObject({
      engine: 'html5', authoringEngine: 'html5', tools: [],
    })
    expect(route('beat-em-up', 'desktop', 'production')).toMatchObject({
      engine: 'godot', authoringEngine: 'godot',
    })
  })

  it('uses allowlisted winget Godot package and never a model-supplied installer URL', () => {
    const plan = installation('godot', 'win32')
    expect(plan.command).toBe('winget')
    expect(plan.args).toContain('GodotEngine.GodotEngine')
    expect(plan.args).toContain('--exact')
    expect(plan.args).toContain('--source')
    expect(plan.args).not.toContain('powershell')
    expect(plan.args).not.toContain('curl')
  })

  it('never executes a legacy install command without an explicit installation grant', () => {
    const script = resolve('apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs')
    const result = spawnSync(process.execPath, [script, 'install', '--target', 'godot'], {
      encoding: 'utf8', timeout: 15_000, env: { ...process.env, PHOENIX_GODOT_BIN: 'does-not-exist-godot.exe' },
    })
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      target: 'godot', ready: false, installed: false, action: 'authorization-required',
    })
  })

  it('finds Godot in user-local WinGet executable folders when Windows PATH is stale', () => {
    const dir = temporary()
    const pkg = join(dir, 'Microsoft', 'WinGet', 'Packages', 'GodotEngine.GodotEngine_Winget')
    mkdirSync(pkg, { recursive: true })
    const exe = join(pkg, 'Godot_v4.7-stable_win64.exe')
    writeFileSync(exe, '')
    const paths = windowsGodotCandidates({ LOCALAPPDATA: dir })
    expect(paths).toContain(exe)
    expect(paths).toContain(join(dir, 'Microsoft', 'WinGet', 'Links', 'godot.exe'))
    expect(paths.filter(path => path === exe)).toHaveLength(1)
  })

  it('creates a real Godot 4 scene, separate hero/boss state logic, and a smoke-test script once', () => {
    const target = join(temporary(), 'combat-demo')
    const first = scaffoldGodotProject(target)
    expect(first.created).toBe(true)
    expect(first.reused).toBe(false)
    for (const path of GODOT_STARTER_FILES) expect(existsSync(join(target, path))).toBe(true)
    const hero = readFileSync(join(target, 'scripts', 'hero.gd'), 'utf8')
    const boss = readFileSync(join(target, 'scripts', 'boss.gd'), 'utf8')
    expect(hero).toContain('extends CharacterBody2D')
    expect(hero).toContain('KEY_J')
    expect(hero).toContain('KEY_H')
    expect(hero).toContain('KEY_L')
    expect(boss).toContain('"fan" if attack_number')
    expect(boss).toContain('"wave"')
    expect(boss).toContain('windup')
    expect(boss).toContain('phase = 2 if hp <= 12')
    expect(readFileSync(join(target, 'tests', 'smoke.gd'), 'utf8')).toContain('PHOENIX_GODOT_SMOKE_OK')
    expect(scaffoldGodotProject(target)).toMatchObject({ created: false, reused: true })
    expect(readFileSync(join(target, 'GAME_PLAN.md'), 'utf8')).toContain('PROTOTYPE')
  })

  it('never overwrites unrelated existing project files and never silently changes a user-owned Godot project', () => {
    const target = join(temporary(), 'my-project')
    mkdirSync(join(target, 'scripts'), { recursive: true })
    writeFileSync(join(target, 'scripts', 'hero.gd'), '# user script')
    expect(() => scaffoldGodotProject(target)).toThrow('Refusing to scaffold')
    expect(readFileSync(join(target, 'scripts', 'hero.gd'), 'utf8')).toBe('# user script')
    writeFileSync(join(target, 'project.godot'), 'user app')
    expect(scaffoldGodotProject(target).reused).toBe(true)
    expect(readFileSync(join(target, 'project.godot'), 'utf8')).toBe('user app')
  })

  it('runs real Godot --import, smoke and game loops, never substituting status-only checks', () => {
    const path = join(temporary(), 'game')
    scaffoldGodotProject(path)
    const calls: Array<{ bin: string; args: string[] }> = []
    const spawn = vi.fn((bin: string, args: string[]): string => {
      calls.push({ bin, args })
      return args.includes('res://tests/smoke.gd') ? 'PHOENIX_GODOT_SMOKE_OK' : 'Godot Engine 4'
    })
    const result = verifyGodotProject(path, { ready: true, command: 'godot', version: '4.7.stable' }, spawn)
    expect(result).toMatchObject({ verified: true, artwork: 'prototype-needs-approved-sprites-and-sampled-audio' })
    expect(calls.map(call => call.args)).toEqual([
      ['--headless', '--path', resolve(path), '--import'],
      ['--headless', '--path', resolve(path), '--script', 'res://tests/smoke.gd'],
      ['--headless', '--path', resolve(path), '--quit-after', '120'],
    ])
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('does not claim verified if the scene has a parse error or lacks a smoke success marker', () => {
    const project = join(temporary(), 'demo')
    scaffoldGodotProject(project)
    const ready = { ready: true, command: 'godot', version: '4.6.1.stable' }
    expect(() => verifyGodotProject(project, ready, () => 'SCRIPT ERROR: bad GDScript'))
      .toThrow('Godot import error')
    expect(() => verifyGodotProject(project, ready, () => 'no engine evidence'))
      .toThrow('no PHOENIX_GODOT_SMOKE_OK')
    expect(() => godotInvocation({ ready: false, command: 'godot', version: '4.6' }))
      .toThrow('not been verified')
  })
})
