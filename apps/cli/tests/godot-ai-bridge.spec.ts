import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const skill = resolve(import.meta.dirname, '../config/agent-presets/code/skills/game-development/scripts')
const bridge = join(skill, 'godot-ai-bridge.mjs')
const addon = join(skill, 'godot-ai-addon.mjs')
const dirs: string[] = []
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-godot-ai-'))
  dirs.push(root)
  mkdirSync(join(root, 'dsh'))
  mkdirSync(join(root, 'project'))
  writeFileSync(join(root, 'project', 'project.godot'), '[application]\nconfig/name="Game"\n')
  return { root, home: join(root, 'dsh'), project: join(root, 'project') }
}
function run(script: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', timeout: 8000,
    env: { ...process.env, PHOENIX_GODOT_BIN: join(tmpdir(), 'godot-not-installed-in-test'),
      PHOENIX_UVX_BIN: join(tmpdir(), 'uvx-not-installed-in-test') },
  })
}
const upstreamPackage = '@deepseek-ai/' + 'dsh-mcp-client'
const official = [
  '- insert:',
  '    - id: mcp-godot-ai',
  "      name: '${upstreamPackage}'",
  '      config:',
  '        serverName: godot-ai',
  '        transport: stdio',
  '        command: uvx',
  '        args: ["--from", "godot-ai==4.3.0", "godot-ai", "attach", "--port", "8000"]',
  '        env:',
  '          GODOT_AI_DISABLE_TELEMETRY: "true"',
  '- insert:',
  '    - id: mcp-another-tool',
  "      name: '@phoenix-ai/dsh-mcp-client'",
  '      config:',
  '        serverName: unrelated',
  '        transport: stdio',
  '        command: node',
  '        args: ["existing.mjs"]',
  '',
].join('\n')
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
describe('Phoenix Godot AI v4 integration', () => {
  it('recognizes official DSH dock config and changes only the Phoenix package alias', () => {
    const { home, project } = workspace()
    const path = join(home, 'cordis.patch.yml')
    writeFileSync(path, official)
    const doctor = run(bridge, 'doctor', '--home', home, '--project', project)
    expect(doctor.status).toBe(1)
    expect(JSON.parse(doctor.stdout)).toMatchObject({ state: 'vendor-config', configured: false })
    expect(doctor.stdout).not.toContain('--port')
    const sync = run(bridge, 'sync', '--home', home, '--allow-config-edit')
    expect(sync.status).toBe(0)
    expect(JSON.parse(sync.stdout)).toMatchObject({ updated: true, state: 'ready-config' })
    const after = readFileSync(path, 'utf8')
    expect(after).toBe(official.replace(`name: '${upstreamPackage}'`,
      "name: '@phoenix-ai/dsh-mcp-client'"))
    expect(run(bridge, 'sync', '--home', home, '--allow-config-edit').status).toBe(0)
  })

  it('rejects raw HTTP, duplicates and malformed connector entries without touching user config', () => {
    const { home } = workspace()
    const path = join(home, 'cordis.patch.yml')
    const unsafe = official.replace('transport: stdio', 'transport: streamable-http')
    writeFileSync(path, unsafe)
    expect(run(bridge, 'sync', '--home', home, '--allow-config-edit').status).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(unsafe)
    const duplicate = official + official
    writeFileSync(path, duplicate)
    expect(run(bridge, 'sync', '--home', home, '--allow-config-edit').status).toBe(1)
    expect(readFileSync(path, 'utf8')).toBe(duplicate)
  })

  it('requires a real project and never downloads an addon in plan/doctor mode', () => {
    const { project } = workspace()
    const plan = run(addon, 'plan', '--project', project)
    expect(plan.status).toBe(0)
    expect(JSON.parse(plan.stdout)).toMatchObject({
      state: 'missing', pinnedRelease: 'v4.3.0', installationAllowed: false,
    })
    expect(JSON.parse(plan.stdout).sha256).toHaveLength(64)
    expect(run(addon, 'doctor', '--project', project).status).toBe(1)
    expect(run(addon, 'plan', '--project', join(project, 'absent')).status).not.toBe(0)
    expect(run(addon, 'install', '--project', project).status).toBe(1)
    expect(JSON.parse(run(addon, 'install', '--project', project).stdout)).toMatchObject({
      installationAllowed: false,
    })
  })

  it('preserves old addon and ongoing migration instead of overwriting them', () => {
    const { project } = workspace()
    const plugin = join(project, 'addons', 'godot_ai')
    mkdirSync(plugin, { recursive: true })
    writeFileSync(join(plugin, 'plugin.cfg'), '[plugin]\nname="Godot AI"\n')
    expect(run(addon, 'install', '--project', project, '--allow-install').status).not.toBe(0)
    expect(readFileSync(join(plugin, 'plugin.cfg'), 'utf8')).toContain('Godot AI')
  })

  it('ships byte-identical standard/code tools and teaches the real MCP verification gate', () => {
    const codeRoot = resolve(skill, '..')
    const standardRoot = resolve(skill, '../../../../standard/skills/game-development')
    for (const name of ['godot-ai-bridge.mjs', 'godot-ai-addon.mjs', 'game-tools.mjs']) {
      expect(readFileSync(join(codeRoot, 'scripts', name), 'utf8'))
        .toBe(readFileSync(join(standardRoot, 'scripts', name), 'utf8'))
    }
    const studio = readFileSync(resolve(skill, '../../../../../../../../.agents/skills/phoenix-game-studio/SKILL.md'), 'utf8')
    expect(studio).toContain('editor_state')
    expect(studio).toContain('scene_get_hierarchy')
    expect(studio).toContain('godot-ai-bridge.mjs sync')
    expect(studio).toContain('editor_screenshot')
    expect(studio).toContain('Godot 4.7+')
  })
})
