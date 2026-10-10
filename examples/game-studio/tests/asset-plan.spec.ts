import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planGameAssets } from '../plan-game-assets.mjs'

describe('Game Studio whole-scene art plan', () => {
  it('requires all action game deliverables, not only protagonist portraits', () => {
    const shooter = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/game-studio/jungle-echo.manifest.json'), 'utf8')) as Record<string, unknown>
    const plan = planGameAssets(shooter)
    const families = new Set(plan.tasks.map((task: { family: string }) => task.family))
    for (const family of ['hero', 'enemies', 'bosses', 'backgrounds', 'weapons', 'projectiles', 'powers', 'props', 'effects', 'audio']) {
      expect(families.has(family)).toBe(true)
    }
    expect(plan.stage).toMatch(/NOT BUILT/u)
    expect(plan.tasks.every((task: { status: string }) => task.status === 'pending')).toBe(true)
    const enemyTasks = plan.tasks.filter((task: { family: string }) => task.family === 'enemies')
    expect(enemyTasks.length).toBeGreaterThan(0)
  })

  it('does not invent characters or bosses in a logic puzzle', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'examples/game-studio/lumen-circuit.manifest.json'), 'utf8')) as Record<string, unknown>
    const plan = planGameAssets(manifest)
    expect(plan.tasks.some((task: { family: string }) => task.family === 'hero' || task.family === 'bosses')).toBe(false)
    expect(plan.tasks.some((task: { family: string }) => task.family === 'backgrounds')).toBe(true)
  })

  it('reports a shooter roster lacking enemy/boss/layer designs before image-generation calls', () => {
    const plan = planGameAssets({ title: 'Empty', genre: 'run-and-gun', level: {}, audio: { cues: [] } })
    expect(plan.missingDesignDecisions).toEqual(expect.arrayContaining([
      'define enemy types and behaviors', 'define boss and distinct phases',
      'design at least 3 independently illustrated parallax layers',
    ]))
  })
})
