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
      expect(source).toContain(preset === standardPreset ? 'carga la habilidad `game-development`' : 'load the `game-development` skill')
    }
  })

  it('prevents Spanish Game Studio missions from ending with one PNG or an unsupported capability denial', () => {
    const code = readFileSync(codePreset, 'utf8')
    const standard = readFileSync(standardPreset, 'utf8')
    const studioSkill = readFileSync(resolve(root, '.agents/skills/phoenix-game-studio/SKILL.md'), 'utf8')
    const fallbackGame = resolve(root, 'examples/game-studio/jungle-echo.html')

    expect(code).toContain('Responde en español natural cuando el usuario escribe en español')
    expect(standard).toContain('Responde en español natural cuando el usuario escriba en español')
    for (const preset of [code, standard]) {
      expect(preset).toContain('examples/game-studio/jungle-echo.html')
      expect(preset).toContain('application/vnd.phoenix.game+html')
      expect(preset).toContain('phoenix_game')
      expect(preset).toContain('spawn_teammate')
    }
    expect(studioSkill).toContain('a sprite sheet is an intermediate resource')
    expect(studioSkill).toContain('Before any "tools unavailable" conclusion')
    expect(readFileSync(fallbackGame, 'utf8')).toContain('phoenix-game-manifest')
  })

  it('teaches engine routing and both modern-retro and native-retro workflows', () => {
    const directory = resolve(skill, '..')
    const source = ['SKILL.md', 'references/production-art.md', 'references/browser-games.md', 'references/godot-games.md', 'references/native-retro.md'].map(resource => readFileSync(resolve(directory, resource), 'utf8')).join('\n')

    expect(source).toContain('estética moderna por defecto')
    expect(source).toContain('Hardware retro real')
    expect(source).toContain('cc65')
    expect(source).toContain('PVSnesLib')
    expect(source).toContain('SGDK')
    expect(source).toContain('GBDK-2020')
    expect(source).toContain('connector_list')
    expect(source).toContain('connector_discover')
    expect(source).toContain('tres pruebas separadas')
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
    expect(source).toContain('Benchmark obligatorio contra el juego actual')
    expect(source).toContain('`image_generation` con `backend=auto`')
    expect(source).toContain('Pipeline de herramientas primero, no primitivas de reemplazo')
    expect(source).toContain('tarjetas SaaS')
    expect(source).toContain('un resultado meramente distinto o funcional **no satisface la petición**')
    expect(source).toContain('Puerta obligatoria de riqueza del mundo y reparto')
    expect(source).toContain('character bible')
    expect(source).toContain('Intro, title screen y presentación inicial')
    expect(source).toContain('Boot -> Title -> Intro/Cutscene -> Main Menu -> Gameplay')
    expect(source).toContain('grandes zonas')
    expect(source).toContain('partida controlable')
    expect(source).toContain('Router \`asset-first\`: reutiliza antes de dibujar')
    expect(source).toContain('Kenney')
    expect(source).toContain('itch.io Game Assets')
    expect(source).toContain('OpenGameArt')
    expect(source).toContain('Quaternius')
    expect(source).toContain('Poly Haven')
    expect(source).toContain('asset-manifest.json')
    expect(source).toContain('licenses.json')
    expect(source).toContain('85/100')
    expect(source).toContain('no gana por defecto por haber sido generado')
    expect(source).toContain('pasa primero por el router `asset-first`')
    expect(source).toContain('Fase obligatoria de scouting de assets')
    expect(source).toContain('asset brief')
    expect(source).toContain('Busca al menos 3 candidatos')
    expect(source).toContain('asset-sourcing.json')
    expect(source).toContain('gran panel lateral tipo dashboard')
    expect(source).toContain('asset brief -> búsqueda/comparación de packs')
    expect(source).not.toContain('Para arte 2D/raster, intenta primero')
  })
})
