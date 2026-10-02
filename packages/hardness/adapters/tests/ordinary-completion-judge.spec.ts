import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import {
  isGameAssetDiscovery,
  isGameAssetProduction,
  isGameAssetProvenanceMutation,
  isSubstantiveMutation,
  needsGameAssetPipeline,
  ordinaryCompletionReviewBudget,
  reviewOrdinaryCompletion,
  verificationKinds,
} from '../src/ordinary-completion-judge.ts'

const parent = { id: 'parent' } as unknown as Agent

describe('ordinary completion judge', () => {
  it('skips the independent judge for bounded verified routine work', () => {
    expect(ordinaryCompletionReviewBudget({
      request: 'Crea una mini app web en un solo archivo HTML con reloj, clima simulado y 3 tareas con localStorage.',
      configuredMaxPasses: 2,
      mutationCount: 3,
      failureCount: 0,
    })).toEqual({ mode: 'fast', maxPasses: 0 })
  })

  it('escalates semantic review only for material scope, risk, or failed attempts', () => {
    expect(ordinaryCompletionReviewBudget({
      request: 'Refactor the Phoenix router across the project without changing behavior.',
      configuredMaxPasses: 2,
      mutationCount: 4,
      failureCount: 0,
    })).toEqual({ mode: 'standard', maxPasses: 1 })

    expect(ordinaryCompletionReviewBudget({
      request: 'Prepare a production database migration with authentication and rollback.',
      configuredMaxPasses: 2,
      mutationCount: 4,
      failureCount: 0,
    })).toEqual({ mode: 'deep', maxPasses: 2 })

    expect(ordinaryCompletionReviewBudget({
      request: 'Fix this local helper.',
      configuredMaxPasses: 2,
      mutationCount: 2,
      failureCount: 2,
    })).toEqual({ mode: 'deep', maxPasses: 2 })
  })

  it('reviews explicit error contracts and scaling with read-only tools', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'needs_changes',
          summary: 'cycle message and memory growth are not evidenced',
          evidence: ['tests'],
          known_limitations: ['memory growth remains unmeasured'],
          risk_coverage: { ambiguity: true, limitations: true, report_integrity: true },
          required_changes: ['assert CycleError includes the exact cycle', 'measure bounded memory growth'],
        },
      }),
      dispose,
    }))

    const result = await reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'CycleError must include the cycle and the graph must scale to 10,000 tasks efficiently',
      mutations: ['write'],
      verifications: ['pwsh:pytest'],
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      verdict: 'needs_changes',
      requiredChanges: expect.arrayContaining([
        'assert CycleError includes the exact cycle',
        'measure bounded memory growth',
      ]),
    })
    const options = start.mock.calls[0]?.[1]
    expect(options?.toolFilter).toEqual({
      allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'],
    })
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toMatch(/passing tests are evidence, not blanket proof/i)
    expect(prompt).toMatch(/superlinear time or space/i)
    expect(prompt).toMatch(/message field/i)
    expect(prompt).toMatch(/universal risk pass/i)
    expect(prompt).toMatch(/no known limitations/i)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('recognizes game-native assets, engine edits, and gameplay evidence', () => {
    expect(isSubstantiveMutation('write', { path: 'game/player.gd' })).toBe(true)
    expect(isSubstantiveMutation('write', { path: 'levels/town.tscn' })).toBe(true)
    expect(isSubstantiveMutation('write', { path: 'art/hero.png' })).toBe(true)
    expect(isSubstantiveMutation('write', { path: 'audio/town-theme.ogg' })).toBe(true)
    expect(isSubstantiveMutation('mcp__godot__create_scene', { name: 'Town' })).toBe(true)
    expect(isSubstantiveMutation('mcp__unity__manage_scene', { name: 'Town' })).toBe(true)
    expect(isSubstantiveMutation('mcp__blender__update_material', { object: 'Hero' })).toBe(true)
    expect(isSubstantiveMutation('mcp__godot__get_scene_info', {})).toBe(false)
    expect(isSubstantiveMutation('image_generation', { prompt: 'top-down pixel-art hero sprite sheet' })).toBe(true)
    expect(isSubstantiveMutation('hardness_run', { need: { kind: 'game-development' } })).toBe(true)
    expect(isSubstantiveMutation('mcp__gameplay__capture_frame', {})).toBe(false)

    expect(verificationKinds('mcp__gameplay__capture_frame', {})).toEqual(
      expect.arrayContaining(['visual', 'play']),
    )
    expect(verificationKinds('read_image', { path: 'capture.png' })).toContain('visual')
    expect(verificationKinds('mcp__blender__render_viewport', {})).toContain('visual')
    expect(verificationKinds('mcp__godot__run_project', {})).toContain('play')
    expect(verificationKinds('pwsh', { command: 'godot --path . --headless' })).toContain('play')
  })

  it('requires real asset scouting, production, and provenance for visual game work', () => {
    expect(needsGameAssetPipeline('Create a high-quality Zelda-like 2D game')).toBe(true)
    expect(needsGameAssetPipeline('Fix collision logic in this game')).toBe(false)

    expect(isGameAssetDiscovery('web_search', { query: 'Kenney top-down RPG asset pack CC0' })).toBe(true)
    expect(isGameAssetDiscovery('web_search', { query: 'TypeScript iterator bug' })).toBe(false)
    expect(isGameAssetDiscovery('connector_discover', { query: 'OpenGameArt sprite packs' })).toBe(true)

    expect(isGameAssetProduction('image_generation', { prompt: 'top-down hero sprite sheet' })).toBe(true)
    expect(isGameAssetProduction('write', { path: 'assets/sprites/hero.png' })).toBe(true)
    expect(isGameAssetProduction('write', { path: 'src/player.ts' })).toBe(false)
    expect(isGameAssetProduction('pwsh', { command: 'Get-Item assets/sprites/hero.png' })).toBe(false)
    expect(isGameAssetProduction('pwsh', { command: 'Copy-Item hero.png assets/sprites/hero.png' })).toBe(true)
    expect(isGameAssetProduction('mcp__blender__create_material', { object: 'Hero' })).toBe(true)

    expect(isGameAssetProvenanceMutation('write', { path: 'asset-sourcing.json' })).toBe(true)
    expect(isGameAssetProvenanceMutation('pwsh', { command: 'Get-Content asset-sourcing.json' })).toBe(false)
    expect(isGameAssetProvenanceMutation('pwsh', { command: 'Set-Content asset-sourcing.json "{}"' })).toBe(true)
    expect(isGameAssetProvenanceMutation('write', { path: 'src/game.ts' })).toBe(false)
  })

  it.each([
    ['pwsh', 'Copy-Item hero.png assets/sprites/hero.png'],
    ['pwsh', 'Copy-Item "hero.png" "assets/sprites/hero.png"'],
    ['bash', 'cp hero.png assets/sprites/hero.png'],
    ['bash', 'pwd; cp hero.png assets/sprites/hero.png'],
  ])('recognizes %s asset mutations from the command argument: %s', (name, command) => {
    expect(isGameAssetProduction(name, { command })).toBe(true)
    expect(isSubstantiveMutation(name, { command })).toBe(true)
  })

  it('does not treat quoted instructions or unrelated shell metadata as asset production', () => {
    expect(isGameAssetProduction('pwsh', { command: 'Write-Output "Copy-Item hero.png assets/sprites/hero.png"' })).toBe(false)
    expect(isGameAssetProduction('bash', { command: 'pwd', note: 'cp hero.png assets/sprites/hero.png' })).toBe(false)
  })

  it('injects the premium game quality contract into ordinary game reviews', async () => {
    const dispose = vi.fn(async () => {})
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'game-judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'needs_changes',
          summary: 'audiovisual evidence is incomplete',
          evidence: ['build-log'],
          known_limitations: ['audio mix not yet reviewed'],
          risk_coverage: { ambiguity: true, limitations: true, report_integrity: true },
          required_changes: ['capture executed gameplay and review audio mix'],
        },
      }),
      dispose,
    }))

    await reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'Crea un juego SNES premium con personajes, ambientes, animaciones, música y efectos',
      mutations: ['write'],
      verifications: ['pwsh:build'],
      signal: new AbortController().signal,
    })

    const options = start.mock.calls[0]?.[1]
    const prompt = options?.prompt?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(prompt).toMatch(/Task quality contract/i)
    expect(prompt).toMatch(/current high-quality references/i)
    expect(prompt).toMatch(/character quality/i)
    expect(prompt).toMatch(/read_image/i)
    expect(prompt).toMatch(/rectangle.*box.*circle.*capsule/i)
    expect(prompt).toMatch(/player.*enemy.*NPC/i)
    expect(prompt).toMatch(/animation-state coverage|locomotion/i)
    expect(prompt).toMatch(/environment quality/i)
    expect(prompt).toMatch(/music\/ambience\/SFX/i)
    expect(prompt).toMatch(/executed build or emulator/i)
    expect(prompt).toMatch(/three independent evidence gates/i)
    expect(prompt).toMatch(/technical.*visual.*play/i)
    expect(prompt).toMatch(/baseline capture.*current build/i)
    expect(prompt).toMatch(/asset-first scouting/i)
    expect(prompt).toMatch(/candidate packs.*source\/license/i)
    expect(prompt).toMatch(/asset-manifest\.json|asset-sourcing\.json/i)
    expect(prompt).toMatch(/image_generation backend=auto/i)
    expect(prompt).toMatch(/DOM\/CSS\/SVG\/canvas/i)
    expect(prompt).toMatch(/intro.*opening.*title sequence.*cutscene/i)
    expect(prompt).toMatch(/scene density|terrain transitions|prop and vegetation variety/i)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('fails closed when pass has no concrete evidence', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'looks fine',
          evidence: [],
          known_limitations: [],
          risk_coverage: { ambiguity: true, limitations: true, report_integrity: true },
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
    }))

    await expect(reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'change code',
      mutations: ['write'],
      verifications: ['verify'],
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ verdict: 'blocked' })
  })

  it('fails closed when a pass skips universal risk coverage', async () => {
    const start = vi.fn<SubagentRuntime['start']>(async () => ({
      id: 'judge' as never,
      localAgent: undefined,
      result: Promise.resolve({
        stopReason: 'completed' as const,
        output: [],
        structured: {
          verdict: 'pass',
          summary: 'tests passed',
          evidence: ['targeted tests passed'],
          known_limitations: [],
          risk_coverage: { ambiguity: false, limitations: true, report_integrity: true },
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
    }))

    await expect(reviewOrdinaryCompletion({
      subagents: {
        getProvider: () => ({ capabilities: { outputSchema: true, toolFilter: true } }) as never,
        start,
      },
      provider: 'spawn',
      parent,
      request: 'change code',
      mutations: ['write'],
      verifications: ['verify'],
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ verdict: 'blocked' })
  })
})
