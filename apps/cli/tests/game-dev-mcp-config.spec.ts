import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '@phoenix-ai/dsh-app-boot'

interface Row {
  id?: string
  name?: string
  disabled?: unknown
  config?: Record<string, unknown>
}

const root = resolve(import.meta.dirname, '../../..')
const baseConfig = resolve(root, 'packages/bundle/base/cordis.patch.yml')
const skill = resolve(root, 'apps/cli/config/agent-presets/standard/skills/game-development/SKILL.md')
const standardPreset = resolve(root, 'apps/cli/config/agent-presets/standard/agent.cordis.yml')
const codePreset = resolve(root, 'apps/cli/config/agent-presets/code/agent.cordis.yml')

describe('game development connector pack', () => {
  it('ships safe, opt-in namespaces for the major game engines', () => {
    const patches = loadOverlayPatches('game-dev-config-test', baseConfig)
    const rows = (patches[0]?.insert ?? []) as Row[]
    const gameRows = rows.filter(row => row.id?.endsWith('-game-dev') === true)
    const byId = new Map(gameRows.map(row => [row.id, row]))

    expect([...byId.keys()]).toEqual([
      'mcp-blender-game-dev',
      'mcp-unity-game-dev',
      'mcp-unreal-game-dev',
      'mcp-godot-game-dev',
      'mcp-gameplay-game-dev',
    ])
    expect(gameRows.every(row => row.name === '@phoenix-ai/dsh-mcp-client')).toBe(true)
    expect(byId.get('mcp-unity-game-dev')?.config?.serverName).toBe('unity')
    expect(byId.get('mcp-unreal-game-dev')?.config?.serverName).toBe('unreal')
    expect(byId.get('mcp-godot-game-dev')?.config?.serverName).toBe('godot')
    expect(byId.get('mcp-gameplay-game-dev')?.config?.serverName).toBe('gameplay')
  })

  it('pins only the official Blender source and keeps community engines command-configured', () => {
    const source = readFileSync(baseConfig, 'utf8')

    expect(source).toContain('projects.blender.org/lab/blender_mcp.git@v1.0.0')
    expect(source).toContain('PHOENIX_UNITY_MCP_COMMAND')
    expect(source).toContain('PHOENIX_UNREAL_MCP_COMMAND')
    expect(source).toContain('PHOENIX_GODOT_MCP_COMMAND')
    expect(source).toContain('PHOENIX_GAMEPLAY_MCP_COMMAND')
    expect(source).not.toContain('github.com/CoplayDev')
    expect(source).not.toContain('github.com/GenOrca')
    expect(source).not.toContain('github.com/teratron')
  })

  it('loads the game skill from both standard and code presets', () => {
    for (const preset of [standardPreset, codePreset]) {
      const source = readFileSync(preset, 'utf8')
      expect(source).toContain("new URL('skills/', baseUrl)")
    }
  })

  it('teaches engine routing and both modern-retro and native-retro workflows', () => {
    const source = readFileSync(skill, 'utf8')

    expect(source).toContain('Retro moderno')
    expect(source).toContain('Retro nativo')
    expect(source).toContain('cc65/ca65/ld65')
    expect(source).toContain('PVSnesLib')
    expect(source).toContain('SGDK')
    expect(source).toContain('GBDK-2020')
    expect(source).toContain('connector_list')
    expect(source).toContain('connector_discover')
    expect(source).toContain('Bucle de calidad obligatorio')
    expect(source).toContain('Mandato premium de producción')
    expect(source).toContain('Rúbrica interna de 100 puntos')
    expect(source).toContain('90/100 o más')
    expect(source).toContain('Puerta de finalización')
    expect(source).toContain('música, ambience, Foley/SFX')
    expect(source).toContain('personajes, enemigos, NPC, props y criaturas')
    expect(source).toContain('Puerta obligatoria de calidad para personajes, enemigos y NPC')
    expect(source).toContain('`fillRect`, rectángulo, caja, círculo, cápsula')
    expect(source).toContain('"una caja con ojos"')
    expect(source).toContain('top-down, usa cuatro direcciones por defecto')
    expect(source).toContain('attack/telegraph')
    expect(source).toContain('hitbox/collision shape separada del sprite')
    expect(source).toContain('evidencia audiovisual reciente del juego real en ejecución')
  })
})
